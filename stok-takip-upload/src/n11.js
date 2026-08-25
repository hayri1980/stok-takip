const soap = require('soap');

const PRODUCT_WSDL = 'https://api.n11.com/ws/ProductService.wsdl'; // sadece SaveProduct icin (SOAP)
const REST_BASE = 'https://api.n11.com';
// 25.08: N11 SOAP fiyat/stok guncelleme servislerini KAPATTI ("RestAPI update servislerine gecin").
// Okuma+stok yazma artik RestAPI uzerinden: /ms/product-query ve /ms/product/tasks/price-stock-update
const INTEGRATOR = 'caparici';

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

function restHeaders(cfg) {
  return { 'appkey': cfg.appKey, 'appsecret': cfg.appSecret };
}

// Katalog onbellegi: her senkron turunda istek atmasın diye 3 dk taze tutulur.
const CATALOG_TTL_MS = 3 * 60 * 1000;
let catalogCacheTs = 0;
let catalogCacheItems = null;

async function getCatalogCached(cfg) {
  if (catalogCacheItems && Date.now() - catalogCacheTs < CATALOG_TTL_MS) return catalogCacheItems;
  const res = await fetch(REST_BASE + '/ms/product-query?page=0&size=250', { headers: restHeaders(cfg) });
  if (!res.ok) throw new Error('N11 REST ürün listesi hatası: HTTP ' + res.status);
  const j = await res.json();
  catalogCacheItems = j.content || j.items || [];
  catalogCacheTs = Date.now();
  return catalogCacheItems;
}

function toRecs(items) {
  const list = [];
  for (const it of items || []) {
    const code = String(it.stockCode || '').trim();
    if (!code) continue;
    list.push({
      barcode: code,
      sku: code,
      productSellerCode: code,
      productId: it.n11ProductId,
      qty: (it.quantity === undefined || it.quantity === null) ? null : Number(it.quantity),
      price: Number(it.salePrice) || null,
      title: it.title
    });
  }
  return list;
}

async function fetchStock(cfg) {
  const stockByBarcode = new Map();
  for (const rec of toRecs(await getCatalogCached(cfg))) {
    if (!rec.barcode || rec.qty === null) continue;
    stockByBarcode.set(rec.barcode, rec.qty);
  }
  return stockByBarcode;
}

async function fetchProducts(cfg) {
  const byBarcode = new Map();
  const bySku = new Map();
  for (const rec of toRecs(await getCatalogCached(cfg))) {
    byBarcode.set(rec.barcode, rec);
    bySku.set(rec.sku, rec);
  }
  return { byBarcode, bySku };
}

async function updateStock(cfg, sku, quantity) {
  const body = {
    payload: {
      integrator: INTEGRATOR,
      skus: [{ stockCode: String(sku), quantity: Math.max(0, Number(quantity) || 0) }]
    }
  };
  const res = await fetch(REST_BASE + '/ms/product/tasks/price-stock-update', {
    method: 'POST',
    headers: Object.assign(restHeaders(cfg), { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('N11 fiyat-stok güncelleme hatası: HTTP ' + res.status);
  const j = await res.json().catch(() => ({}));
  if (j.status === 'REJECT') throw new Error('N11 fiyat-stok güncelleme reddedildi: ' + JSON.stringify(j.reasons || '').slice(0, 150));
  catalogCacheTs = 0; // sonraki okumada taze katalog
  return true;
}

async function createProduct(cfg, p) {
  // Urun acma da REST ile denenebilir; su an urunler panel/Excel'den yuklendigi icin SOAP yolu birakildi.
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
