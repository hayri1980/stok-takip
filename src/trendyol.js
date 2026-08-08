const BASE = 'https://apigw.trendyol.com/integration';

async function fetchStock(sellerId, apiKey, apiSecret) {
  const auth = 'Basic ' + Buffer.from(apiKey + ':' + apiSecret).toString('base64');
  const headers = {
    'Authorization': auth,
    'x-seller-id': String(sellerId),
    'User-Agent': 'StokTakip-v1'
  };

  const stockByBarcode = new Map();
  let page = 0;
  const size = 100;

  while (page < 100) {
    const url = `${BASE}/product/sellers/${sellerId}/products?page=${page}&size=${size}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error('Trendyol API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
    }
    const data = await res.json();
    const items = data.content || [];
    for (const item of items) {
      const barcode = item.barcode;
      if (!barcode) continue;
      const qty = parseInt(item.quantity !== undefined ? item.quantity : item.availableStock, 10);
      if (!isNaN(qty)) {
        stockByBarcode.set(barcode, qty);
      }
    }
    if (items.length === 0) break;
    page++;
  }

  return stockByBarcode;
}

function normalizeQuestion(q) {
  const id = q.id !== undefined ? q.id : q.questionId;
  const question = q.question || q.questionText || '';
  if (id === undefined || !question) return null;
  return {
    id: String(id),
    question,
    productName: q.productName || q.productTitle || '',
    barcode: q.barcode || '',
    status: q.status || '',
    createdDate: q.createdDate || q.createdAt || ''
  };
}

async function fetchQuestions(sellerId, apiKey, apiSecret) {
  const auth = 'Basic ' + Buffer.from(apiKey + ':' + apiSecret).toString('base64');
  const headers = {
    'Authorization': auth,
    'x-seller-id': String(sellerId),
    'User-Agent': 'StokTakip-v1'
  };

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const params = new URLSearchParams({
    supplierId: String(sellerId),
    status: 'WAITING_FOR_ANSWER',
    startDate: String(weekAgo),
    endDate: String(now),
    page: '0',
    size: '50',
    orderByField: 'CreatedDate',
    orderByDirection: 'DESC'
  });

  const url = `${BASE}/qna/sellers/${sellerId}/questions/filter?${params}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error('Trendyol Q&A hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  const data = await res.json();
  const items = data.content || [];
  return items.map(normalizeQuestion).filter(Boolean);
}

async function fetchProductCatalog(sellerId, apiKey, apiSecret) {
  const auth = 'Basic ' + Buffer.from(apiKey + ':' + apiSecret).toString('base64');
  const headers = {
    'Authorization': auth,
    'x-seller-id': String(sellerId),
    'User-Agent': 'StokTakip-v1'
  };

  const products = [];
  let page = 0;
  const size = 100;

  while (page < 100) {
    const url = `${BASE}/product/sellers/${sellerId}/products?page=${page}&size=${size}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error('Trendyol API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
    }
    const data = await res.json();
    const items = data.content || [];
    for (const item of items) {
      if (!item.barcode) continue;
      const images = Array.isArray(item.images) ? item.images.map(i => (i && i.url) || i).filter(Boolean) : [];
      const qty = parseInt(item.quantity !== undefined ? item.quantity : item.availableStock, 10);
      products.push({
        barcode: String(item.barcode),
        name: item.title || item.productName || String(item.barcode),
        category: item.categoryName || '',
        images,
        trendyolId: item.id || '',
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 0
      });
    }
    if (items.length === 0) break;
    page++;
  }

  return products;
}

async function updateStock(sellerId, apiKey, apiSecret, barcode, quantity) {
  const auth = 'Basic ' + Buffer.from(apiKey + ':' + apiSecret).toString('base64');
  const headers = {
    'Authorization': auth,
    'x-seller-id': String(sellerId),
    'User-Agent': 'StokTakip-v1'
  };
  const qty = Math.max(0, parseInt(quantity, 10));
  const url = `${BASE}/inventory/suppliers/${sellerId}/products/${encodeURIComponent(barcode)}/quantity?quantity=${qty}&isUpdatedPrice=false`;
  const res = await fetch(url, { method: 'PUT', headers });
  if (!res.ok) {
    throw new Error('Trendyol stok güncelleme hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return true;
}

module.exports = { fetchStock, fetchQuestions, fetchProductCatalog, updateStock };
