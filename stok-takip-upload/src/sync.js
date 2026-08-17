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

const PTT_TOKEN_ALERTED = {};

function marketFailed(kind, errMsg) {
  marketFailCount[kind] = (marketFailCount[kind] || 0) + 1;
  if (kind === 'pttavm' && errMsg && /invalid|expired|unauthorized|401/i.test(errMsg) && !PTT_TOKEN_ALERTED[kind]) {
    PTT_TOKEN_ALERTED[kind] = true;
    const tokenMsg = 'PTT AVM TOKEN SURESI DOLDU! Panelden (Merchant Panel > Hesap Ayarlari > Entegrasyon Bilgileri > Self Entegrator) yeni token uret ve paylas.';
    notifier.notify(
      'PTT AVM TOKEN SURESI DOLDU',
      '<h3>PTT AVM access token suresi doldu</h3><p>Panelden yeni token uret: Merchant Panel > Hesap Ayarlari > Entegrasyon Bilgileri > Self Entegrator. Yeni tokeni paylas.</p>',
      tokenMsg
    );
  }
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
  if (kind === 'pttavm') PTT_TOKEN_ALERTED[kind] = false;
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
  if (kind === 'hepsiburada') return !!((cfg.merchantId || cfg.username) && cfg.password);
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
  if (kind === 'hepsiburada') return mod.fetchStock(cfg);
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
  if (kind === 'hepsiburada') return mod.fetchProducts(cfg);
  return mod.fetchProducts(cfg);
}

