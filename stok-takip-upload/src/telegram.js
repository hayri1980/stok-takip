const db = require('../db');
const { sendTelegramTo } = require('./notifier');

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
    '\nBarkod: ' + p.barcode +
    '\nTrendyol: ' + fmtStock(ty) + ' (' + tyStatus + ')' +
    '\nHepsiburada: ' + fmtStock(hb) + ' (' + hbStatus + ')';
}

function helpText() {
  return 'Komutlar:\n' +
    '/stok - tum urunlerin stok durumu\n' +
    '/stok BARKOD - tek urunun stoku (ornek: /stok 10TX4)\n' +
    '/yardim - bu mesaj';
}

async function handleMessage(msg) {
  const text = (msg.text || '').trim();
  if (!text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === '/stok' || cmd === '/durum' || cmd === '/rapor') {
    const arg = parts.slice(1).join(' ');
    if (arg) {
      const target = arg.toLowerCase();
      const product = db.findProductByBarcode(arg) ||
        db.getProducts().find(p => (p.name || '').toLowerCase() === target || (p.barcode || '').toLowerCase() === target);
      if (product) {
        await sendTelegramTo(chatId, productDetail(product));
      } else {
        await sendTelegramTo(chatId, 'Barkod bulunamadi: ' + arg);
      }
    } else {
      await sendTelegramTo(chatId, stockReport());
    }
  } else if (cmd === '/yardim' || cmd === '/help') {
    await sendTelegramTo(chatId, helpText());
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
}

module.exports = { start };
