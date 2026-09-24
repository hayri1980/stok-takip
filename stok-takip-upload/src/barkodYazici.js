const db = require('../db');
const net = require('net');

// Kargo BARKOD ETİKETİ yazıcısı (termal etiket yazıcılarına ZPL ile ağ üzerinden baskı)
//
// Ayarlar (settings.barkodYazici):
//   enabled   : açık/kapalı
//   host      : yazıcının erişim adresi (aynı ağda 192.168.1.xx veya genel adresten erişim için
//               modem port yönlendirmesiyle yazıcının "halka açık" IP:port'u)
//   port      : yazıcı sunucusu portu (varsayılan 9100)
//   copiedTrackings : basılan takip numaraları (tekrar baskı önleyici, kalıcı)
//
// Yazıcı: HPRT / HereLabel SPR-211D gibi ZPL destekli termal etiket yazıcıları.

function cfg() {
  return db.getSettings().barkodYazici || {};
}

function isConfigured() {
  const c = cfg();
  return !!(c.enabled && c.host);
}

// Ham ZPL verisini TCP ile yazıcıya gönder (port 9100, ham soket).
function sendZpl(zpl, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch (e) {}
      try { socket.destroy(); } catch (e) {}
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('zaman asimi (yaziciya ulasilamadi)'))), timeoutMs || 15000);
    socket.setTimeout(timeoutMs || 15000);
    socket.on('timeout', () => finish(() => reject(new Error('zaman asimi (yaziciya ulasilamadi)'))));
    socket.on('error', (err) => finish(() => reject(new Error(err.message))));
    socket.connect(Number(port) || 9100, host, () => {
      try { socket.write(Buffer.from(zpl, 'ascii')); } catch (e) { return finish(() => reject(e)); }
      setTimeout(() => finish(() => resolve({ ok: true })), 700);
    });
  });
}

// 100x100mm kargo etiketi kalıbı: üstte takip no, ortada Code128 barkod, altta pazar + desi.
function buildCargoZpl({ trackingNo, market, desi }) {
  const no = String(trackingNo || '').replace(/[^A-Za-z0-9\-/.]/g, '').slice(0, 40);
  if (!no) return null;
  const marketLabel = String(market || '').trim();
  const line2 = marketLabel ? (marketLabel + '  Desi: ' + (desi || 1)) : ('Desi: ' + (desi || 1));
  return [
    '^XA',
    '^CF0,60',
    '^FO60,20',
    '^FD' + no + '^FS',
    '^BY3,3,160',
    '^FO60,100',
    '^BCN,140,Y,N,N',
    '^FD' + no + '^FS',
    '^CF0,45',
    '^FO60,300',
    '^FD' + line2 + '^FS',
    '^XZ',
    ''
  ].join('\r\n');
}

// Basılan takip numaraları (kalıcı, restart'ta kaybolmaz)
function printedSet() {
  const s = cfg();
  return new Set(Array.isArray(s.copiedTrackings) ? s.copiedTrackings : []);
}
function savePrinted(arr) {
  const s = cfg();
  db.setSettings({ barkodYazici: { ...s, copiedTrackings: Array.from(arr).slice(-3000) } });
}

// Tek etiket bas
async function printCargoLabel(params) {
  const c = cfg();
  if (!isConfigured()) return { sent: false, reason: 'barkod yazici ayarlari yok (kapali veya host eksik)' };
  const trackingNo = String((params && params.trackingNo) || '').trim();
  if (!trackingNo) return { sent: false, reason: 'takip no bos' };
  const zpl = buildCargoZpl({ trackingNo, market: (params && params.market), desi: (params && params.desi) });
  if (!zpl) return { sent: false, reason: 'takip nosu gecersiz' };
  try {
    await sendZpl(zpl, c.host, c.port);
    db.addLog('Barkod yazicidan etiket basildi: ' + trackingNo.slice(0, 40));
    return { sent: true };
  } catch (e) {
    db.addLog('Barkod yazici BASKI HATASI (' + String(c.host) + '): ' + e.message);
    return { sent: false, reason: e.message };
  }
}

module.exports = { printCargoLabel, buildCargoZpl, sendZpl, cfg, isConfigured, printedSet, savePrinted };