const PROD = 'https://listing-external.hepsiburada.com';
const SIT = 'https://listing-external-sit.hepsiburada.com';

function base(cfg) {
  return cfg.sit ? SIT : PROD;
}

function merchantUser(cfg) {
  return cfg.merchantId || cfg.username;
}

function headers(cfg) {
  const user = merchantUser(cfg);
  return {
    'Authorization': 'Basic ' + Buffer.from(user + ':' + (cfg.password || '')).toString('base64'),
    'Content-Type': 'application/json',
    'User-Agent': cfg.userAgent || (user + ' - StokTakip')
  };
}

async function getListingsPage(cfg, page, limit) {
  const url = `${base(cfg)}/listings/merchantid/${encodeURIComponent(merchantUser(cfg))}?page=${page}&limit=${limit}`;
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) {
    throw new Error('Hepsiburada API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return res.json();
}

async function fetchStock(cfg) {
  const stockByBarcode = new Map();
  let page = 0;
  const limit = 100;
  while (page < 1000) {
    const data = await getListingsPage(cfg, page, limit);
    const items = data.listings || [];
    for (const item of items) {
      const barcode = item.merchantSku || item.hepsiburadaSku;
      if (!barcode) continue;
      const qty = parseInt(item.availableStock, 10);
      if (!isNaN(qty)) stockByBarcode.set(String(barcode).trim(), qty);
    }
    if (items.length < limit) break;
    page++;
  }
  return stockByBarcode;
}

async function fetchProducts(cfg) {
  const byBarcode = new Map();
  const bySku = new Map();
  let page = 0;
  const limit = 100;
  while (page < 1000) {
    const data = await getListingsPage(cfg, page, limit);
    const items = data.listings || [];
    for (const item of items) {
      const sku = item.merchantSku || item.hepsiburadaSku;
      const hbSku = item.hepsiburadaSku;
      if (!sku && !hbSku) continue;
      const qty = parseInt(item.availableStock, 10);
      const price = Number(item.price);
      const rec = {
        barcode: sku || hbSku,
        sku: sku || hbSku,
        hbSku,
        qty: isNaN(qty) ? null : qty,
        price: isNaN(price) ? null : price
      };
      if (sku) byBarcode.set(String(sku).trim(), rec);
      if (hbSku) bySku.set(String(hbSku).trim(), rec);
    }
    if (items.length < limit) break;
    page++;
  }
  return { byBarcode, bySku };
}

async function updateStock(cfg, sku, availableStock, price) {
  const body = { availableStock: Number(availableStock) };
  if (price !== null && price !== undefined && !isNaN(Number(price))) {
    body.price = Number(price);
  }
  const url = `${base(cfg)}/listings/merchantid/${encodeURIComponent(merchantUser(cfg))}/sku/${encodeURIComponent(sku)}`;
  const res = await fetch(url, { method: 'PUT', headers: headers(cfg), body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error('Hepsiburada stok güncelleme hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return true;
}

async function createProduct(cfg, p) {
  const mapping = p.mapping || {};
  const body = {
    merchant: merchantUser(cfg),
    items: [{
      merchantSku: p.barcode,
      categoryId: Number(mapping.categoryId),
      productName: p.title,
      brand: mapping.brand || '',
      attributes: [],
      vatRate: Number(mapping.vatRate) || 20,
      price: Number(p.price) || 0,
      availableStock: Math.max(0, Number(p.quantity) || 0)
    }]
  };
  const res = await fetch('https://mpop.hepsiburada.com/product/api/products/import', {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error('Hepsiburada ürün oluşturma hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return true;
}

module.exports = { fetchStock, fetchProducts, updateStock, createProduct };
