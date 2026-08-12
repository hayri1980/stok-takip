const crypto = require('crypto');

const BASE = 'https://integration-api.pttavm.com/api/v1';

function headers(cfg) {
  return {
    'Api-Key': cfg.apiKey,
    'access-token': cfg.accessToken,
    'X-Correlation-Id': crypto.randomUUID(),
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

async function getJson(url, cfg) {
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) {
    throw new Error('PTT AVM API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return res.json();
}

async function searchProducts(cfg) {
  const results = [];
  let page = 0;
  while (page < 100) {
    const qs = 'categoryId=0&subCategoryId=0&isActive=false&isInStock=false&merchantCategoryId=0&searchPage=' + page;
    const data = await getJson(BASE + '/products/search?' + qs, cfg);
    const items = Array.isArray(data) ? data : (data.products || []);
    results.push(...items);
    if (items.length === 0) break;
    page++;
  }
  return results;
}

function parseQty(item) {
  const q = item.miktar ?? item.quantity ?? item.stock;
  const n = parseInt(q, 10);
  return isNaN(n) ? null : n;
}

function parsePrice(item) {
  const p = Number(item.kdVli ?? item.priceWithVAT ?? item.price ?? item.kdVsiz);
  return isNaN(p) ? null : p;
}

async function fetchStock(cfg) {
  const stockByBarcode = new Map();
  const items = await searchProducts(cfg);
  for (const item of items) {
    const barcode = item.barkod ?? item.barcode;
    if (!barcode) continue;
    const qty = parseQty(item);
    if (qty !== null) stockByBarcode.set(String(barcode).trim(), qty);
  }
  return stockByBarcode;
}

async function fetchProducts(cfg, barcodes) {
  const byBarcode = new Map();
  const bySku = new Map();
  const items = await searchProducts(cfg);
  for (const item of items) {
    const barcode = String(item.barkod ?? item.barcode ?? '').trim();
    const sku = String(item.urunKodu ?? item.stockCode ?? barcode).trim();
    if (!barcode && !sku) continue;
    const qty = parseQty(item);
    const price = parsePrice(item);
    const rec = { barcode, sku, qty, price };
    if (barcodes && barcodes.length > 0 && !barcodes.includes(barcode)) continue;
    if (barcode) byBarcode.set(barcode, rec);
    if (sku) bySku.set(sku, rec);
  }
  return { byBarcode, bySku };
}

async function updateStock(cfg, barcode, quantity) {
  const body = { items: [{ barcode, quantity: Number(quantity) }] };
  const res = await fetch(BASE + '/products/stock-prices', {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error('PTT AVM stok güncelleme hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  const data = await res.json();
  if (data.success === false) {
    throw new Error('PTT AVM stok güncelleme reddedildi: ' + (data.message || 'bilinmeyen hata'));
  }
  return true;
}

async function createProduct(cfg, p) {
  const mapping = p.mapping || {};
  const images = Array.isArray(p.images) ? p.images.slice(0, 8).map(url => ({ url })) : [];
  const body = {
    items: [{
      barcode: p.barcode,
      name: p.title,
      brand: '',
      categoryId: Number(mapping.categoryId),
      productCode: p.barcode,
      priceWithVat: Number(p.price) || 0,
      vatRate: Number(mapping.vatRate) || 20,
      quantity: Math.max(0, Number(p.quantity) || 0),
      images,
      longDescription: p.description || '',
      shortDescription: p.description || '',
      active: true,
      warranty: null,
      desi: Number(p.desi) || 1,
      variants: []
    }]
  };
  const res = await fetch(BASE + '/products/upsert', {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error('PTT AVM ürün oluşturma hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  const data = await res.json();
  if (data.success === false) {
    throw new Error('PTT AVM ürün oluşturma reddedildi: ' + (data.message || 'bilinmeyen hata'));
  }
  return { trackingId: data.trackingId || null };
}

async function getTrackingResult(cfg, trackingId) {
  const url = BASE + '/products/tracking-result/' + encodeURIComponent(trackingId);
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) {
    throw new Error('PTT AVM takip hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return res.json();
}

module.exports = { fetchStock, fetchProducts, updateStock, createProduct, getTrackingResult };
