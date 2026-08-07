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

module.exports = { fetchStock };
