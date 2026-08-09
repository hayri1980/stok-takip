const BASE = 'https://listing-external.hepsiburada.com';

async function fetchStock(username, password) {
  const auth = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
  const headers = {
    'Authorization': auth,
    'Content-Type': 'application/json',
    'User-Agent': 'StokTakip-v1'
  };

  const stockByBarcode = new Map();
  let page = 0;
  const size = 100;

  while (page < 100) {
    const url = `${BASE}/listings/products?page=${page}&size=${size}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error('Hepsiburada API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
    }
    const data = await res.json();
    const items = data.content || data.list || [];
    for (const item of items) {
      const barcode = item.barcode;
      if (!barcode) continue;
      const qty = parseInt(item.stock ?? item.availableStock ?? item.stockCount ?? item.availableQuantity, 10);
      if (!isNaN(qty)) {
        stockByBarcode.set(barcode, qty);
      }
    }
    if (items.length === 0) break;
    page++;
  }

  return stockByBarcode;
}

async function fetchProducts(username, password) {
  const auth = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
  const headers = {
    'Authorization': auth,
    'Content-Type': 'application/json',
    'User-Agent': 'StokTakip-v1'
  };

  const byBarcode = new Map();
  const bySku = new Map();
  let page = 0;
  const size = 100;

  while (page < 100) {
    const url = `${BASE}/listings/products?page=${page}&size=${size}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error('Hepsiburada API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
    }
    const data = await res.json();
    const items = data.content || data.list || [];
    for (const item of items) {
      const barcode = item.barcode;
      const sku = item.merchantSku || item.merchantStockCode || barcode;
      if (!barcode && !sku) continue;
      const qty = parseInt(item.stock ?? item.availableStock ?? item.stockCount ?? item.availableQuantity, 10);
      const price = Number(item.price ?? item.listPrice ?? item.salePrice);
      const rec = { barcode, sku, qty: isNaN(qty) ? null : qty, price: isNaN(price) ? null : price };
      if (barcode) byBarcode.set(String(barcode).trim(), rec);
      if (sku) bySku.set(String(sku).trim(), rec);
    }
    if (items.length === 0) break;
    page++;
  }

  return { byBarcode, bySku };
}

async function updateStock(username, password, sku, availableStock, price) {
  const auth = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
  const headers = {
    'Authorization': auth,
    'Content-Type': 'application/json',
    'User-Agent': 'StokTakip-v1'
  };

  const body = { availableStock: Number(availableStock) };
  if (price !== null && price !== undefined && !isNaN(Number(price))) {
    body.price = Number(price);
  }

  const url = `${BASE}/listings/merchantid/${encodeURIComponent(username)}/sku/${encodeURIComponent(sku)}`;
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error('Hepsiburada stok güncelleme hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return true;
}

async function createProduct(username, password, p) {
  const auth = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
  const headers = {
    'Authorization': auth,
    'Content-Type': 'application/json',
    'User-Agent': 'StokTakip-v1'
  };
  const mapping = p.mapping || {};
  const body = {
    merchant: String(username),
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
  const res = await fetch(`${BASE}/product/api/products/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error('Hepsiburada ürün oluşturma hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return true;
}

module.exports = { fetchStock, fetchProducts, updateStock, createProduct };
