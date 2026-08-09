const db = require('../db');
const trendyol = require('./trendyol');
const hepsiburada = require('./hepsiburada');
const pttavm = require('./pttavm');
const idefix = require('./idefix');
const n11 = require('./n11');
const ciceksepeti = require('./ciceksepeti');
const notifier = require('./notifier');

const MARKETS = ['trendyol', 'hepsiburada', 'pttavm', 'idefix', 'n11', 'ciceksepeti'];

const FAIL_ALERT_THRESHOLD = 3;
const marketFailCount = {};
const marketFailAlerted = {};

function marketFailed(kind) {
  marketFailCount[kind] = (marketFailCount[kind] || 0) + 1;
  if (marketFailCount[kind] >= FAIL_ALERT_THRESHOLD && !marketFailAlerted[kind]) {
    marketFailAlerted[kind] = true;
    notifier.notify(
      'PAZARYERİ ARZASI: ' + kindLabel(kind),
      '<h3>Dikkat! ' + kindLabel(kind) + ' tekrarlı arıza</h3><p>Son ' + FAIL_ALERT_THRESHOLD + ' denemede başarısız. Sistem diğer pazaryerlerini çalıştırmaya devam ediyor.</p>',
      'PAZARYERİ ARZASI: ' + kindLabel(kind) + ' son ' + FAIL_ALERT_THRESHOLD + ' denemede başarısız oldu.'
    );
  }
}

function marketOk(kind) {
  marketFailCount[kind] = 0;
  marketFailAlerted[kind] = false;
}

const modules = {
  trendyol,
  hepsiburada,
  pttavm,
  idefix,
  n11,
  ciceksepeti
};

const LABELS = {
  trendyol: 'Trendyol',
  hepsiburada: 'Hepsiburada',
  pttavm: 'PTT AVM',
  idefix: 'idefix',
  n11: 'N11',
  ciceksepeti: 'Çiçeksepeti'
};

function kindLabel(kind) {
  return LABELS[kind] || kind;
}

function stockField(kind) {
  return kind + 'Stock';
}

function notifiedField(kind) {
  return kind + 'Notified';
}

function marketCfg(kind) {
  return db.getSettings()[kind] || {};
}

function marketConfigured(kind) {
  const cfg = marketCfg(kind);
  if (kind === 'trendyol') return !!(cfg.apiKey && cfg.apiSecret && cfg.sellerId);
  if (kind === 'hepsiburada') return !!(cfg.username && cfg.password);
  if (kind === 'pttavm') return !!(cfg.apiKey && cfg.accessToken);
  if (kind === 'idefix') return !!(cfg.apiKey && cfg.apiSecret && cfg.vendorId);
  if (kind === 'n11') return !!(cfg.appKey && cfg.appSecret);
  if (kind === 'ciceksepeti') return !!cfg.apiKey;
  return false;
}

function marketConfiguredKinds() {
  return MARKETS.filter(marketConfigured);
}

async function fetchMarketStockMap(kind) {
  const cfg = marketCfg(kind);
  const mod = modules[kind];
  if (kind === 'trendyol') return mod.fetchStock(cfg.sellerId, cfg.apiKey, cfg.apiSecret);
  if (kind === 'hepsiburada') return mod.fetchStock(cfg.username, cfg.password);
  return mod.fetchStock(cfg);
}

async function fetchMarketProducts(kind) {
  const cfg = marketCfg(kind);
  const mod = modules[kind];
  if (kind === 'trendyol') {
    const stockMap = await mod.fetchStock(cfg.sellerId, cfg.apiKey, cfg.apiSecret);
    const byBarcode = new Map();
    const bySku = new Map();
    for (const [barcode, qty] of stockMap.entries()) {
      const key = String(barcode).trim();
      const rec = { barcode: key, sku: key, qty, price: null };
      byBarcode.set(key, rec);
      bySku.set(key, rec);
    }
    return { byBarcode, bySku };
  }
  if (kind === 'hepsiburada') return mod.fetchProducts(cfg.username, cfg.password);
  return mod.fetchProducts(cfg);
}

