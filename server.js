require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const sync = require('./src/sync');
const notifier = require('./src/notifier');
const telegramBot = require('./src/telegram');
const backup = require('./src/backup');
const trendyol = require('./src/trendyol');
const iyzico = require('./src/iyzico');
const kargo = require('./src/kargo');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const publicDir = path.join(__dirname, 'public');
const magazaDir = path.join(publicDir, 'magaza');

function isStoreDomain(req) {
  const host = String(req.headers.host || '').toLowerCase().replace(/^www\./, '');
  const domain = String(db.getShopSettings().domain || '').toLowerCase().replace(/^www\./, '');
  return !!domain && host === domain;
}

app.get('/', (req, res) => {
  if (isStoreDomain(req)) return res.sendFile(path.join(magazaDir, 'index.html'));
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/panel', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/magaza', (req, res) => res.sendFile(path.join(magazaDir, 'index.html')));
app.get('/urun/:id', (req, res) => res.sendFile(path.join(magazaDir, 'index.html')));
app.use('/magaza', express.static(magazaDir));
app.use('/panel', express.static(publicDir));
app.use('/', express.static(publicDir));

function siteBase(req) {
  const ss = db.getShopSettings();
  const host = String(ss.domain || req.headers.host || '').toLowerCase().replace(/^www\./, '');
  return 'https://' + host;
}

app.get('/robots.txt', (req, res) => {
  const base = siteBase(req);
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\n\nSitemap: ' + base + '/sitemap.xml\n');
});

app.get('/sitemap.xml', (req, res) => {
  const base = siteBase(req);
  const products = db.getShopProducts().filter(p => p.visible);
  const urls = [
    '<url><loc>' + base + '/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>'
  ].concat(products.map(p => {
    const lastmod = (p.updatedAt || p.createdAt || new Date().toISOString()).slice(0, 10);
    return '<url><loc>' + base + '/urun/' + p.id + '</loc><lastmod>' + lastmod + '</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>';
  }));
  res.type('application/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>');
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// ---- Ürünler ----
app.get('/api/products', (req, res) => {
  res.json(db.getProducts());
});

app.post('/api/products', (req, res) => {
  if (!req.body || !req.body.barcode) {
    return res.status(400).json({ error: 'Barkod zorunludur' });
  }
  const product = db.addProduct(req.body);
  res.json(product);
});

app.put('/api/products/:id', (req, res) => {
  const product = db.updateProduct(req.params.id, req.body);
  if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
  res.json(product);
});

app.delete('/api/products/:id', (req, res) => {
  db.deleteProduct(req.params.id);
  res.json({ ok: true });
});

// ---- Ayarlar ----
app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

app.put('/api/settings', (req, res) => {
  const settings = db.setSettings(req.body);
  scheduleCron();
  res.json(settings);
});

// ---- Log ----
app.get('/api/log', (req, res) => {
  res.json(db.getLog());
});

// ---- Senkron ----
app.post('/api/sync', async (req, res) => {
  const results = {};
  for (const kind of ['trendyol', 'hepsiburada']) {
    try {
      results[kind] = await sync.syncMarketplace(kind);
    } catch (e) {
      results[kind] = { error: e.message };
      db.addLog(kind + ' senkron hatası: ' + e.message);
    }
  }
  try {
    await sync.checkStocks();
  } catch (e) {
    db.addLog('Stok kontrol hatası: ' + e.message);
  }
  res.json(results);
});

// ---- Soru kontrolü ----
app.post('/api/sync/questions', async (req, res) => {
  try {
    const result = await sync.checkQuestions();
    res.json(result);
  } catch (e) {
    db.addLog('Soru kontrol hatası: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---- Test e-postası ----
app.post('/api/test-mail', async (req, res) => {
  const result = await notifier.sendTestMail();
  res.json(result);
});

// ---- Test Telegram ----
app.post('/api/test-telegram', async (req, res) => {
  const result = await notifier.sendTestTelegram();
  res.json(result);
});

// ---- Mağaza (halka açık) ----
function publicShopSettings() {
  const s = db.getShopSettings();
  return {
    storeName: s.storeName,
    domain: s.domain,
    phone: s.phone,
    whatsapp: s.whatsapp,
    address: s.address,
    iban: s.iban,
    ibanHolder: s.ibanHolder,
    cargoFee: s.cargoFee,
    freeShippingThreshold: s.freeShippingThreshold,
    cargoCompany: s.cargoCompany,
    metaDescription: s.metaDescription,
    metaKeywords: s.metaKeywords
  };
}

function notifyOrder(order) {
  const ss = db.getShopSettings();
  const payLabel = order.paymentMethod === 'iyzico' ? 'Kredi Kartı (iyzico)' : 'EFT / Havale';
  const lines = order.items.map((i, n) =>
    (n + 1) + ') ' + i.name + ' x' + i.qty + ' = ' + i.price * i.qty + ' TL'
  );
  const text =
    'YENİ SİPARİŞ: ' + order.orderNo + '\n' +
    lines.join('\n') + '\n' +
    'Ürün tutarı: ' + order.subtotal + ' TL\n' +
    'Kargo: ' + order.cargoFee + ' TL\n' +
    'TOPLAM: ' + order.total + ' TL\n' +
    'Ödeme: ' + payLabel + '\n' +
    'Müşteri: ' + (order.customer.name || '') + ' - ' + (order.customer.phone || '') + '\n' +
    'Adres: ' + [order.customer.city, order.customer.district, order.customer.address].filter(Boolean).join(', ');
  const html =
    '<h3>Yeni sipariş: ' + order.orderNo + '</h3>' +
    '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">' +
    '<tr><th>Ürün</th><th>Adet</th><th>Tutar</th></tr>' +
    order.items.map(i => '<tr><td>' + i.name + '</td><td>' + i.qty + '</td><td>' + (i.price * i.qty) + ' TL</td></tr>').join('') +
    '</table>' +
    '<p><b>Toplam:</b> ' + order.total + ' TL (' + payLabel + ')</p>' +
    '<p><b>Müşteri:</b> ' + (order.customer.name || '') + ' - ' + (order.customer.phone || '') + '</p>' +
    '<p><b>Adres:</b> ' + [order.customer.city, order.customer.district, order.customer.address].filter(Boolean).join(', ') + '</p>';
  return notifier.notify('YENİ SİPARİŞ: ' + order.orderNo, html, text);
}

async function buildShopOrder(body) {
  const products = db.getShopProducts();
  const items = [];
  let subtotal = 0;
  for (const it of body.items || []) {
    const p = products.find(x => x.id === it.id);
    if (!p || !p.visible) throw new Error('Geçersiz ürün: ' + (it.id || ''));
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    if (p.stock !== null && qty > p.stock) throw new Error('Yetersiz stok: ' + p.name);
    items.push({ productId: p.id, name: p.name, qty, price: p.price });
    subtotal += p.price * qty;
  }
  if (!items.length) throw new Error('Sepet boş');
  const ss = db.getShopSettings();
  const cargoFee = (ss.freeShippingThreshold > 0 && subtotal >= Number(ss.freeShippingThreshold)) ? 0 : (Number(ss.cargoFee) || 0);
  const order = db.addShopOrder({
    items,
    customer: body.customer || {},
    paymentMethod: body.paymentMethod === 'iyzico' ? 'iyzico' : 'eft',
    subtotal,
    cargoFee,
    total: subtotal + cargoFee
  });
  for (const it of items) {
    const p = products.find(x => x.id === it.productId);
    if (p && p.stock !== null) db.updateShopProduct(p.id, { stock: Math.max(0, p.stock - it.qty) });
    db.incrementShopProductSold(it.productId, it.qty);
  }
  notifyOrder(order);
  return order;
}

app.get('/api/shop/products', (req, res) => {
  const list = db.getShopProducts().filter(p => p.visible);
  res.json(list.map(p => ({
    id: p.id, name: p.name, barcode: p.barcode, price: p.price, stock: p.stock,
    category: p.category, images: p.images, description: p.description, featured: p.featured
  })));
});

app.get('/api/shop/settings', (req, res) => {
  res.json(publicShopSettings());
});

app.post('/api/shop/track', (req, res) => {
  db.recordShopVisit();
  res.json({ ok: true });
});

app.get('/api/shop/orders/:id', (req, res) => {
  const order = db.getShopOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
  const ss = db.getShopSettings();
  res.json({
    ...order,
    cargoTrackingUrl: kargo.trackingLink(ss, order.cargoNumber)
  });
});

app.post('/api/shop/orders', async (req, res) => {
  try {
    const order = await buildShopOrder(req.body);
    if (req.body.paymentMethod === 'iyzico') {
      const ss = db.getShopSettings();
      if (!ss.iyzico.enabled || !ss.iyzico.apiKey) {
        db.updateShopOrder(order.id, { status: 'bekliyor' });
        return res.status(400).json({ error: 'Kart ödemesi henüz aktif değil. Lütfen EFT/Havale seçin.' });
      }
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const callbackUrl = protocol + '://' + req.headers.host + '/api/shop/orders/' + order.id + '/payment-callback';
      const basketItems = order.items.map(i => ({ id: i.productId, name: i.name, category: 'Genel', price: i.price * i.qty }));
      const init = await iyzico.initialize(ss, order, order.customer, basketItems, callbackUrl);
      return res.json({ order, payment: { token: init.token, conversationId: init.conversationId, form: init.checkoutFormContent || '' } });
    }
    res.json({ order });
  } catch (e) {
    db.addLog('Sipariş oluşturma hatası: ' + e.message);
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/shop/orders/:id/payment-callback', async (req, res) => {
  const order = db.getShopOrder(req.params.id);
  if (!order) return res.status(404).send('Sipariş bulunamadı');
  const ss = db.getShopSettings();
  const token = req.body.token || '';
  try {
    const detail = await iyzico.getPaymentDetail(ss, order.id, token);
    const ok = detail && detail.status === 'success' && detail.paymentStatus === 'SUCCESS';
    if (ok) {
      db.updateShopOrder(order.id, { status: 'odendi', paymentToken: token });
      db.addLog('Ödeme alındı: ' + order.orderNo);
    } else {
      db.updateShopOrder(order.id, { status: 'bekliyor' });
    }
    res.redirect('/magaza?durum=' + (ok ? 'basarili' : 'basarisiz') + '&siparis=' + order.orderNo);
  } catch (e) {
    db.addLog('Ödeme doğrulama hatası: ' + e.message);
    res.redirect('/magaza?durum=basarisiz&siparis=' + order.orderNo);
  }
});

// ---- Mağaza (yönetim) ----
app.get('/api/shop/admin/products', (req, res) => {
  res.json(db.getShopProducts());
});

app.post('/api/shop/admin/products', (req, res) => {
  res.json(db.addShopProduct(req.body || {}));
});

app.put('/api/shop/admin/products/:id', (req, res) => {
  const product = db.updateShopProduct(req.params.id, req.body || {});
  if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
  res.json(product);
});

app.delete('/api/shop/admin/products/:id', (req, res) => {
  db.deleteShopProduct(req.params.id);
  res.json({ ok: true });
});

app.post('/api/shop/admin/import-trendyol', async (req, res) => {
  const cfg = db.getSettings().trendyol;
  if (!cfg.apiKey || !cfg.apiSecret || !cfg.sellerId) {
    return res.status(400).json({ error: 'Trendyol ayarları eksik' });
  }
  try {
    const list = await trendyol.fetchProductCatalog(cfg.sellerId, cfg.apiKey, cfg.apiSecret);
    let added = 0, updated = 0;
    const existing = db.getShopProducts();
    for (const item of list) {
      const qty = Math.max(0, Number(item.quantity) || 0);
      const ex = existing.find(p => p.barcode === item.barcode);
      if (ex) {
        db.updateShopProduct(ex.id, { name: item.name, category: item.category, images: item.images, stock: qty });
        updated++;
      } else {
        db.addShopProduct({ name: item.name, barcode: item.barcode, category: item.category, images: item.images, source: 'trendyol', stock: qty });
        added++;
      }
    }
    db.addLog('Mağaza katalog içe aktarıldı: ' + added + ' eklendi, ' + updated + ' güncellendi');
    res.json({ added, updated, total: list.length });
  } catch (e) {
    db.addLog('Trendyol katalog içe aktarma hatası: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/shop/admin/orders', (req, res) => {
  res.json(db.getShopOrders());
});

app.put('/api/shop/admin/orders/:id', (req, res) => {
  const order = db.updateShopOrder(req.params.id, req.body || {});
  if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
  if (req.body.cargoNumber) {
    db.addLog('Kargo numarası girildi: ' + order.orderNo + ' -> ' + req.body.cargoNumber);
  }
  res.json(order);
});

app.get('/api/shop/admin/settings', (req, res) => {
  res.json(db.getShopSettings());
});

app.put('/api/shop/admin/settings', (req, res) => {
  const settings = db.setShopSettings(req.body || {});
  res.json(settings);
});

app.get('/api/shop/admin/stats', (req, res) => {
  res.json(db.getShopStats());
});

// ---- Zamanlayıcı ----
let job = null;
let polling = false;

function getPollMs() {
  const s = db.getSettings().sync;
  const sec = Number(s.pollSeconds) || (Number(s.intervalMinutes) > 0 ? Number(s.intervalMinutes) * 60 : 30);
  return Math.max(5, sec) * 1000;
}

async function runCheck() {
  if (polling) return;
  polling = true;
  try {
    for (const kind of ['trendyol', 'hepsiburada']) {
      try {
        await sync.syncMarketplace(kind);
      } catch (e) {
        db.addLog(kind + ' senkron hatası: ' + e.message);
      }
    }
    try {
      await sync.checkStocks();
    } catch (e) {
      db.addLog('Stok kontrol hatası: ' + e.message);
    }
    try {
      await sync.checkQuestions();
    } catch (e) {
      db.addLog('Soru kontrol hatası: ' + e.message);
    }
  } finally {
    polling = false;
  }
}

function scheduleCron() {
  if (job) clearInterval(job);
  const ms = getPollMs();
  job = setInterval(runCheck, ms);
  db.addLog('Zamanlayıcı ayarlandı: her ' + ms / 1000 + ' saniyede bir kontrol');
}

const port = process.env.PORT || 3000;

async function start() {
  await backup.restore();
  db.load();
  app.listen(port, async () => {
  console.log('');
  console.log('=============================================');
  console.log('  STOK TAKİP ÇALIŞIYOR');
  console.log('  Tarayıcıda aç: http://localhost:' + port);
  console.log('=============================================');
  console.log('');
  db.addLog('Uygulama başlatıldı (port ' + port + ')');
  scheduleCron();
  telegramBot.start();
  for (const kind of ['trendyol', 'hepsiburada']) {
    try {
      await sync.syncMarketplace(kind);
    } catch (e) {
      db.addLog(kind + ' senkron hatası: ' + e.message);
    }
  }
  try {
    await sync.checkStocks();
  } catch (e) {
    db.addLog('Stok kontrol hatası: ' + e.message);
  }
  try {
    await sync.checkQuestions();
  } catch (e) {
    db.addLog('Soru kontrol hatası: ' + e.message);
  }
  });
}

start();
