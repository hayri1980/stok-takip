const PROD = 'https://listing-external.hepsiburada.com';
const SIT = 'https://listing-external-sit.hepsiburada.com';

function base(cfg) {
  return cfg.sit ? SIT : PROD;
}

function merchantUser(cfg) {
  return cfg.merchantId || cfg.username;
}

function headers(cfg, withJson = false) {
  const user = merchantUser(cfg);
  const h = {
    'Authorization': 'Basic ' + Buffer.from(user + ':' + (cfg.password || '')).toString('base64'),
    'User-Agent': cfg.userAgent || (user + ' - StokTakip')
  };
  if (withJson) h['Content-Type'] = 'application/json';
  return h;
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
      if (sku) byBarcode.set(String(sku).trim().toLowerCase(), rec);
      if (hbSku) bySku.set(String(hbSku).trim().toLowerCase(), rec);
    }
    if (items.length < limit) break;
    page++;
  }
  return { byBarcode, bySku };
}

async function updateStock(cfg, sku, availableStock, price) {
  const body = [{ merchantSku: String(sku), availableStock: Number(availableStock) }];
  const url = `${base(cfg)}/listings/merchantid/${encodeURIComponent(merchantUser(cfg))}/stock-uploads`;
  const res = await fetch(url, { method: 'POST', headers: headers(cfg, true), body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error('Hepsiburada stok güncelleme hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return true;
}

async function createProduct(cfg, p) {
  const mapping = p.mapping || {};
  const images = Array.isArray(p.images) ? p.images.slice(0, 10) : [];
  const attributes = {
    merchantSku: String(p.barcode),
    Barcode: String(p.barcode),
    UrunAdi: p.title,
    UrunAciklamasi: p.description || '',
    Marka: mapping.brand || '',
    tax_vat_rate: String(Number(mapping.vatRate) || 20),
    kg: String(Number(mapping.desi) || 1),
    price: String(Number(p.price) || 0),
    stock: String(Math.max(0, Number(p.quantity) || 0))
  };
  images.forEach((url, i) => {
    attributes['Image' + (i + 1)] = url;
  });
  const products = [{
    categoryId: Number(mapping.categoryId),
    merchant: merchantUser(cfg),
    attributes
  }];
  const payload = JSON.stringify(products);
  const fd = new FormData();
  fd.append('file', new File([payload], 'file.json', { type: 'application/json' }));
  const res = await fetch('https://mpop.hepsiburada.com/product/api/products/import', {
    method: 'POST',
    headers: headers(cfg),
    body: fd
  });
  if (!res.ok) {
    throw new Error('Hepsiburada ürün oluşturma hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    /* yanıt JSON değilse yok say */
  }
  if (data && data.success === false) {
    throw new Error('Hepsiburada ürün oluşturma reddedildi (' + (data.code || '?') + '): ' + (data.message || ''));
  }
  return data && data.data && data.data.trackingId ? { trackingId: data.data.trackingId } : true;
}

module.exports = { fetchStock, fetchProducts, updateStock, createProduct };
