const BASE = 'https://apis.ciceksepeti.com/api/v1';

function headers(cfg) {
  return {
    'x-api-key': cfg.apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

async function getJson(url, cfg) {
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) {
    throw new Error('Çiçeksepeti API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return res.json();
}

async function getProducts(cfg) {
  const products = [];
  let page = 1;
  while (page < 100) {
    const data = await getJson(BASE + '/Products?Page=' + page + '&PageSize=100', cfg);
    const items = (data && data.products) || [];
    products.push(...items);
    const totalCount = Number(data && data.totalCount);
    if (items.length === 0 || (totalCount > 0 && products.length >= totalCount)) break;
    page++;
  }
  return products;
}

function parseQty(item) {
  const q = item.quantity ?? item.stockQuantity ?? item.stock;
  const n = parseInt(q, 10);
  return isNaN(n) ? null : n;
}

async function fetchStock(cfg) {
  const stockByBarcode = new Map();
  const products = await getProducts(cfg);
  for (const item of products) {
    const barcode = item.barcode;
    if (!barcode) continue;
    const qty = parseQty(item);
    if (qty !== null) stockByBarcode.set(String(barcode).trim(), qty);
  }
  return stockByBarcode;
}

async function fetchProducts(cfg) {
  const byBarcode = new Map();
  const bySku = new Map();
  const products = await getProducts(cfg);
  for (const item of products) {
    const barcode = String(item.barcode || '').trim();
    const sku = String(item.stockCode || barcode).trim();
    if (!barcode && !sku) continue;
    const qty = parseQty(item);
    const price = Number(item.salesPrice ?? item.listPrice ?? item.price);
    const rec = { barcode, sku, qty, price: isNaN(price) ? null : price };
    if (barcode) byBarcode.set(barcode, rec);
    if (sku) bySku.set(sku, rec);
  }
  return { byBarcode, bySku };
}

async function updateStock(cfg, sku, quantity) {
  const res = await fetch(BASE + '/Products/price-and-stock', {
    method: 'PUT',
    headers: headers(cfg),
    body: JSON.stringify({ items: [{ stockCode: sku, quantity: Number(quantity) }] })
  });
  if (!res.ok) {
    throw new Error('Çiçeksepeti stok güncelleme hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  const data = await res.json();
  if (!data.batchId && data.Message) {
    throw new Error('Çiçeksepeti stok güncelleme reddedildi: ' + data.Message);
  }
  return true;
}

async function createProduct(cfg, p) {
  const mapping = p.mapping || {};
  const images = Array.isArray(p.images) ? p.images.slice(0, 8).map(url => ({ url })) : [];
  const body = {
    products: [{
      productName: p.title,
      mainProductCode: p.barcode,
      stockCode: p.barcode,
      categoryId: Number(mapping.categoryId),
      description: p.description || '',
      deliveryType: Number(mapping.deliveryType) || 2,
      deliveryMessageType: Number(mapping.deliveryMessageType) || 5,
      images,
      stockQuantity: Math.max(0, Number(p.quantity) || 0),
      salesPrice: Number(p.price) || 0
    }]
  };
  const res = await fetch(BASE + '/Products', {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error('Çiçeksepeti ürün oluşturma hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  const data = await res.json();
  if (!data.batchId && data.Message) {
    throw new Error('Çiçeksepeti ürün oluşturma reddedildi: ' + data.Message);
  }
  return true;
}

module.exports = { fetchStock, fetchProducts, updateStock, createProduct };
