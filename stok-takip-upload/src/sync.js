const db = require('../db');
const trendyol = require('./trendyol');
const hepsiburada = require('./hepsiburada');
const notifier = require('./notifier');

function kindLabel(kind) {
  return kind === 'trendyol' ? 'Trendyol' : 'Hepsiburada';
}

function stockField(kind) {
  return kind + 'Stock';
}

function notifiedField(kind) {
  return kind + 'Notified';
}

async function syncMarketplace(kind) {
  const settings = db.getSettings();
  let stockMap;

  if (kind === 'trendyol') {
    const cfg = settings.trendyol;
    if (!cfg.apiKey || !cfg.apiSecret || !cfg.sellerId) {
      db.addLog('Trendyol ayarları eksik, senkron atlandı');
      return { skipped: true, reason: 'Trendyol API ayarları eksik' };
    }
    stockMap = await trendyol.fetchStock(cfg.sellerId, cfg.apiKey, cfg.apiSecret);
  } else {
    const cfg = settings.hepsiburada;
    if (!cfg.username || !cfg.password) {
      db.addLog('Hepsiburada ayarları eksik, senkron atlandı');
      return { skipped: true, reason: 'Hepsiburada API ayarları eksik' };
    }
    stockMap = await hepsiburada.fetchStock(cfg.username, cfg.password);
  }

  const now = new Date().toISOString();
  let updated = 0;
  let created = 0;
  let changed = false;
  const sales = [];

  for (const [barcode, qty] of stockMap.entries()) {
    const existing = db.findProductByBarcode(barcode);
    if (existing) {
      const oldQty = existing[stockField(kind)];
      if (oldQty !== null && oldQty !== undefined && Number(oldQty) === qty) continue;
      db.updateProduct(existing.id, { [stockField(kind)]: qty, lastSync: now });
      updated++;
      changed = true;
      if (oldQty !== null && oldQty !== undefined) {
        const diff = Number(oldQty) - qty;
        if (diff > 0) {
          sales.push({
            name: existing.name,
            barcode,
            market: kindLabel(kind),
            diff,
            oldQty: Number(oldQty),
            newQty: qty
          });
        }
      }
    } else {
      db.addProduct({ name: barcode + ' (API)', barcode, [stockField(kind)]: qty });
      created++;
      changed = true;
    }
  }

  if (changed) {
    db.addLog(kindLabel(kind) + ' senkronu tamam: ' + updated + ' güncellendi, ' + created + ' yeni eklendi');
  }

  if (sales.length > 0) {
    for (const sale of sales) {
      await notifySale(sale);
    }
    db.addLog(sales.length + ' satış/azalma tespit edildi, bildirim gönderildi');
  }

  return { updated, created, sales: sales.length };
}

function notifySale(sale) {
  const subject = 'Satış: ' + sale.name + ' (' + sale.market + ')';
  const html =
    '<h3>Bir satış gerçekleşti</h3>' +
    '<p><b>Ürün:</b> ' + sale.name + '</p>' +
    '<p><b>Barkod:</b> ' + sale.barcode + '</p>' +
    '<p><b>Pazar yeri:</b> ' + sale.market + '</p>' +
    '<p><b>Satılan adet:</b> ' + sale.diff + '</p>' +
    '<p><b>Önceki stok:</b> ' + sale.oldQty + ' → <b>Yeni stok:</b> ' + sale.newQty + '</p>';
  const text =
    'SATIS: ' + sale.name + ' (' + sale.market + ')\n' +
    'Barkod: ' + sale.barcode + '\n' +
    'Satilan adet: ' + sale.diff + '\n' +
    'Stok: ' + sale.oldQty + ' -> ' + sale.newQty;
  return notifier.notify(subject, html, text);
}

async function checkStocks() {
  const settings = db.getSettings();
  const threshold = Math.max(0, Number(settings.sync.threshold) || 1);
  const products = db.getProducts();
  for (const p of products) {
    for (const kind of ['trendyol', 'hepsiburada']) {
      const qty = p[stockField(kind)];
      if (qty === null || qty === undefined) continue;
      const stock = Number(qty);

      if (stock <= threshold) {
        if (!p[notifiedField(kind)]) {
          db.updateProduct(p.id, { [notifiedField(kind)]: true });
          const market = kindLabel(kind);
          const subject = 'KRİTİK STOK: ' + p.name + ' (' + market + ')';
          const html =
            '<h3>Dikkat! Stok kritik seviyede</h3>' +
            '<p><b>Ürün:</b> ' + p.name + '</p>' +
            '<p><b>Barkod:</b> ' + p.barcode + '</p>' +
            '<p><b>Pazar yeri:</b> ' + market + '</p>' +
            '<p><b>Kalan stok:</b> ' + stock + '</p>' +
            '<p style="color:#c0392b"><b>' + market + ' mağazasında stok ' + threshold + ' ve altına düştü. Lütfen stok girişi yap.</b></p>';
          const text =
            'KRITIK STOK: ' + p.name + ' (' + market + ')\n' +
            'Barkod: ' + p.barcode + '\n' +
            'Kalan stok: ' + stock + '\n' +
            market + ' magazasinda stok ' + threshold + ' ve altina dustu. Lutfen stok girisi yap.';
          await notifier.notify(subject, html, text);
        }
      } else {
        if (p[notifiedField(kind)]) {
          db.updateProduct(p.id, { [notifiedField(kind)]: false });
        }
      }
    }
  }
}

