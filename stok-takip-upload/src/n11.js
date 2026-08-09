const soap = require('soap');

const PRODUCT_WSDL = 'https://api.n11.com/ws/ProductService.wsdl';
const STOCK_WSDL = 'https://api.n11.com/ws/ProductStockService.wsdl';

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
    const stockItems = (p.stockItems && p.stockItems.stockItem) || [];
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

async function getProductList(cfg) {
  const all = [];
  let page = 1;
  const pageSize = 100;
  while (page < 100) {
    const res = await call(PRODUCT_WSDL, 'GetProductList', {
      pagingData: { currentPage: page, pageSize }
    }, cfg);
    const products = (res && res.products && res.products.product) || [];
    all.push(...products);
    const paging = (res && res.pagingData) || {};
    const pageCount = Number(paging.pageCount) || 0;
    if (products.length === 0 || page >= pageCount) break;
    page++;
  }
  return all;
}

async function fetchStock(cfg) {
  const stockByBarcode = new Map();
  const list = flattenProducts(await getProductList(cfg));
  for (const rec of list) {
    if (!rec.barcode || rec.qty === null) continue;
    stockByBarcode.set(String(rec.barcode).trim(), rec.qty);
  }
  return stockByBarcode;
}

async function fetchProducts(cfg) {
  const byBarcode = new Map();
  const bySku = new Map();
  const list = flattenProducts(await getProductList(cfg));
  for (const rec of list) {
    const barcode = String(rec.barcode || '').trim();
    const sku = String(rec.sku || '').trim();
    if (barcode) byBarcode.set(barcode, rec);
    if (sku) bySku.set(sku, rec);
  }
  return { byBarcode, bySku };
}

async function updateStock(cfg, sku, quantity) {
  const res = await call(STOCK_WSDL, 'UpdateStockByStockSellerCode', {
    stockItems: {
      stockItem: [{ sellerStockCode: sku, quantity: Number(quantity) }]
    }
  }, cfg);
  if (res && res.result && res.result.status && res.result.status !== 'success') {
    throw new Error('N11 stok güncelleme hatası: ' + (res.result.errorMessage || res.result.status));
  }
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