async function updateMarketStock(kind, item, target) {
  const cfg = marketCfg(kind);
  const mod = modules[kind];
  if (kind === 'trendyol') return mod.updateStock(cfg.sellerId, cfg.apiKey, cfg.apiSecret, item.barcode, target);
  if (kind === 'hepsiburada') return mod.updateStock(cfg, item.sku, target, item.price);
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

const skipLogTs = {};

async function syncMarketplace(kind) {
  if (!marketConfigured(kind)) {
    const now = Date.now();
    if (now - (skipLogTs[kind] || 0) > 10 * 60 * 1000) {
      db.addLog(kindLabel(kind) + ' ayarları eksik, senkron atlandı');
      skipLogTs[kind] = now;
    }
    return { skipped: true, reason: kindLabel(kind) + ' API ayarları eksik' };
  }

  let stockMap;
  try {
    stockMap = await fetchMarketStockMap(kind);
    marketOk(kind);
  } catch (e) {
    marketFailed(kind, e.message);
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
  const ignored = new Set((db.getSettings().ignoreBarcodes || []).map(normalizeBarcodeKey));
  let changed = false;
  const sales = [];

  for (const [barcode, qty] of stockMap.entries()) {
    let existing = db.findProductByBarcode(barcode);
    if (!existing) {
      existing = db.getProducts().find(p => p.idefixBarcode === barcode) || null;
    }
    if (!existing && kind === 'idefix') {
      // idefix barkodu 6 haneye pad'lenmiş olabilir (010fx5 vs 10fx5) → baştaki sıfırları kaldırıp eşleştir.
      const plain = String(barcode).replace(/^0+/, '');
      existing = db.getProducts().find(p => normalizeBarcodeKey(p.barcode) === normalizeBarcodeKey(plain)) || null;
    }
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
      const oldQtyNum = (oldQty !== null && oldQty !== undefined) ? Number(oldQty) : null;
      const diff = oldQtyNum !== null ? oldQtyNum - qty : 0;
      const writeRec = oldQtyNum !== null ? getStockWrite(kind, barcode) : null;
      const withinGrace = !!writeRec && Date.now() - writeRec.ts < STOCK_WRITE_GRACE_MS;
      if (withinGrace) {
        // Yazım penceresi: bu pazaryerine yakın zamanda stok yazıldı; okunan değer henüz
        // yansımamış eski/geçici olabilir (özellikle idefix asenkron batch gecikmesi).
        // Pencere içinde okunan fark satış sayılmaz; DB yazılan değerde tutulur.
        db.updateProduct(existing.id, { lastSeenAt: now, lastSync: now });
      } else {
        db.updateProduct(existing.id, { [stockField(kind)]: qty, lastSync: now, lastSeenAt: now });
        // Satış: yazım penceresi DIŞINDA düşüş → gerçek satış.
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
            price: existing.price,
            cost: existing.cost,
            ts: now
          });
        }
      }
      updated++;
      changed = true;
    } else {
      if (ignored.has(normalizeBarcodeKey(barcode))) continue;
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
    const salesNotify = (db.getSettings().notifications || {}).sales !== false;
    if (salesNotify) {
      for (const sale of sales) {
        await notifySale(sale);
      }
    }
    db.addLog(sales.length + ' satış/azalma tespit edildi' + (salesNotify ? ', bildirim gönderildi' : ', bildirim kapalı'));
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

let lastFinanceCheckTs = 0;

async function checkFinancialTransfers() {
  const cfg = marketCfg('trendyol');
  if (!(cfg.apiKey && cfg.apiSecret && cfg.sellerId)) return { skipped: true };
  if (Date.now() - lastFinanceCheckTs < 30 * 60 * 1000) return { skipped: true, reason: 'henüz zamanı değil' };
  lastFinanceCheckTs = Date.now();
  let transfers;
  try {
    transfers = await trendyol.fetchOtherFinancials(cfg.sellerId, cfg.apiKey, cfg.apiSecret, 'WireTransfer', 14);
  } catch (e) {
    db.addLog('Finans çekme hatası: ' + e.message);
    return { error: e.message };
  }
  const seen = new Set(db.getFinanceNotifiedIds());
  const fresh = (transfers || []).filter(t => t.id && !seen.has(String(t.id)));
  if (fresh.length === 0) return { fresh: 0 };
  db.addFinanceNotifiedIds(fresh.map(t => t.id));
  for (const t of fresh) {
    const amount = Number(t.credit) || 0;
    const date = new Date(Number(t.transactionDate)).toLocaleDateString('tr-TR');
    const subject = 'PARA AKTARIMI: ' + amount + ' TL';
    const text = 'PARA AKTARIMI (banka)\nMiktar: ' + amount + ' TL\nTarih: ' + date +
      (t.description ? '\n' + t.description : '');
    const html = '<h3>Banka para aktarımı gerçekleşti</h3><p><b>Miktar:</b> ' + amount + ' TL</p>' +
      '<p><b>Tarih:</b> ' + date + '</p>';
    await notifier.notify(subject, html, text);
  }
  db.addLog(fresh.length + ' yeni para aktarımı tespit edildi, bildirim gönderildi');
  return { fresh: fresh.length };
}

function toIsoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

let lastOrderCheckTs = 0;

// WhatsApp kargo barkodu GÖNDERİM PENCERESİ (kargocuya teslim zamanına göre)
// Hafta içi (Pzt-Cum): 09:00-16:00  | Cumartesi: 09:00-14:00 | Pazar: kapalı (birikir)
function isWhatsAppSendWindow() {
  const now = new Date();
  const day = now.getDay(); // 0=Pazar, 6=Cumartesi
  const mins = now.getHours() * 60 + now.getMinutes();
  if (day === 0) return false;
  if (day === 6) return mins >= 9 * 60 && mins < 14 * 60;
  return mins >= 9 * 60 && mins < 16 * 60;
}

async function checkOrders() {
  if (Date.now() - lastOrderCheckTs < 15 * 1000) return { skipped: true, reason: 'henüz zamanı değil' };
  lastOrderCheckTs = Date.now();

  const endDate = new Date();
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fresh = [];
  const allOrders = [];
  const notified = new Set(db.getOrderNotifiedIds());
  const firstRun = notified.size === 0;

  // Hepsiburada OMS — siparişler PAKET (package) ucundan gelir; timespan ile (begindate/enddate 0 döner!)
  const hb = db.getSettings().hepsiburada || {};
  if ((hb.merchantId || hb.username) && hb.password) {
    try {
      const user = hb.merchantId || hb.username;
      const headers = {
        'Authorization': 'Basic ' + Buffer.from(user + ':' + hb.password).toString('base64'),
        'User-Agent': hb.userAgent || 'caparici_dev',
        'Accept': 'application/json'
      };
      // timespan=336 → son 14 gün (dokümana göre packages ucu timespan kullanır)
      const url = 'https://oms-external.hepsiburada.com/packages/merchantid/' + encodeURIComponent(user) +
        '?timespan=336&limit=100&Offset=0';
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : ((data && data.items) || []);
        for (const o of list) {
          const id = String(o.orderNumber || o.packageNumber || o.id || '');
          if (!id) continue;
          // kargo takip no: barcode (paketin barkodu) öncelik; yoksa trackingInfoCode
          const cargoTrack = o.barcode || o.trackingInfoCode || o.packageNumber || '';
          // order için paketi olduğu gibi taşı (id = paket no; market öneki notified'da var)
          const order = { ...o, orderNumber: String(o.orderNumber || o.packageNumber || id), cargoTrackingNumber: cargoTrack, cargoProviderName: o.cargoCompany || 'Hepsiburada', desi: o.totalDeci || o.deci || 1, lines: Array.isArray(o.items) ? o.items : [] };
          const fid = String(o.orderNumber || o.packageNumber || id);
          allOrders.push({ market: 'Hepsiburada', id: fid, order });
          if (!notified.has(id)) fresh.push({ market: 'Hepsiburada', id: fid, order });
        }
      }
    } catch (e) {
      db.addLog('HB sipariş çekme hatası: ' + e.message);
    }
  }

  // idefix OMS — shipment list (cargoTrackingNumber kargoya verilince dolar; WhatsApp barkodu için uygun)
  const ix = db.getSettings().idefix || {};
  if (ix.apiKey && ix.apiSecret && ix.vendorId) {
    try {
      const shipments = await idefix.fetchOrders(ix);
      for (const o of shipments) {
        const id = String(o.id || o.orderNumber || '');
        if (!id) continue;
        // idefix barkodu "IPS" ön eki + shipment id (ör. IPS63396338). cargoTrackingNumber
        // kargoya verilince dolar; yoksa IPS+id ile barkod üretilir (şoförün barkodu eşleşsin diye).
        const ipsBarcode = String(o.cargoTrackingNumber || '').startsWith('IPS')
          ? String(o.cargoTrackingNumber)
          : ('IPS' + String(o.id || ''));
        const order = { ...o, orderNumber: String(o.orderNumber || id), cargoTrackingNumber: ipsBarcode, cargoProviderName: o.cargoCompany || 'idefix', desi: 1, lines: Array.isArray(o.items) ? o.items : [] };
        allOrders.push({ market: 'idefix', id, order });
        if (!notified.has(id)) fresh.push({ market: 'idefix', id, order });
      }
    } catch (e) {
      db.addLog('idefix sipariş çekme hatası: ' + e.message);
    }
  }

  // Trendyol sipariş (doğru uç /orders; /packages kapatılmış)
  const ty = db.getSettings().trendyol || {};
  if (ty.apiKey && ty.apiSecret && ty.sellerId) {
    try {
      const auth = 'Basic ' + Buffer.from(ty.apiKey + ':' + ty.apiSecret).toString('base64');
      const qs = new URLSearchParams({ startDate: String(startDate.getTime()), endDate: String(endDate.getTime()), page: '0', size: '100' });
      const res = await fetch('https://apigw.trendyol.com/integration/order/sellers/' + ty.sellerId + '/orders?' + qs, {
        headers: { 'Authorization': auth, 'x-seller-id': String(ty.sellerId), 'User-Agent': String(ty.sellerId) + ' - SelfIntegration' }
      });
      if (res.ok) {
        const data = await res.json();
        for (const o of (data && data.content) || []) {
          const id = String(o.orderNumber || o.id || '');
          if (!id) continue;
          allOrders.push({ market: 'Trendyol', id, order: o });
          if (!notified.has(id)) fresh.push({ market: 'Trendyol', id, order: o });
        }
      }
    } catch (e) {
      db.addLog('Trendyol sipariş çekme hatası: ' + e.message);
    }
  }

  if (fresh.length) db.addOrderNotifiedIds(fresh.map(f => f.id));

  if (firstRun) {
    // İlk çalıştırma: mevcut siparişleri bildirmeden kaydet (spam olmasın)
    db.addLog('Sipariş bildirimi hazır: ' + fresh.length + ' mevcut sipariş kaydedildi (ilk çalıştırma)');
    return { total: fresh.length, seeded: true };
  }

  let sent = 0;
  for (const f of fresh) {
    const o = f.order || {};
    const lines = ['YENI SIPARIS (' + f.market + ')', 'Siparis no: ' + f.id];
    const items = o.lines || o.items || o.orderLines || o.lineItems || [];
    if (items.length) {
      for (const li of items.slice(0, 5)) {
        const nm = li.productName || li.name || li.merchantSku || li.barcode || '';
        const q = Number(li.quantity || li.quantityPurchased || 1);
        const unit = Number(li.lineUnitPrice || li.unitPrice || li.price || li.unitPriceAfterDiscount || 0);
        const total = unit * q;
        lines.push('- ' + nm + ' x' + q + (unit ? ' = ' + total.toFixed(2) + ' TL (birim ' + unit.toFixed(2) + ' TL)' : ''));
      }
    } else if (o.productName || o.merchantSku) {
      lines.push('- ' + (o.productName || o.merchantSku) + (o.quantity ? ' x' + o.quantity : ''));
    }
    lines.push('Tutar: ' + (o.totalPrice || o.amount || o.packageTotalPrice || o.totalAmount || '?') + ' TL');

    // Kargo takip bilgisi (Trendyol: cargoTrackingNumber / cargoProviderName)
    const trackingNo = o.cargoTrackingNumber || o.trackingNumber || o.shipmentId || '';
    const cargoProvider = o.cargoProviderName || o.cargoProvider || '';
    if (trackingNo) {
      lines.push('Kargo takip no: ' + trackingNo + (cargoProvider ? ' (' + cargoProvider + ')' : ''));
    }

    try {
      const r = await notifier.notify(
        'YENİ SİPARİŞ (' + f.market + '): ' + f.id,
        '<h3>Yeni sipariş</h3>' + lines.map(l => '<p>' + l + '</p>').join(''),
        lines.join('\n')
      );
      if (r && r.telegram && r.telegram.sent) sent++;
    } catch (e) {
      db.addLog('Sipariş bildirimi gönderilemedi: ' + e.message);
    }
  }
  if (fresh.length) db.addLog(fresh.length + ' yeni sipariş bulundu, ' + sent + ' bildirim gönderildi');

  // WhatsApp barkod gönderimi — ZAMAN PENCERELİ + KUYRUKLU.
  // Kural (kargocu anlaşması, kullanıcı isteği):
  //  - Hafta içi: 09:00-16:00 arası gönderim açık; 16:00 sonrası gelenler kuyruğa → ertesi sabah.
  //  - Cumartesi: 09:00-14:00 açık.
  //  - Pazar: kapalı → birikir → Pazartesi sabah 09:00 gönderilir.
  //  - Telefon kapalıysa gönderim başarısız olur; kuyrukta kalır ve ne zaman açılırsa (pencere
  //    içinde) otomatik gönderilir. Kuyruk whatsapp.pendingOrderIds'te tutulur (kalıcı).
  const wcfgAll = (db.getSettings().whatsapp || {});
  const waTargetPresent = !!(wcfgAll.targetNumber || wcfgAll.targetGroupId || wcfgAll.targetGroupName);
  if (wcfgAll.enabled && wcfgAll.autoSend === true && waTargetPresent) {
    let waNotified = new Set(wcfgAll.notifiedOrderIds || []);
    let pending = Array.isArray(wcfgAll.pendingOrderIds) ? wcfgAll.pendingOrderIds : [];
    const win = isWhatsAppSendWindow();
    let waSent = 0;
    const pendingSet = new Map(pending.map(p => [p.nid, p]));

    async function trySend(fe) {
      const ba = require('./barcode');
      const wa = require('./whatsapp');
      const o = fe.order || {};
      const trackingNo = o.cargoTrackingNumber || o.trackingNumber || o.shipmentId || '';
      if (!trackingNo) return false;
      const png = await ba.makeBarcode(trackingNo);
      const caption = (o._market || 'Pazaryeri') + '\nDesi: 1';
      const waRes = await wa.sendImage(wcfgAll.targetNumber, { buffer: png, filename: 'kargo.png' }, caption);
      return waRes.sent;
    }

    // 1) Bekleyen kuyruktaki siparişleri gönder (telefon açılmış/bağlanmış olabilir)
    if (win) {
      const remaining = [];
      for (const p of pending) {
        if (waNotified.has(p.nid)) continue;
        const fe = { order: { cargoTrackingNumber: p.trackingNo, _market: p.market } };
        try {
          const ok = await trySend(fe);
          if (ok) {
            waNotified.add(p.nid);
            waSent++;
            db.addLog('WhatsApp kargo barkodu (kuyruk) gönderildi: ' + p.trackingNo + ' (' + p.market + ')');
          } else {
            remaining.push(p);
          }
        } catch (waErr) {
          db.addLog('WhatsApp kargo gönderimi hatası: ' + waErr.message);
          remaining.push(p);
        }
      }
      pending = remaining;
    }

    // 2) Yeni tespit edilen siparişler: pencere içindeyse hemen; dışındaysa kuyruğa
    for (const f of allOrders) {
      if (f.market !== 'idefix' && notified.has(f.id)) continue;
      const o = f.order || {};
      const trackingNo = o.cargoTrackingNumber || o.trackingNumber || o.shipmentId || '';
      if (!trackingNo) continue;
      const nid = f.market + ':' + f.id;
      if (waNotified.has(nid) || pendingSet.has(nid)) continue;
      const fe = { order: { ...o, cargoTrackingNumber: trackingNo, _market: f.market || 'Pazaryeri' } };
      if (win) {
        try {
          const ok = await trySend(fe);
          if (ok) {
            waNotified.add(nid);
            waSent++;
            db.addLog('WhatsApp kargo barkodu gönderildi: ' + trackingNo + ' (' + f.market + ')');
          } else {
            pending.push({ nid, trackingNo, market: f.market || 'Pazaryeri' });
          }
        } catch (waErr) {
          db.addLog('WhatsApp kargo gönderimi hatası: ' + waErr.message);
          pending.push({ nid, trackingNo, market: f.market || 'Pazaryeri' });
        }
      } else {
        pending.push({ nid, trackingNo, market: f.market || 'Pazaryeri' });
      }
    }

    // 3) Sonsuz büyümesin, güncelliği koru
    pending = pending.filter(p => !waNotified.has(p.nid)).slice(-300);
    if (win || pending.length > 0) {
      db.setSettings({ whatsapp: { ...wcfgAll, notifiedOrderIds: Array.from(waNotified).slice(-500), pendingOrderIds: pending } });
    }

    if (waSent > 0) {
      db.addLog('WhatsApp: ' + waSent + ' kargo barkodu gönderildi' + (pending.length ? ', ' + pending.length + ' kuyrukta' : ''));
    } else if (!win && allOrders.length) {
      db.addLog('WhatsApp gönderim penceresi kapalı — ' + pending.length + ' barkod kuyrukta (sabah gönderilecek)');
    }
    return { total: fresh.length, sent, waSent, pending: pending.length };
  }

  return { total: fresh.length, sent };
}

