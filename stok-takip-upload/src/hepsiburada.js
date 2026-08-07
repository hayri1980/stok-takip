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

module.exports = { fetchStock };
