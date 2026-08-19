const db = require('../db');
const { sendTelegramTo } = require('./notifier');
const sync = require('./sync');
const trendyol = require('./trendyol');
const audit = require('./audit');

let offset = 0;
let running = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fmtStock(stock) {
  return stock === null || stock === undefined ? '-' : String(stock);
}

function stockReport() {
  const products = db.getProducts();
  const threshold = Math.max(0, Number(db.getSettings().sync.threshold) || 1);
  let critical = 0;
  let soldOut = 0;

  const lines = products.map((p, i) => {
    const ty = p.trendyolStock;
    const hb = p.hepsiburadaStock;
    let mark = '';
    if (ty !== null && ty !== undefined && ty <= threshold) mark = ' [KRITIK]';
    if (hb !== null && hb !== undefined && hb <= threshold) mark = mark + ' [KRITIK]';
    if (ty !== null && ty <= 0) soldOut++;
    if (hb !== null && hb <= 0) soldOut++;
    if ((ty !== null && ty <= threshold) || (hb !== null && hb <= threshold)) critical++;
    return (i + 1) + ') ' + p.name + ' | TY: ' + fmtStock(ty) + ' | HB: ' + fmtStock(hb) + mark;
  });

  const header = 'STOK DURUMU (' + products.length + ' urun)';
  if (lines.length === 0) return header + '\nHenuz urun yok.';
  return header + '\n' + lines.join('\n') + '\n----\nKritik: ' + critical + ' | Biten: ' + soldOut;
}

function productDetail(p) {
  const threshold = Math.max(0, Number(db.getSettings().sync.threshold) || 1);
  const ty = p.trendyolStock;
  const hb = p.hepsiburadaStock;
  const tyStatus = ty === null || ty === undefined ? 'bilinmiyor' : (ty <= threshold ? 'KRITIK' : 'var');
  const hbStatus = hb === null || hb === undefined ? 'bilinmiyor' : (hb <= threshold ? 'KRITIK' : 'var');
  return 'URUN: ' + p.name +
    '\nStok kodu: ' + p.barcode +
    '\nTrendyol: ' + fmtStock(ty) + ' (' + tyStatus + ')' +
    '\nHepsiburada: ' + fmtStock(hb) + ' (' + hbStatus + ')';
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return d + 'g ' + h + 's ' + m + 'd ' + s + 'sn';
}

function isAllowedChat(chatId) {
  const tg = db.getSettings().telegram;
  if (tg.chatIds && Array.isArray(tg.chatIds) && tg.chatIds.length > 0) {
    return tg.chatIds.map(String).includes(String(chatId));
  }
  return !!(tg.chatId && String(tg.chatId) === String(chatId));
}

const PARA_MARKETS = {
  hb: 'Hepsiburada', hepsiburada: 'Hepsiburada',
  ptt: 'PTT AVM', pttavm: 'PTT AVM',
  idefix: 'idefix',
  n11: 'N11',
  cicek: 'Çiçeksepeti', ciceksepeti: 'Çiçeksepeti',
  trendyol: 'Trendyol'
};

// Pazar yerinden yatan parayı Excel'e kaydet (API'si olmayan pazarlar elle eklenir).
// Kullanım: /para 1500   -> Trendyol 1500 TL
//          /para HB 800  -> Hepsiburada 800 TL
//          /para PTT 350 -> PTT AVM 350 TL
async function addParaRecord(chatId, rest) {
  const arg = String(rest || '').trim();
  if (!arg) {
    return sendTelegramTo(chatId, 'Kullanim: /para <tutar>\nOrnek: /para 1500  |  /para HB 800  |  /para PTT 350\n(Pazar: HB/PTT/idefix/N11 — yazmazsan Trendyol)');
  }
  const m = arg.match(/^(?:(hb|hepsiburada|ptt|pttavm|idefix|n11|cicek|ciceksepeti|trendyol)\s+)?(\d+(?:[.,]\d+)?)(?:\s+(.*))?$/i);
  if (!m || !m[2]) {
    return sendTelegramTo(chatId, 'Tutar taninamadi. Ornek: /para 1500  veya  /para HB 800');
  }
  const market = m[1] ? (PARA_MARKETS[m[1].toLowerCase()] || 'Trendyol') : 'Trendyol';
  const amount = parseFloat(String(m[2]).replace(',', '.'));
  const description = (m[3] || '').trim();
  try {
    db.addFinanceRecord({
      id: 'manual:' + market + ':' + Date.now(),
      market,
      type: 'Banka yatisi',
      amount,
      description,
      date: new Date().toISOString()
    });
    const total = db.getFinanceRecords().reduce((s, r) => s + (Number(r.amount) || 0), 0);
    db.addLog('Elle para kaydi: ' + market + ' ' + amount + ' TL');
    return sendTelegramTo(chatId, market + ' para kaydedildi: ' + amount + ' TL' + (description ? ' (' + description + ')' : '') + '\nExcel TOPLAM: ' + total + ' TL');
  } catch (e) {
    db.addLog('Para kaydi hatasi: ' + e.message);
    return sendTelegramTo(chatId, 'Kaydedilemedi: ' + e.message);
  }
}