async function updateMarketStock(kind, item, target) {
  const cfg = marketCfg(kind);
  const mod = modules[kind];
  if (kind === 'trendyol') return mod.updateStock(cfg.sellerId, cfg.apiKey, cfg.apiSecret, item.barcode, target);
  if (kind === 'hepsiburada') return mod.updateStock(cfg.username, cfg.password, item.sku, target, item.price);
  if (kind === 'pttavm') return mod.updateStock(cfg, item.barcode, target);
  if (kind === 'idefix') return mod.updateStock(cfg, item.barcode, target, item.price, item);
  if (kind === 'n11') return mod.updateStock(cfg, item.sku, target);
  if (kind === 'ciceksepeti') return mod.updateStock(cfg, item.sku, target);
  throw new Error('Bilinmeyen pazar yeri: ' + kind);
}

let lastSyncOkLogTs = 0;

const PRICE_REFRESH_MINUTES = 30;
let lastTrendyolPriceRefresh = 0;

async function syncTrendyolPrices() {
  const cfg = marketCfg('trendyol');
  if (!cfg.apiKey || !cfg.apiSecret || !cfg.sellerId) return;
  if (Date.now() - lastTrendyolPriceRefresh < PRICE_REFRESH_MINUTES * 60 * 1000) return;
  lastTrendyolPriceRefresh = Date.now();

  let priceMap;
  try {
    priceMap = await trendyol.fetchPriceMap(cfg.sellerId, cfg.apiKey, cfg.apiSecret);
  } catch (e) {
    db.addLog('Trendyol fiyat çekme hatası: ' + e.message);
    return;
  }

  const now = new Date().toISOString();
  const changes = [];
  for (const [barcode, info] of priceMap.entries()) {
    const p = db.findProductByBarcode(barcode);
    if (!p) continue;
    const oldPrice = p.price !== null && p.price !== undefined ? Number(p.price) : null;
    const newPrice = Number(info.price);
    if (oldPrice !== null && oldPrice !== newPrice) {
      changes.push(barcode + ': ' + oldPrice + ' -> ' + newPrice);
    }
    db.updateProduct(p.id, { price: newPrice, listPrice: Number(info.listPrice) || newPrice, priceUpdatedAt: now });
  }

  if (changes.length > 0) {
    db.addLog('Trendyol ' + changes.length + ' ürünün fiyatı güncellendi: ' + changes.join(', '));
    notifier.notify(
      'TRENDYOL FİYAT GÜNCELLEMESİ (' + changes.length + ')',
      '<h3>Fiyat güncellendi</h3><p>' + changes.map(c => '<li>' + c + ' TL</li>').join('') + '</p>',
      'FİYAT GÜNCELLEMESİ (' + changes.length + ')\n' + changes.join('\n') + ' TL'
    );
  }
}

