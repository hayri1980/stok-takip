require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const sync = require('./src/sync');
const notifier = require('./src/notifier');
const telegramBot = require('./src/telegram');
const backup = require('./src/backup');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  });
}

start();