async function checkQuestions() {
  const settings = db.getSettings();
  const cfg = settings.trendyol;
  if (!cfg.apiKey || !cfg.apiSecret || !cfg.sellerId) {
    return { skipped: true, reason: 'Trendyol API ayarları eksik' };
  }

  let questions;
  try {
    questions = await trendyol.fetchQuestions(cfg.sellerId, cfg.apiKey, cfg.apiSecret);
  } catch (e) {
    db.addLog('Trendyol soru çekme hatası: ' + e.message);
    return { error: e.message };
  }

  const notified = new Set(db.getQnaNotifiedIds());
  const fresh = questions.filter(q => !notified.has(q.id));
  let sent = 0;

  for (const q of fresh) {
    const subject = 'YENİ SORU: ' + q.productName;
    const html =
      '<h3>Trendyol üzerinden yeni bir ürün sorusu geldi</h3>' +
      '<p><b>Ürün:</b> ' + q.productName + '</p>' +
      '<p><b>Soru:</b> ' + q.question + '</p>' +
      '<p><b>Tarih:</b> ' + q.createdDate + '</p>' +
      '<p><b>Soru ID:</b> ' + q.id + '</p>' +
      '<p style="color:#c0392b"><b>Lütfen Trendyol panelinden cevaplayın.</b></p>';
    const text =
      'YENI SORU (Trendyol)\n' +
      'Urun: ' + q.productName + '\n' +
      'Soru: ' + q.question + '\n' +
      'Tarih: ' + q.createdDate + '\n' +
      'Lutfen Trendyol panelinden cevaplayin.';
    const result = await notifier.notify(subject, html, text);
    if ((result.email && result.email.sent) || (result.telegram && result.telegram.sent)) sent++;
  }

  if (fresh.length > 0) {
    db.addQnaNotifiedIds(fresh.map(q => q.id));
    db.addLog(fresh.length + ' yeni soru bulundu, ' + sent + ' bildirim gönderildi');
  }

  return { total: questions.length, fresh: fresh.length, sent };
}

async function syncTrendyolToHepsiburada() {
  const settings = db.getSettings();
  const tyCfg = settings.trendyol;
  const hbCfg = settings.hepsiburada;

  if (!tyCfg.apiKey || !tyCfg.apiSecret || !tyCfg.sellerId) {
    return { skipped: true, reason: 'Trendyol API ayarları eksik' };
  }
  if (!hbCfg.username || !hbCfg.password) {
    return { skipped: true, reason: 'Hepsiburada API ayarları eksik' };
  }

  let tyStocks;
  let hbProducts;
  try {
    tyStocks = await trendyol.fetchStock(tyCfg.sellerId, tyCfg.apiKey, tyCfg.apiSecret);
    hbProducts = await hepsiburada.fetchProducts(hbCfg.username, hbCfg.password);
  } catch (e) {
    db.addLog('Trendyol→Hepsiburada senkron hatası: ' + e.message);
    return { error: e.message };
  }

  const byBarcode = hbProducts.byBarcode;
  const bySku = hbProducts.bySku;
  let updated = 0;
  let matched = 0;
  let notListed = 0;
  const errors = [];

  for (const [barcode, qty] of tyStocks.entries()) {
    const key = String(barcode).trim();
    const hbItem = byBarcode.get(key) || bySku.get(key);
    if (!hbItem) {
      notListed++;
      continue;
    }
    matched++;
    try {
      await hepsiburada.updateStock(hbCfg.username, hbCfg.password, hbItem.sku, qty, hbItem.price);
      updated++;
      const existing = db.findProductByBarcode(key);
      if (existing) {
        db.updateProduct(existing.id, { hepsiburadaStock: qty, lastSync: new Date().toISOString() });
      }
    } catch (e) {
      errors.push(key + ': ' + e.message);
    }
  }

  if (updated > 0 || errors.length > 0) {
    const msg = 'Trendyol→Hepsiburada stok yazıldı: ' + updated + ' güncellendi, ' +
      matched + ' eşleşti, ' + notListed + ' HB\'de listelenmiyor (atlandı)';
    db.addLog(msg + (errors.length > 0 ? ', ' + errors.length + ' hata' : ''));
  }

  return { updated, matched, notListed, errors };
}

module.exports = { syncMarketplace, checkStocks, checkQuestions, syncTrendyolToHepsiburada };