async function syncMarketplace(kind) {
  if (!marketConfigured(kind)) {
    db.addLog(kindLabel(kind) + ' ayarları eksik, senkron atlandı');
    return { skipped: true, reason: kindLabel(kind) + ' API ayarları eksik' };
  }

  let stockMap;
  try {
    stockMap = await fetchMarketStockMap(kind);
    marketOk(kind);
  } catch (e) {
    marketFailed(kind);
    db.addLog(kindLabel(kind) + ' stok çekme hatası: ' + e.message);
    return { error: e.message };
  }

  if (kind === 'trendyol') {
    try {
      await syncTrendyolPrices();
    } catch (e) {
      db.addLog('Trendyol fiyat senkronu hatası: ' + e.message);
    }
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
      if (oldQty !== null && oldQty !== undefined && Number(oldQty) === qty) {
        if (kind === 'trendyol') {
          const seenTs = existing.lastSeenAt ? new Date(existing.lastSeenAt).getTime() : 0;
          if (Date.now() - seenTs > 10 * 60 * 1000) {
            db.updateProduct(existing.id, { lastSeenAt: now });
          }
        }
        continue;
      }
      db.updateProduct(existing.id, { [stockField(kind)]: qty, lastSync: now, lastSeenAt: now });
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
          db.addDailySale({
            name: existing.name,
            barcode,
            market: kindLabel(kind),
            qty: diff,
            ts: now
          });
        }
      }
    } else {
      db.addProduct({ name: barcode + ' (API)', barcode, [stockField(kind)]: qty, lastSeenAt: now });
      created++;
      changed = true;
    }
  }

  if (changed) {
    db.addLog(kindLabel(kind) + ' senkronu tamam: ' + updated + ' güncellendi, ' + created + ' yeni eklendi');
    lastSyncOkLogTs = Date.now();
  } else if (Date.now() - lastSyncOkLogTs > 5 * 60 * 1000) {
    lastSyncOkLogTs = Date.now();
    db.addLog(kindLabel(kind) + ' senkronu tamam (değişiklik yok)');
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
    for (const kind of MARKETS) {
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

async function syncSharedStock() {
  const kinds = marketConfiguredKinds();
  if (kinds.length < 2) {
    const configured = kinds.length === 1 ? kindLabel(kinds[0]) + ' ayarları var; en az 2 pazar yeri gerekiyor' : 'Pazar yeri API ayarları eksik';
    return { skipped: true, reason: configured };
  }

  const byMarket = new Map();
  const failures = [];
  for (const kind of kinds) {
    try {
      byMarket.set(kind, await fetchMarketProducts(kind));
      marketOk(kind);
    } catch (e) {
      marketFailed(kind);
      failures.push(kindLabel(kind));
      db.addLog(kindLabel(kind) + ' ortak stok okunamadı (arıza atlandı): ' + e.message);
    }
  }
  const reachable = [...byMarket.keys()];
  if (reachable.length < 2) {
    db.addLog('Ortak stok senkronu: yeterli pazar erişilemedi (' + reachable.length + '): ' + failures.join(', '));
    return { skipped: true, reason: 'Yeterli pazar erişilemedi: ' + failures.join(', '), failures };
  }

  const barcodeKinds = new Map();
  for (const kind of kinds) {
    const maps = byMarket.get(kind);
    for (const barcode of maps.byBarcode.keys()) {
      if (!barcodeKinds.has(barcode)) barcodeKinds.set(barcode, []);
      barcodeKinds.get(barcode).push(kind);
    }
  }

  let written = 0;
  let matched = 0;
  let skippedSingle = 0;
  const errors = [];
  const now = new Date().toISOString();

  for (const [barcode, presentKinds] of barcodeKinds.entries()) {
    if (presentKinds.length < 2) {
      skippedSingle++;
      continue;
    }
    matched++;

    const entries = [];
    for (const kind of presentKinds) {
      const rec = byMarket.get(kind).byBarcode.get(barcode);
      if (rec && rec.qty !== null && rec.qty !== undefined) {
        entries.push({ kind, rec, qty: Number(rec.qty) });
      }
    }
    if (entries.length < 2) {
      skippedSingle++;
      continue;
    }

    const existing = db.findProductByBarcode(barcode);
    const shared = existing ? existing.sharedStock : null;

    if (existing && existing.price !== null && existing.price !== undefined) {
      for (const e of entries) {
        if (e.rec) e.rec.price = Number(existing.price);
      }
    }

    let target;
    if (shared === null || shared === undefined) {
      const ty = entries.find(e => e.kind === 'trendyol');
      if (!ty) continue;
      target = ty.qty;
    } else {
      const changed = entries.filter(e => e.qty !== Number(shared));
      if (changed.length === 0) continue;
      if (changed.length === 1) {
        target = changed[0].qty;
      } else {
        target = Math.min(...changed.map(e => e.qty));
      }
    }

    const touched = entries.filter(e => e.qty !== target);
    if (touched.length === 0) continue;

    let ok = true;
    for (const e of touched) {
      try {
        await updateMarketStock(e.kind, e.rec, target);
      } catch (err) {
        ok = false;
        errors.push(barcode + ' [' + kindLabel(e.kind) + ']: ' + err.message);
      }
    }

    if (ok) {
      const update = { sharedStock: target, lastSync: now };
      for (const e of touched) {
        update[stockField(e.kind)] = target;
      }
      if (existing) {
        db.updateProduct(existing.id, update);
      }
      written++;
    }
  }

  if (written > 0 || errors.length > 0 || failures.length > 0) {
    const msg = 'Ortak stok senkronu: ' + written + ' ürün eşitlendi, ' +
      matched + ' eşleşti, ' + skippedSingle + ' tek pazarda listelenen atlandı';
    db.addLog(msg +
      (errors.length > 0 ? ', ' + errors.length + ' hata' : '') +
      (failures.length > 0 ? ', ' + failures.length + ' pazar arızalı: ' + failures.join(', ') : ''));
  }

  return { written, matched, skippedSingle, errors, failures };
}

const PUSH_TARGETS = ['hepsiburada', 'pttavm', 'idefix', 'n11', 'ciceksepeti'];

function pushMapping(kind) {
  const pp = db.getSettings().productPush || {};
  return (pp.mappings && pp.mappings[kind]) || {};
}

function mappingReady(kind, mapping) {
  if (kind === 'hepsiburada') return !!(mapping.categoryId && mapping.brand);
  if (kind === 'pttavm') return !!mapping.categoryId;
  if (kind === 'idefix') return !!(mapping.categoryId && mapping.brandId);
  if (kind === 'n11') return !!(mapping.categoryId && mapping.brand && mapping.shipmentTemplate);
  if (kind === 'ciceksepeti') return !!mapping.categoryId;
  return false;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

async function createMarketplaceProduct(kind, p) {
  const mod = modules[kind];
  return mod.createProduct(marketCfg(kind), p);
}

async function pushNewProducts() {
  const settings = db.getSettings();
  const pp = settings.productPush || {};
  if (!pp.enabled) {
    return { skipped: true, reason: 'Ürün yükleme kapalı' };
  }

  const tyCfg = settings.trendyol;
  if (!marketConfigured('trendyol')) {
    return { skipped: true, reason: 'Trendyol API ayarları eksik' };
  }

  const readyTargets = PUSH_TARGETS.filter(k =>
    marketConfigured(k) && mappingReady(k, pushMapping(k))
  );
  if (readyTargets.length === 0) {
    return { skipped: true, reason: 'Hedef pazar yeri için kategori eşlemesi girilmemiş' };
  }

  let catalog;
  try {
    catalog = await trendyol.fetchProductCatalog(tyCfg.sellerId, tyCfg.apiKey, tyCfg.apiSecret);
  } catch (e) {
    db.addLog('Ürün yükleme: Trendyol katalog hatası: ' + e.message);
    return { error: e.message };
  }

  let created = 0;
  const errors = [];
  const now = new Date().toISOString();

  for (const item of catalog) {
    const barcode = String(item.barcode || '').trim();
    if (!barcode) continue;
    const existing = db.findProductByBarcode(barcode);
    const pushed = (existing && existing.pushed) || {};

    for (const kind of readyTargets) {
      if (pushed[kind]) continue;
      const mapping = pushMapping(kind);

      const price = Number(item.price) || 0;
      const p = {
        barcode,
        title: item.name,
        description: decodeEntities(item.description),
        price,
        listPrice: Number(item.listPrice) || price,
        quantity: Number(item.quantity) || 0,
        images: item.images || [],
        vatRate: Number(item.vatRate) || Number(mapping.vatRate) || 20,
        brand: item.brand || mapping.brand || '',
        mapping
      };

      try {
        await createMarketplaceProduct(kind, p);
      } catch (e) {
        errors.push(barcode + ' [' + kindLabel(kind) + ']: ' + e.message);
        continue;
      }

      const nextPushed = { ...pushed, [kind]: true };
      if (existing) {
        db.updateProduct(existing.id, { pushed: nextPushed, lastSync: now });
      } else {
        db.addProduct({ name: p.title || barcode, barcode, pushed: nextPushed, trendyolStock: p.quantity, lastSync: now });
      }
      pushed[kind] = true;
      created++;
    }
  }

  db.addLog('Ürün yükleme tamam: ' + created + ' ürün diğer pazarlara eklendi' +
    (errors.length > 0 ? ', ' + errors.length + ' hata' : ''));
  return { created, errors };
}

module.exports = { syncMarketplace, checkStocks, checkQuestions, syncSharedStock, pushNewProducts, MARKETS, kindLabel, marketConfiguredKinds };
