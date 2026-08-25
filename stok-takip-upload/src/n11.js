const soap = require('soap');

const PRODUCT_WSDL = 'https://api.n11.com/ws/ProductService.wsdl';
// 25.08: ProductStockService.wsdl N11 tarafindan KALDIRILDI (405 donuyor).
// Stok guncelleme artik ProductService/UpdateProductBasic ile yapiliyor.

const clientCache = {};

async function clientFor(wsdl) {
  if (clientCache[wsdl]) return clientCache[wsdl];
  clientCache[wsdl] = soap.createClientAsync(wsdl, { attributesKey: '$attr' });
  return clientCache[wsdl];
}

async function call(wsdl, method, payload, cfg) {
  const client = await clientFor(wsdl);
  const args = Object.assign({}, payload || {});
  args.auth = { appKey: cfg.appKey, appSecret: cfg.appSecret };
  const result = await client[method + 'Async'](args);
  const res = result[0] || result;
  if (res && res.result && res.result.status && res.result.status !== 'success') {
    throw new Error('N11 ' + method + ' hatası: ' + (res.result.errorMessage || res.result.status));
  }
  return res;
}

function flattenProducts(products) {
  const list = [];
  for (const p of products || []) {
    const si = p.stockItems && p.stockItems.stockItem;
    const stockItems = Array.isArray(si) ? si : (si ? [si] : []);
    for (const s of stockItems) {
      const qty = parseInt(s.quantity, 10);
      list.push({
        barcode: s.gtin || s.sellerStockCode || p.productSellerCode,
        sku: s.sellerStockCode || p.productSellerCode,
        productSellerCode: p.productSellerCode,
        productId: p.id,
        qty: isNaN(qty) ? null : qty,
        price: Number(p.price) || null,
        title: p.title
      });
    }
    if (stockItems.length === 0) {
      list.push({
        barcode: p.productSellerCode,
        sku: p.productSellerCode,
        productSellerCode: p.productSellerCode,
        productId: p.id,
        qty: null,
        price: Number(p.price) || null,
        title: p.title
      });
    }
  }
  return list;
}

// 25.08: N11 liste uçları büyük yanıtlarda ürünleri KIRIYOR (pageSize 20+ bos/eksik gelir,
// ~3 üründen sonrası kesiliyor). Sayfayı 3'te tutup sayfa sayfa topluyoruz.
// Her senkron turunda 5+ istek atmasın diye katalog 3 dk önbellekte tutulur.
const PAGE_SIZE = 3;
const CATALOG_TTL_MS = 3 * 60 * 1000;
let catalogCacheTs = 0;
let catalogCache = null;

async function getProductList(cfg) {
  const all = [];
  let page = 1;
  while (page < 200) {
    const res = await call(PRODUCT_WSDL, 'GetProductList', {
      pagingData: { currentPage: page, pageSize: PAGE_SIZE }
    }, cfg);
    const products = (res && res.products && res.products.product) || [];
    all.push(...(Array.isArray(products) ? products : [products]));
    const paging = (res && res.pagingData) || {};
    const pageCount = Number(paging.pageCount) || 0;
    if (!products.length || page >= pageCount) break;
    page++;
  }
  return all;
}

async function getCatalogCached(cfg) {
  if (catalogCache && Date.now() - catalogCacheTs < CATALOG_TTL_MS) return catalogCache;
  catalogCache = await getProductList(cfg);
  catalogCacheTs = Date.now();
  return catalogCache;
}

async function fetchStock(cfg) {
  const list = flattenProducts(await getCatalogCached(cfg));
  const stockByBarcode = new Map();
  for (const rec of list) {
    if (!rec.barcode || rec.qty === null) continue;
    stockByBarcode.set(String(rec.barcode).trim(), rec.qty);
  }
  return stockByBarcode;
}

async function fetchProducts(cfg) {
  const byBarcode = new Map();
  const bySku = new Map();
  const list = flattenProducts(await getCatalogCached(cfg));
  for (const rec of list) {
    const barcode = String(rec.barcode || '').trim();
    const sku = String(rec.sku || '').trim();
    if (barcode) byBarcode.set(barcode, rec);
    if (sku) bySku.set(sku, rec);
  }
  return { byBarcode, bySku };
}

async function updateStock(cfg, sku, quantity) {
  // Once urunun mevcut kaydini cek (productId + stok kalemi id gerekli)
  const det = await call(PRODUCT_WSDL, 'GetProductBySellerCode', { sellerCode: String(sku) }, cfg);
  const p = det && det.product;
  if (!p) throw new Error('N11 ürün bulunamadı: ' + sku);
  const siRaw = p.stockItems && p.stockItems.stockItem;
  const sis = Array.isArray(siRaw) ? siRaw : (siRaw ? [siRaw] : []);
  const item = sis.find(s => String(s.sellerStockCode) === String(sku)) || sis[0];
  if (!item) throw new Error('N11 stok kalemi yok: ' + sku);
  await call(PRODUCT_WSDL, 'UpdateProductBasic', {
    productId: Number(p.id),
    productSellerCode: String(sku),
    productDiscount: {},
    stockItems: {
      stockItem: [{
        id: Number(item.id),
        sellerStockCode: String(item.sellerStockCode || sku),
        quantity: Math.max(0, Number(quantity) || 0)
      }]
    },
    description: p.description || ''
  }, cfg);
  catalogCacheTs = 0; // sonraki okumada taze katalog cekilsin
  return true;
}

async function createProduct(cfg, p) {
  const mapping = p.mapping || {};
  const images = Array.isArray(p.images) ? p.images.slice(0, 8) : [];
  const payload = {
    product: {
      title: p.title,
      description: p.description || '',
      brand: { name: mapping.brand || '' },
      category: { id: Number(mapping.categoryId) },
      productSellerCode: p.barcode,
      price: String(Number(p.price) || 0),
      currencyType: mapping.currencyType || 'TRY',
      stockItems: {
        stockItem: [{
          sellerStockCode: p.barcode,
          quantity: String(Math.max(0, Number(p.quantity) || 0)),
          gtin: p.barcode
        }]
      },
      attributes: { attribute: [] },
      images: { image: images },
      shipmentTemplate: mapping.shipmentTemplate || '',
      preparingDay: 1
    }
  };
  const res = await call(PRODUCT_WSDL, 'SaveProduct', payload, cfg);
  if (res && res.result && res.result.status && res.result.status !== 'success') {
    throw new Error('N11 ürün oluşturma hatası: ' + (res.result.errorMessage || res.result.status));
  }
  return true;
}

module.exports = { fetchStock, fetchProducts, updateStock, createProduct };