// Türkçe karakterleri ASCII'e çevirir (ç→c, ı→i, ö→o, ş→s, ü→u, ğ→g) — böylece
// "çıkar" / "cikar", "düşür" / "dusur" gibi yazımların hepsi aynı şekilde eşleşir.
function trNorm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u');
}

// Serbest yazı ile uzaktan stok düzeltme: "10fx5 3 ekle", "30GRX5 5 çıkar", "7KTX3 bitir",
// ayrıca ters / isteyerek yazımlar: "çıkar 30GRX5 5", "30grx5 e 5 ekle"
async function handleNaturalStock(chatId, text) {
  const nt = trNorm(text);
  const addPat =
    nt.match(/^(\S+)\s+(\d+)\s*(?:ekle|art(?:t|ir)|yukle|gir|koy|yaz)\b/) ||
    nt.match(/^(?:ekle|art(?:t|ir)|yukle|gir|koy|yaz)\s+(\S+)\s+(\d+)\b/) ||
    nt.match(/^(\S+)\s+(?:e\s*)?(\d+)\s*(?:ekle|art(?:t|ir))\b/);
  const remPat =
    nt.match(/^(\S+)\s+(\d+)\s*(?:cikar|cik|azalt|dusur|indir|sil|kaldir)\b/) ||
    nt.match(/^(?:cikar|cik|azalt|dusur|indir|sil|kaldir)\s+(\S+)\s+(\d+)\b/);
  const zeroPat =
    nt.match(/^(\S+)\s*(?:bitir|sifirla|sifir)\b/) ||
    nt.match(/^(?:bitir|sifirla|sifir)\s+(\S+)\b/);
  let arg = null;
  if (addPat) arg = { mode: 'add', barcode: addPat[1], qty: parseInt(addPat[2], 10) };
  else if (remPat) arg = { mode: 'remove', barcode: remPat[1], qty: parseInt(remPat[2], 10) };
  else if (zeroPat) arg = { mode: 'zero', barcode: zeroPat[1], qty: 0 };
  if (!arg) return;
  await adjustStock(chatId, arg.mode, arg.barcode, arg.qty);
}