async function checkQuestions() {
  const settings = db.getSettings();
  const cfg = settings.trendyol;
  if (!cfg.apiKey || !cfg.apiSecret || !cfg.sellerId) {
    return { skipped: true, reason: 'Trendyol API ayarları eksik' };
  }  let questions;
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
    const created = Number(q.createdDate) || (new Date(q.createdDate).getTime()) || 0;
    if (created && created < Date.now() - 48 * 60 * 60 * 1000) {
      db.addQnaNotifiedIds([q.id]);
      continue;
    }
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

function normalizeBarcodeKey(s) {
  return String(s || '').trim().toLowerCase();
}

const lastStockWrite = new Map();
const STOCK_WRITE_GRACE_MS = 60 * 60 * 1000;

function getStockWrite(kind, barcode) {
  return lastStockWrite.get(kind + ':' + normalizeBarcodeKey(barcode)) || null;
}

function isWithinStockWriteGrace(kind, barcode) {
  const rec = getStockWrite(kind, barcode);
  return !!rec && Date.now() - rec.ts < STOCK_WRITE_GRACE_MS;
}

function lowerMapKeys(map) {
  const out = new Map();
  for (const [k, v] of map.entries()) out.set(normalizeBarcodeKey(k), v);
  return out;
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
      const prods = await fetchMarketProducts(kind);
      byMarket.set(kind, { byBarcode: lowerMapKeys(prods.byBarcode), bySku: lowerMapKeys(prods.bySku) });
      marketOk(kind);
    } catch (e) {
      marketFailed(kind, e.message);
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
      // idefix barkodları 6 haneye pad'lenmiş olabilir (07ktx3 vs 7ktx3) → padsız anahtarda topla
      const key = normalizeBarcodeKey(kind === 'idefix' ? String(barcode).replace(/^0+/, '') : barcode);
      if (!barcodeKinds.has(key)) barcodeKinds.set(key, []);
      barcodeKinds.get(key).push(kind);
    }
    if (kind === 'idefix') {
      const existing = db.getProducts();
      const idByIxBarcode = new Map(existing.filter(p => p.idefixBarcode).map(p => [normalizeBarcodeKey(p.idefixBarcode), p.barcode]));
      for (const barcode of maps.byBarcode.keys()) {
        const realBarcode = idByIxBarcode.get(normalizeBarcodeKey(barcode));
        if (realBarcode && realBarcode !== barcode && !barcodeKinds.has(normalizeBarcodeKey(realBarcode))) {
          barcodeKinds.set(normalizeBarcodeKey(realBarcode), []);
        }
        if (realBarcode && realBarcode !== barcode) {
          barcodeKinds.get(normalizeBarcodeKey(realBarcode)).push(kind);
        }
      }
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
      const maps = byMarket.get(kind);
      let rec = maps.byBarcode.get(barcode);
      if (!rec && kind === 'idefix') {
        // idefix barkodu pad'li olabilir (010tx4 vs 10tx4) → pad'li varyantları dene
        const plain = String(barcode).replace(/^0+/, '');
        const padded = String(plain).padStart(6, '0');
        rec = maps.byBarcode.get(padded) || maps.byBarcode.get('0' + plain) || null;
      }
      if (!rec && kind === 'idefix') {
        const existing = db.getProducts().find(p => normalizeBarcodeKey(p.barcode) === barcode);
        if (existing && existing.idefixBarcode) {
          rec = maps.byBarcode.get(normalizeBarcodeKey(existing.idefixBarcode));
        }
      }
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

    const ty = entries.find(e => e.kind === 'trendyol');
    // Kural: Trendyol = ana stok (hedef). Ama bir pazaryerinde Trendyol'dan düşük
    // görünen stok, o pazara son yazımdan bu yana geçen zamana göre değerlendirilir:
    //  - Yazım penceresi içindeyse → gecikme (idefix/HB batch yansıması) → satış SAYILMAZ.
    //  - Pencere dışında düşükse → GERÇEK SATIŞ → Trendyol dahil herkes o değere iner.
    //  - 0 görünümler pasif/listing yok/onay bekleyen olabilir → satış sayılmaz.
    let target;
    if (ty && ty.qty !== null && ty.qty !== undefined) {
      const tyQty = Number(ty.qty);
      // STOK GİRİŞİ kontrolü: Trendyol stoğu eski ortak değerden (shared) BÜYÜKSE
      // bu "stok girişi"dir (kullanıcı Trendyol'a elle girdi). O zaman diğer pazarlardaki
      // eski/düşük değerler yansıma gecikmesidir, GERÇEK SATIŞ SAYILMAZ → hedef yeni TY.
      const stockEntry = shared !== null && shared !== undefined && tyQty > Number(shared);
      const realDrops = stockEntry ? [] : entries.filter(e => {
        if (e.kind === 'trendyol') return false;
        const q = Number(e.qty);
        if (q <= 0) return false;
        if (q >= tyQty) return false;
        const writeRec = getStockWrite(e.kind, barcode);
        if (writeRec && Date.now() - writeRec.ts < STOCK_WRITE_GRACE_MS) return false;
        return true;
      });
      if (realDrops.length > 0) {
        target = Math.min(...realDrops.map(e => Number(e.qty)));
      } else {
        target = tyQty;
      }
    } else if (shared !== null && shared !== undefined) {
      target = Number(shared);
    } else {
      target = Math.min(...entries.map(e => e.qty));
    }

    const touched = entries.filter(e => e.qty !== target);
    if (touched.length === 0) {
      if (existing && existing.sharedStock !== target) {
        db.updateProduct(existing.id, { sharedStock: target });
      }
      continue;
    }

    let ok = true;
    for (const e of touched) {
      try {
        await updateMarketStock(e.kind, e.rec, target);
        lastStockWrite.set(e.kind + ':' + normalizeBarcodeKey(barcode), { ts: Date.now(), qty: Number(target) });
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
    const errDetail = errors.slice(0, 5).map(e => e).join(' | ');
    db.addLog(msg +
      (errors.length > 0 ? ', ' + errors.length + ' hata' + (errDetail ? ': ' + errDetail : '') : '') +
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
      const catOverride = (mapping.barcodes && mapping.barcodes[barcode]) || {};

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
        desi: kind === 'pttavm' ? (Number(mapping.desi) || 1) : undefined,
        mapping: { ...mapping, categoryId: catOverride.categoryId || mapping.categoryId }
      };
      let ixBarcode = null;
      if (kind === 'idefix' && barcode.length < 6) {
        ixBarcode = barcode.padStart(6, '0');
        p.vendorStockCode = barcode;
        p.barcode = ixBarcode;
      }
      const extra = ixBarcode ? { idefixBarcode: ixBarcode } : {};

      try {
        const result = await createMarketplaceProduct(kind, p);
        if (result && result.trackingId) {
          extra.trackingIds = extra.trackingIds || {};
          extra.trackingIds[kind] = result.trackingId;
        }
      } catch (e) {
        errors.push(barcode + ' [' + kindLabel(kind) + ']: ' + e.message);
        continue;
      }

      const nextPushed = { ...pushed, [kind]: true };
      if (existing) {
        db.updateProduct(existing.id, { pushed: nextPushed, lastSync: now, ...extra });
      } else {
        db.addProduct({ name: p.title || barcode, barcode, pushed: nextPushed, trendyolStock: p.quantity, lastSync: now, ...extra });
      }
      pushed[kind] = true;
      created++;
    }
  }

  db.addLog('Ürün yükleme tamam: ' + created + ' ürün diğer pazarlara eklendi' +
    (errors.length > 0 ? ', ' + errors.length + ' hata' : ''));
  return { created, errors };
}

module.exports = { syncMarketplace, checkStocks, checkFinancialTransfers, checkQuestions, syncSharedStock, pushNewProducts, checkOrders, MARKETS, kindLabel, marketConfiguredKinds };
