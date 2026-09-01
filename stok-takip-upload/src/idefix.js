const BASE = 'https://merchantapi.idefix.com';

function headers(cfg) {
  return {
    'X-API-KEY': Buffer.from(cfg.apiKey + ':' + cfg.apiSecret).toString('base64'),
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

async function getJson(url, cfg) {
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) {
    throw new Error('idefix API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return res.json();
}

async function getInventory(cfg) {
  const items = [];
  let page = 1;
  while (page < 100) {
    const data = await getJson(BASE + '/pim/catalog/' + encodeURIComponent(cfg.vendorId) + '/inventory/list?page=' + page + '&limit=100', cfg);
    const list = Array.isArray(data) ? data : (data.items || []);
    items.push(...list);
    if (list.length < 100) break;
    page++;
  }
  return items;
}

async function getPool(cfg) {
  const items = [];
  let page = 1;
  while (page < 100) {
    const data = await getJson(BASE + '/pim/pool/' + encodeURIComponent(cfg.vendorId) + '/list?page=' + page + '&limit=100', cfg);
    const list = (data && data.products) || [];
    items.push(...list);
    if (list.length < 100) break;
    page++;
  }
  return items;
}

async function fetchOrders(cfg, opts = {}) {
  const qs = new URLSearchParams({
    limit: String(opts.limit || 100),
    sortByField: 'id',
    sortDirection: 'desc',
    ...(opts.state ? { state: opts.state } : {})
  }).toString();
  const data = await getJson(BASE + '/oms/' + encodeURIComponent(cfg.vendorId) + '/list?' + qs, cfg);
  return (data && data.items) || [];
}

async function fetchStock(cfg) {
  const stockByBarcode = new Map();
  const items = await getInventory(cfg);
  for (const item of items) {
    const barcode = item.vendorStockCode || item.barcode;
    if (!barcode) continue;
    const qty = parseInt(item.inventoryQuantity ?? item.quantity ?? item.stock, 10);
    if (!isNaN(qty)) stockByBarcode.set(String(barcode).trim(), qty);
  }
  return stockByBarcode;
}

async function fetchProducts(cfg) {
  const byBarcode = new Map();
  const bySku = new Map();
  const inventory = await getInventory(cfg);
  const pool = await getPool(cfg);
  const poolByBarcode = new Map();
  for (const p of pool) {
    if (p.barcode) poolByBarcode.set(String(p.barcode).trim(), p);
  }
  for (const item of inventory) {
    const barcode = String(item.barcode || '').trim();
    const sku = String(item.stockCode || item.vendorStockCode || barcode).trim();
    if (!barcode && !sku) continue;
    const poolRec = poolByBarcode.get(barcode) || {};
    const qty = parseInt(item.inventoryQuantity ?? item.quantity ?? item.stock, 10);
    const price = Number(item.price ?? item.comparePrice);
    const rec = {
      barcode,
      sku,
      qty: isNaN(qty) ? null : qty,
      price: isNaN(price) ? null : price,
      comparePrice: Number(poolRec.comparePrice ?? item.comparePrice) || null,
      deliveryDuration: poolRec.deliveryDuration || 1,
      deliveryType: poolRec.deliveryType || 'regular'
    };
    if (barcode) byBarcode.set(barcode, rec);
    if (sku) bySku.set(sku, rec);
  }
  return { byBarcode, bySku };
}

async function updateStock(cfg, barcode, quantity, price, rec) {
  const r = rec || { price, comparePrice: null, deliveryDuration: 1, deliveryType: 'regular' };
  const items = [{
    barcode,
    price: Number(r.price) || 0,
    comparePrice: Number(r.comparePrice) || Number(r.price) || 0,
    inventoryQuantity: Number(quantity),
    maximumPurchasableQuantity: 50,
    deliveryDuration: r.deliveryDuration || 1,
    deliveryType: r.deliveryType || 'regular'
  }];
  const res = await fetch(BASE + '/pim/catalog/' + encodeURIComponent(cfg.vendorId) + '/inventory-upload', {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ items })
  });
  if (!res.ok) {
    throw new Error('idefix stok güncelleme hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  const data = await res.json();
  const first = (data.items && data.items[0]) || data;
  const okStatuses = ['completed', 'success', 'created', 'created_product', 'processed'];
  if (first.status && !okStatuses.includes(String(first.status).toLowerCase())) {
    throw new Error('idefix stok güncelleme reddedildi: ' + (first.status || 'bilinmeyen hata'));
  }
  if (data.status && data.status === 'FAILED') {
    throw new Error('idefix stok yüklemesi başarısız oldu (batch ' + (data.batchRequestId || '?') + ')');
  }
  return true;
}

async function createProduct(cfg, p) {
  const mapping = p.mapping || {};
  const images = Array.isArray(p.images) ? p.images.slice(0, 8).map(url => ({ url })) : [];
  const body = {
    products: [{
      barcode: p.barcode,
      title: p.title,
      productMainId: p.barcode,
      brandId: Number(mapping.brandId),
      categoryId: Number(mapping.categoryId),
      inventoryQuantity: Math.max(0, Number(p.quantity) || 0),
      vendorStockCode: p.vendorStockCode || p.barcode,
      description: p.description || '',
      price: Number(p.price) || 0,
      comparePrice: Number(p.listPrice) || Number(p.price) || 0,
      vatRate: Number(mapping.vatRate) || 20,
      deliveryType: 'regular',
      deliveryDuration: 1,
      cargoCompanyId: Number(mapping.cargoCompanyId) || 0,
      shipmentAddressId: Number(mapping.shipmentAddressId) || 0,
      returnAddressId: Number(mapping.returnAddressId) || 0,
      images,
      attributes: [],
      isZoneSale: null
    }]
  };
  const res = await fetch(BASE + '/pim/pool/' + encodeURIComponent(cfg.vendorId) + '/create', {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error('idefix ürün oluşturma hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  const data = await res.json();
  const first = (data.products && data.products[0]) || data;
  if (data.status && data.status === 'FAILED') {
    throw new Error('idefix ürün oluşturma başarısız (batch ' + (data.batchRequestId || '?') + ')');
  }
  const okStatuses = ['completed', 'success', 'created', 'created_product', 'processed'];
  if (first.status && !okStatuses.includes(String(first.status).toLowerCase())) {
    throw new Error('idefix ürün oluşturma reddedildi: ' + (first.status || 'bilinmeyen hata'));
  }
  return true;
}

function normalizeQuestion(q) {
  return {
    id: 'idefix:' + String(q.id),
    market: 'idefix',
    productName: q.product || '',
    question: q.question || '',
    createdDate: q.createdAt || ''
  };
}

async function fetchQuestions(cfg) {
  const items = [];
  let page = 1;
  let pageCount = 1;
  while (page <= pageCount && page < 50) {
    const url = BASE + '/pim/vendor/' + encodeURIComponent(cfg.vendorId) +
      '/question/filter?page=' + page + '&limit=50&sort=newest';
    const data = await getJson(url, cfg);
    const list = Array.isArray(data) ? data : (data.items || []);
    items.push(...list);
    const pc = Number((data && data.pageCount) || 0);
    if (pc > pageCount) pageCount = pc;
    if (!list.length || page >= pageCount) break;
    page++;
  }
  return items.map(normalizeQuestion).filter(q => q.id && q.question);
}

// idefix sorusuna cevap gonder
async function answerQuestion(cfg, questionId, answer) {
  // questionId 'idefix:123' formatinda ise suresi ayir
  const rawId = String(questionId).replace(/^idefix:/, '');
  const url = BASE + '/pim/vendor/' + encodeURIComponent(cfg.vendorId) +
    '/question/' + encodeURIComponent(rawId) + '/answer';
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ answer: String(answer) })
  });
  if (!res.ok) {
    throw new Error('idefix cevap hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return true;
}

// idefix finansal verileri (placeholder - gercek endpoint eklenecek)
async function fetchFinancials(cfg, days = 14) {
  // idefix'te finansal endpoint yoksa bos don
  // Gercek endpoint: /finance/transactions veya benzeri
  try {
    // Placeholder: henuz endpoint yok
    return [];
  } catch (e) {
    return [];
  }
}

module.exports = { fetchStock, fetchProducts, updateStock, createProduct, fetchOrders, fetchQuestions, answerQuestion, fetchFinancials };