// Trendyol'a stok yazar (ana stok) + DB'yi günceller; ortak stok diğer pazarları eşitler.
async function adjustStock(chatId, mode, barcode, qty) {
  const ty = db.getSettings().trendyol;
  if (!(ty.apiKey && ty.apiSecret && ty.sellerId)) {
    return sendTelegramTo(chatId, 'Trendyol API ayarlari eksik.');
  }
  if (!barcode) {
    return sendTelegramTo(chatId, 'Stok kodu yaz (ornek: 10fx5 3 ekle).');
  }
  if (mode !== 'zero' && (!Number.isFinite(qty) || qty <= 0)) {
    return sendTelegramTo(chatId, 'Adet gecersiz. Ornek: 10fx5 3 ekle.');
  }
  const p = db.findProductByBarcode(barcode);
  if (!p) {
    return sendTelegramTo(chatId, 'Stok kodu bulunamadi: ' + barcode);
  }
  const cur = (p.trendyolStock !== null && p.trendyolStock !== undefined) ? Number(p.trendyolStock) : 0;
  let newVal;
  if (mode === 'add') newVal = cur + qty;
  else if (mode === 'remove') newVal = Math.max(0, cur - qty);
  else newVal = 0;

  try {
    sync.markStockAdjustment('trendyol', barcode);
    await trendyol.updateStock(ty.sellerId, ty.apiKey, ty.apiSecret, barcode, newVal);
    db.updateProduct(p.id, {
      trendyolStock: newVal,
      sharedStock: newVal,
      lastSync: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
    const lbl = mode === 'add' ? 'EKLENDI' : (mode === 'remove' ? 'CIKARILDI' : 'SIFIRLANDI');
    db.addLog('Telegram uzaktan stok: ' + p.barcode + ' ' + lbl + ' (' + cur + ' -> ' + newVal + ')');
    return sendTelegramTo(chatId, p.barcode + ' stok: ' + cur + ' -> ' + newVal + ' (' + lbl + ')\nTrendyol guncellendi. Diger pazarlar bir sonraki senkronla esitlenir.');
  } catch (e) {
    db.addLog('Telegram stok guncelleme hatasi: ' + e.message);
    return sendTelegramTo(chatId, 'Stok guncellenemedi: ' + e.message);
  }
}

function systemStatus() {
  const settings = db.getSettings();
  const ty = settings.trendyol || {};
  const hb = settings.hepsiburada || {};
  const tg = settings.telegram || {};
  const rep = settings.report || {};
  const lines = [];
  lines.push('SISTEM DURUMU');
  lines.push('Aktif: ' + fmtUptime(process.uptime()));
  lines.push('Urun sayisi: ' + db.getProducts().length);
  lines.push('Telegram: ' + (tg.enabled ? 'Aktif' : 'Kapali'));
  lines.push('Trendyol API: ' + (ty.apiKey && ty.apiSecret && ty.sellerId ? 'Aktif' : 'Eksik'));
  lines.push('Hepsiburada API: ' + (hb.username && hb.password ? 'Aktif' : 'Eksik'));
  lines.push('Senkron araligi: ' + (Number(settings.sync.pollSeconds) || 30) + ' sn');
  lines.push('Gun sonu raporu: ' + (rep.enabled ? 'Aktif' : 'Kapali'));
  if (rep.lastReportDate) lines.push('Son rapor: ' + rep.lastReportDate);
  const log = db.getLog();
  const syncEntry = log.find(l => /senkronu tamam/i.test(l.message || ''));
  if (syncEntry) lines.push('Son senkron: ' + syncEntry.message);
  return lines.join('\n');
}

function recentLog(n) {
  const log = db.getLog();
  const lines = log.slice(0, Math.max(1, Number(n) || 10)).map(l => {
    const t = (l.time || '').replace('T', ' ').slice(5, 19);
    return t + '  ' + (l.message || '');
  });
  return 'SON LOGLAR\n----\n' + (lines.length ? lines.join('\n') : 'Bos.');
}

function lastSyncAgeMin() {
  const log = db.getLog();
  for (const l of log) {
    if (/senkronu tamam/i.test(l.message || '')) {
      const t = new Date(l.time).getTime();
      if (!isNaN(t)) return Math.round((Date.now() - t) / 60000);
    }
  }
  return null;
}

function healthStatus() {
  const settings = db.getSettings();
  const ty = settings.trendyol || {};
  const hb = settings.hepsiburada || {};
  const issues = [];
  if (!(ty.apiKey && ty.apiSecret && ty.sellerId) && !(hb.username && hb.password)) {
    issues.push('Hicbir pazaryeri API ayari yok');
  }
  if (db.getProducts().length === 0) issues.push('Urun listesi bos');
  const age = lastSyncAgeMin();
  let syncAge = null;
  if (age !== null && age > 30) {
    syncAge = age;
    issues.push('Son senkron ' + age + ' dk once (cok eski)');
  } else {
    syncAge = age;
  }
  return {
    ok: issues.length === 0,
    issues: issues,
    syncAge: syncAge
  };
}

let lastHealthy = null;
const STARTUP_GRACE_MS = 5 * 60 * 1000;
const ALARM_MIN_INTERVAL_MS = 30 * 60 * 1000;
const bootTs = Date.now();
let lastAlarmTs = 0;

async function sendAlarm(reason) {
  const tg = db.getSettings().telegram;
  if (!(tg.enabled && tg.chatId)) return;
  if (Date.now() - bootTs < STARTUP_GRACE_MS) return;
  // Alarm tekrar kısıtı: aynı arızada çarpı yağmuru olmasın (en fazla 30 dk'da bir)
  if (Date.now() - lastAlarmTs < ALARM_MIN_INTERVAL_MS) return;
  lastAlarmTs = Date.now();
  const h = healthStatus();
  const detail = (reason ? reason + '\n' : '') + (h.issues && h.issues.length ? h.issues.join(' | ') : '');
  db.addLog('ALARM TETIKLENDI: ' + (detail || 'sebepsiz') + ' | syncAge=' + (h.syncAge === null ? 'null' : h.syncAge + 'dk'));
  if (detail) {
    try {
      await sendTelegramTo(tg.chatId,
        '\u26A0\uFE0F UYARI: Stok guncellemesi DURDU!\n' + detail +
        '\n\nStoklar GUNCEL DEGIL. Elimizde olmayan urunu satmamak icin magaza panelinden stoklari kontrol et. Sistem sorun cozulunce otomatik toparlanacak.'
      );
    } catch (e) {
      db.addLog('Alarm gonderilemedi: ' + e.message);
    }
  }
  for (let i = 0; i < 5; i++) {
    try {
      await sendTelegramTo(tg.chatId, '\u274C');
    } catch (e) {
      db.addLog('Alarm gonderilemedi: ' + e.message);
    }
    await sleep(3000);
  }
}

async function sendGreenTick() {
  const tg = db.getSettings().telegram;
  if (!(tg.enabled && tg.chatId)) return;
  if ((db.getSettings().notifications || {}).health === false) return;
  const h = healthStatus();
  if (h.ok) {
    const extra = h.syncAge !== null ? ' - son senkron ' + h.syncAge + ' dk once' : '';
    await sendTelegramTo(tg.chatId, '\u2705 Sistem saglikli' + extra);
  }
}

async function checkHealthState() {
  const tg = db.getSettings().telegram;
  if (!(tg.enabled && tg.chatId)) return;
  const h = healthStatus();
  if (h.ok) {
    if (lastHealthy === false) {
      await sendGreenTick();
    }
    lastHealthy = true;
  } else {
    await sendAlarm('Saglik kontrolu');
    lastHealthy = false;
  }
}

function scheduleHealthCheck() {
  const HOUR = 3 * 60 * 60 * 1000;
  setTimeout(checkHealthState, 20 * 1000);
  setTimeout(sendGreenTick, 30 * 1000);
  setInterval(checkHealthState, 30 * 1000);
  setInterval(sendGreenTick, HOUR);
}

async function runFullCheck() {
  const results = {};
  for (const kind of sync.MARKETS) {
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
  try {
    await sync.syncSharedStock();
  } catch (e) {
    db.addLog('Ortak stok yazma hatası: ' + e.message);
  }
  try {
    await sync.checkQuestions();
  } catch (e) {
    db.addLog('Soru kontrol hatası: ' + e.message);
  }
  const lines = ['KONTROL BILGILERI'];
  for (const kind of sync.MARKETS) {
    const r = results[kind];
    if (r && r.skipped) lines.push(sync.kindLabel(kind) + ': atlandi (' + (r.reason || '') + ')');
    else if (r && r.error) lines.push(sync.kindLabel(kind) + ': HATA - ' + r.error);
    else lines.push(sync.kindLabel(kind) + ': ' + (r ? r.sales : 0) + ' satis, ' + (r ? r.updated : 0) + ' guncelleme');
  }
  return lines.join('\n');
}

function helpText() {
  return 'Komutlar:\n' +
    '/sk - kontrol et ve raporla\n' +
    '/stok - tum urunlerin stok durumu\n' +
    '/stok STOK KODU - tek urunun stoku (ornek: /stok 10TX4)\n' +
    '/stok-ekle STOK KODU ADET - stok ekle (ornek: /stok-ekle 10fx5 3)\n' +
    '/stok-cikar STOK KODU ADET - stok cikar (ornek: /stok-cikar 30GRX5 5)\n' +
    '/stok-sil STOK KODU - stogu 0 yap (ornek: /stok-sil 7KTX3)\n' +
    '/fiyat - tum urunlerin fiyatlari\n' +
    '/para TUTAR - yatan parayi kaydet (orn: /para 1500, /para HB 800)\n' +
    '/senkron - pazaryerlerini simdi senkronla\n' +
    '/denetim - sistemi tara, arizalari tamir et ve raporla\n' +
    '/log - son islem kayitlari\n' +
    '/sorular - bekleyen Trendyol urun sorulari\n' +
    '/fatura - bekleyen faturalar\n' +
    '/fatura-kesildi SIPARISNO - faturayi kapat\n' +
    '/kuyruk - bekleyen kargo etiketleri\n' +
    '/test - bildirim testi gonder\n' +
    '/yardim - bu mesaj\n' +
    '\nUZAKTAN STOK (bosta da yazar):\n' +
    '10fx5 3 ekle - stok ekle\n' +
    '30GRX5 5 cikar - stok cikar (0 altina inmez)\n' +
    '7KTX3 bitir - stogu 0 (bitti) yap';
}

async function handleMessage(msg) {
  const text = (msg.text || '').trim();
  const chatId = msg.chat.id;
  if (!isAllowedChat(chatId)) return;
  if (!text.startsWith('/')) {
    // Serbest yazı: "10fx5 3 ekle" / "30GRX5 5 çıkar" / "7KTX3 bitir" gibi → uzaktan stok düzeltme
    await handleNaturalStock(chatId, text);
    return;
  }
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/-/g, '_');

  if (cmd === '/sk') {
    await sendTelegramTo(chatId, 'Kontrol basladi, biraz bekleyin...');
    const report = await runFullCheck();
    await sendTelegramTo(chatId, report + '\n\n' + systemStatus());
  } else if (cmd === '/sistem' || cmd === '/durum') {
    await sendTelegramTo(chatId, systemStatus());
  } else if (cmd === '/log') {
    const n = parseInt(parts[1], 10);
    await sendTelegramTo(chatId, recentLog(isNaN(n) ? 10 : n));
  } else if (cmd === '/senkron') {
    await sendTelegramTo(chatId, 'Senkron basladi, biraz bekleyin...');
    const report = await runFullCheck();
    await sendTelegramTo(chatId, report);
  } else if (cmd === '/denetim') {
    await sendTelegramTo(chatId, 'Denetim basladi, biraz bekleyin...');
    try {
      const r = await audit.runAudit({ notify: false });
      await sendTelegramTo(chatId, r.text);
    } catch (e) {
      await sendTelegramTo(chatId, 'Denetim hatasi: ' + e.message);
    }
  } else if (cmd === '/stok' || cmd === '/durum' || cmd === '/rapor') {
    const arg = parts.slice(1).join(' ');
    if (arg) {
      const target = arg.toLowerCase();
      const product = db.findProductByBarcode(arg) ||
        db.getProducts().find(p => (p.name || '').toLowerCase() === target || (p.barcode || '').toLowerCase() === target);
      if (product) {
        await sendTelegramTo(chatId, productDetail(product));
      } else {
        await sendTelegramTo(chatId, 'Stok kodu bulunamadi: ' + arg);
      }
    } else {
      await sendTelegramTo(chatId, stockReport());
    }
  } else if (cmd === '/stok_ekle' || cmd === '/stok_cikar' || cmd === '/stok_sil') {
    const mode = cmd === '/stok_ekle' ? 'add' : (cmd === '/stok_cikar' ? 'remove' : 'zero');
    let barcode = '';
    let qty = 0;
    if (mode === 'zero') {
      barcode = (parts[1] || '').trim();
    } else {
      const m = parts.slice(1).join(' ').match(/^(\S+)\s+(\d+)$/);
      if (!m) {
        await sendTelegramTo(chatId, 'Kullanim: ' + cmd + ' <stok kodu> <adet>\nOrnek: ' + cmd + ' 10fx5 3');
        return;
      }
      barcode = m[1];
      qty = parseInt(m[2], 10);
    }
    await adjustStock(chatId, mode, barcode, qty);
  } else if (cmd === '/fiyat') {
    const products = db.getProducts().filter(p => p.price !== null && p.price !== undefined);
    if (products.length === 0) {
      await sendTelegramTo(chatId, 'Fiyat bilgisi henuz yok. Trendyol fiyat senkronu 30 dakikada bir calisir.');
    } else {
      const lines = products.map(p =>
        p.barcode + ': ' + p.price + ' TL' +
        (p.listPrice && Number(p.listPrice) > Number(p.price) ? ' (liste ' + p.listPrice + ')' : '')
      );
      await sendTelegramTo(chatId, 'FIYATLAR (' + products.length + ')\n\n' + lines.join('\n'));
    }
  } else if (cmd === '/para') {
    await addParaRecord(chatId, parts.slice(1).join(' '));
  } else if (cmd === '/sorular' || cmd === '/qa') {
    const cfg = db.getSettings().trendyol;
    if (!cfg.apiKey || !cfg.apiSecret || !cfg.sellerId) {
      await sendTelegramTo(chatId, 'Trendyol API ayarlari eksik.');
      return;
    }
    try {
      const questions = await trendyol.fetchQuestions(cfg.sellerId, cfg.apiKey, cfg.apiSecret);
      if (questions.length === 0) {
        await sendTelegramTo(chatId, 'Bekleyen soru yok.');
      } else {
        const lines = questions.map((q, i) =>
          (i + 1) + ') ' + (q.productName || 'Bilinmeyen urun') + '\n   ' + q.question
        );
        await sendTelegramTo(chatId, 'BEKLEYEN SORULAR (' + questions.length + ')\n\n' + lines.join('\n'));
      }
    } catch (e) {
      await sendTelegramTo(chatId, 'Soru cekilemedi: ' + e.message);
    }
  } else if (cmd === '/yardim' || cmd === '/help') {
    await sendTelegramTo(chatId, helpText());
  } else if (cmd === '/fatura' || cmd === '/fatura-kesildi') {
    await handleInvoiceCommand(chatId, cmd, parts.slice(1).join(' ').trim());
  } else if (cmd === '/kuyruk' || cmd === '/ettiket') {
    await handlePendingBarcode(chatId);
  } else if (cmd === '/test') {
    const extra = parts.slice(1).join(' ').trim();
    await sendTelegramTo(chatId, 'TEST MESAJI - Bildirim calisiyor.' + (extra ? ' (' + extra + ')' : ''));
  }
}

// WhatsApp kargo barkod kuyruğu: 17:30 sonrası / pencere dışı bekleyen etiketleri göster.
async function handlePendingBarcode(chatId) {
  const wcfg = db.getSettings().whatsapp || {};
  const pending = Array.isArray(wcfg.pendingOrderIds) ? wcfg.pendingOrderIds : [];
  if (pending.length === 0) {
    await sendTelegramTo(chatId, 'Kargo kuyrugunda barkod yok. 🎉');
    return;
  }
  const lines = pending.slice().reverse().map((p, i) => {
    const nid = String(p.nid || p.id || '');
    const market = p.market || 'Pazaryeri';
    const orderPart = nid.split(':').pop() || nid;
    return (i + 1) + ') ' + market + ' — ' + (p.trackingNo || nid) + (p.trackingNo ? ' | siparis ' + orderPart : '');
  });
  await sendTelegramTo(chatId, 'KARGO KUYRUGU (' + pending.length + ' barkod)\n\n' + lines.join('\n') +
    '\n\n(Gönderim penceresi: Hafta ici 09:00-17:30 | Cumartesi 09:00-15:00 | Pazar kapali)');
}

async function handleInvoiceCommand(chatId, cmd, arg) {
  if (cmd === '/fatura') {
    const pending = db.getInvoiceReminders().filter(r => r && !r.done);
    if (pending.length === 0) {
      await sendTelegramTo(chatId, 'Bekleyen fatura yok. 🎉');
      return;
    }
    const lines = pending.slice(-20).map(r => {
      const ageH = Math.round((Date.now() - Number(r.orderTs || 0)) / 3600000);
      return r.market + ' ' + r.orderNo + ' (' + ageH + ' saat)';
    });
    await sendTelegramTo(chatId, 'BEKLEYEN FATURALAR (' + pending.length + ')\n\n' + lines.join('\n') + '\n\nKesildiyse: /fatura-kesildi SIRANO');
    return;
  }
  // /fatura-kesildi <siparis no>
  if (!arg) {
    await sendTelegramTo(chatId, 'Kullanim: /fatura-kesildi SIPARISNO\nOrnek: /fatura-kesildi 11520297965');
    return;
  }
  const target = String(arg).trim().toLowerCase();
  const all = db.getInvoiceReminders();
  const match = all.find(r => r && !r.done && String(r.orderNo).toLowerCase() === target);
  if (match) {
    db.markInvoiceDone(match.key);
    await sendTelegramTo(chatId, 'Fatura kesildi olarak isaretlendi: ' + match.market + ' ' + match.orderNo + ' ✅');
  } else {
    await sendTelegramTo(chatId, 'Bekleyen fatura bulunamadi: ' + arg + ' (fatura no veya siparis no?)');
  }
}

async function pollLoop() {
  while (true) {
    const tg = db.getSettings().telegram;
    if (!tg.enabled || !tg.botToken) {
      await sleep(10000);
      continue;
    }
    try {
      const url = 'https://api.telegram.org/bot' + tg.botToken + '/getUpdates?timeout=25&offset=' + offset;
      const res = await fetch(url, { signal: AbortSignal.timeout(40000) });
      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          if (update.update_id >= offset) offset = update.update_id + 1;
          if (update.message) {
            try {
              await handleMessage(update.message);
            } catch (e) {
              db.addLog('Telegram komut hatası: ' + e.message);
            }
          }
        }
      }
    } catch (e) {
      await sleep(3000);
    }
  }
}

function start() {
  if (running) return;
  running = true;
  pollLoop();
  scheduleHealthCheck();
}

module.exports = { start };
