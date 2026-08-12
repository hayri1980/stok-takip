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
    const url = `${BASE}/product/sellers/${sellerId}/products/approved/inventory-and-price?page=${page}&size=${size}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error('Trendyol API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
    }
    const data = await res.json();
    const items = data.content || [];
    for (const item of items) {
      for (const v of (item.variants || [])) {
        const barcode = v.barcode;
        if (!barcode) continue;
        const qty = parseInt(v.quantity !== undefined ? v.quantity : (v.stock && v.stock.quantity), 10);
        if (!isNaN(qty)) {
          stockByBarcode.set(String(barcode), qty);
        }
      }
    }
    if (items.length === 0) break;
    page++;
  }

  return stockByBarcode;
}

function normalizeQuestion(q) {
  const id = q.id !== undefined ? q.id : q.questionId;
  const question = q.text || q.question || q.questionText || '';
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
    const url = `${BASE}/product/sellers/${sellerId}/products/approved?page=${page}&size=${size}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error('Trendyol API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
    }
    const data = await res.json();
    const items = data.content || [];
    for (const item of items) {
      const v = (item.variants || [])[0];
      if (!v || !v.barcode) continue;
      const images = Array.isArray(item.images) ? item.images.map(i => (i && i.url) || i).filter(Boolean) : [];
      const salePrice = Number(v.price && v.price.salePrice);
      const listPrice = Number(v.price && v.price.listPrice) || salePrice;
      const qty = Number(v.stock && v.stock.quantity);
      products.push({
        barcode: String(v.barcode),
        name: item.title || item.productMainId || String(v.barcode),
        category: (item.category && item.category.name) || '',
        description: item.description || '',
        images,
        trendyolId: item.contentId || '',
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 0,
        price: Number.isFinite(salePrice) && salePrice > 0 ? salePrice : (Number.isFinite(listPrice) && listPrice > 0 ? listPrice : 0),
        listPrice: Number.isFinite(listPrice) && listPrice > 0 ? listPrice : 0,
        vatRate: Number(v.vatRate) || 0,
        brand: (item.brand && item.brand.name) || '',
        brandId: (item.brand && item.brand.id) || '',
        productMainId: item.productMainId || '',
        stockCode: v.stockCode || ''
      });
    }
    if (items.length === 0) break;
    page++;
  }

  return products;
}

async function fetchPriceMap(sellerId, apiKey, apiSecret) {
  const auth = 'Basic ' + Buffer.from(apiKey + ':' + apiSecret).toString('base64');
  const headers = {
    'Authorization': auth,
    'x-seller-id': String(sellerId),
    'User-Agent': 'StokTakip-v1'
  };

  const priceByBarcode = new Map();
  let page = 0;
  const size = 100;

  while (page < 100) {
    const url = `${BASE}/product/sellers/${sellerId}/products/approved/inventory-and-price?page=${page}&size=${size}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error('Trendyol fiyat çekme hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
    }
    const data = await res.json();
    const items = data.content || [];
    for (const item of items) {
      for (const v of (item.variants || [])) {
        const barcode = v.barcode;
        if (!barcode) continue;
        const salePrice = Number(v.salePrice);
        const listPrice = Number(v.listPrice) || salePrice;
        if (Number.isFinite(salePrice) && salePrice > 0) {
          priceByBarcode.set(String(barcode), {
            price: salePrice,
            listPrice: Number.isFinite(listPrice) && listPrice > 0 ? listPrice : salePrice
          });
        }
      }
    }
    if (items.length === 0) break;
    page++;
  }

  return priceByBarcode;
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

async function fetchShipmentPackages(sellerId, apiKey, apiSecret, opts = {}) {
  const auth = 'Basic ' + Buffer.from(apiKey + ':' + apiSecret).toString('base64');
  const headers = {
    'Authorization': auth,
    'x-seller-id': String(sellerId),
    'User-Agent': String(sellerId) + ' - SelfIntegration'
  };

  const startDate = opts.startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const endDate = opts.endDate || new Date().toISOString();
  const params = new URLSearchParams({
    startDate,
    endDate,
    page: '0',
    size: '100'
  });
  if (opts.status) params.set('status', opts.status);

  const url = `${BASE}/order/sellers/${sellerId}/packages?${params}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error('Trendyol sipariş hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  const data = await res.json();
  return (data && data.content) || [];
}

async function fetchOtherFinancials(sellerId, apiKey, apiSecret, transactionType, days = 14) {
  const auth = 'Basic ' + Buffer.from(apiKey + ':' + apiSecret).toString('base64');
  const headers = {
    'Authorization': auth,
    'x-seller-id': String(sellerId),
    'User-Agent': String(sellerId) + ' - SelfIntegration'
  };
  const startDate = Date.now() - Math.min(14, Math.max(1, Number(days) || 14)) * 24 * 60 * 60 * 1000;
  const url = `${BASE}/finance/che/sellers/${sellerId}/otherfinancials?transactionType=${encodeURIComponent(transactionType)}&startDate=${startDate}&endDate=${Date.now()}&page=0&size=500`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error('Trendyol finans hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  const data = await res.json();
  return (data && data.content) || [];
}

module.exports = { fetchStock, fetchQuestions, fetchProductCatalog, fetchPriceMap, updateStock, fetchShipmentPackages, fetchOtherFinancials };
