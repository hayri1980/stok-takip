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

async function sendAlarm() {
  const tg = db.getSettings().telegram;
  if (!(tg.enabled && tg.chatId)) return;
  const h = healthStatus();
  const detail = h.issues && h.issues.length ? h.issues.join(' | ') : '';
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
    await sendAlarm();
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
    '/fiyat - tum urunlerin fiyatlari\n' +
    '/senkron - pazaryerlerini simdi senkronla\n' +
    '/denetim - sistemi tara, arizalari tamir et ve raporla\n' +
    '/log - son islem kayitlari\n' +
    '/sorular - bekleyen Trendyol urun sorulari\n' +
    '/test - bildirim testi gonder\n' +
    '/yardim - bu mesaj';
}

async function handleMessage(msg) {
  const text = (msg.text || '').trim();
  if (!text.startsWith('/')) return;
  const chatId = msg.chat.id;
  if (!isAllowedChat(chatId)) return;
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();

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
  } else if (cmd === '/test') {
    const extra = parts.slice(1).join(' ').trim();
    await sendTelegramTo(chatId, 'TEST MESAJI - Bildirim calisiyor.' + (extra ? ' (' + extra + ')' : ''));
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
