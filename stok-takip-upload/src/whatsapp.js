const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const db = require('../db');

let client = null;
let qrData = null;
let starting = false;
let startError = null;
let autoRetryTimer = null;

function scheduleAutoRetry() {
  if (autoRetryTimer) return;
  autoRetryTimer = setInterval(() => {
    const cfg = getCfg();
    if (cfg.enabled && !starting && !isReady() && !client) start();
  }, 30000);
}

function getCfg() {
  return db.getSettings().whatsapp || {};
}

function isReady() {
  return !!(client && client.info && client.info.wid);
}

function start() {
  if (starting || isReady()) return;
  scheduleAutoRetry();
  const cfg = getCfg();
  const sessionPath = cfg.sessionPath || '/opt/stok-takip/.whatsapp-session';
  starting = true;
  startError = null;
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionPath }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
  });

  client.on('qr', (qr) => {
    qrData = qr;
    db.addLog('WhatsApp QR üretildi — telefon ile okutulmalı');
  });
  client.on('authenticated', () => {
    db.addLog('WhatsApp oturumu açıldı');
  });
  client.on('ready', () => {
    qrData = null;
    db.addLog('WhatsApp bağlandı (hazır)');
  });
  client.on('auth_failure', (msg) => {
    startError = 'WhatsApp oturum hatası: ' + String(msg || '');
    db.addLog(startError);
    qrData = null;
  });
  client.on('disconnected', (reason) => {
    db.addLog('WhatsApp bağlantı koptu: ' + String(reason || ''));
    client = null;
    qrData = null;
    starting = false;
    setTimeout(() => { if (getCfg().enabled) start(); }, 15000);
  });

  client.initialize().catch(e => {
    startError = 'WhatsApp başlatma hatası: ' + e.message;
    db.addLog(startError);
    client = null;
    starting = false;
  });
}

function getQr() {
  return qrData;
}

function getStatus() {
  return {
    ready: isReady(),
    qr: !!qrData,
    error: startError || null,
    hasSession: !!getCfg().enabled
  };
}

function parseNumber(number) {
  let n = String(number || '').replace(/\D/g, '');
  if (/^0\d{10}$/.test(n)) n = '9' + n.slice(1); // 05xx -> 905xx
  if (n.length === 10) n = '90' + n;
  return n;
}

async function ensureNumber(cfg) {
  if (!cfg.enabled) return { err: 'WhatsApp kapalı' };
  if (!isReady()) return { err: 'WhatsApp bağlı değil (QR okutulmadı)' };
  return { ok: true };
}

async function sendText(number, text) {
  const cfg = getCfg();
  const chk = await ensureNumber(cfg);
  if (chk.err) return { sent: false, reason: chk.err };
  try {
    const n = parseNumber(number);
    const contact = await client.getNumberId(n);
    if (!contact || !contact._serialized) return { sent: false, reason: 'Numara WhatsApp sahibi değil: ' + n };
    await client.sendMessage(contact._serialized, String(text));
    return { sent: true };
  } catch (e) {
    db.addLog('WhatsApp mesaj GÖNDERİLEMEDİ: ' + e.message);
    return { sent: false, reason: e.message };
  }
}

async function isDetachedErr(e) {
  const m = String((e && e.message) || '');
  return m.includes('detached Frame') || m.includes('Target crashed') || m.includes('Cannot read property') || m.includes('Session closed');
}

function rebuildClient() {
  try { if (client && client.destroy) client.destroy().catch(() => {}); } catch (e) {}
  client = null;
  qrData = null;
  starting = false;
}

async function sendImage(number, media, caption, _retry) {
  const cfg = getCfg();
  const chk = await ensureNumber(cfg);
  if (chk.err) return { sent: false, reason: chk.err };
  try {
    const n = parseNumber(number);
    const contact = await client.getNumberId(n);
    if (!contact || !contact._serialized) return { sent: false, reason: 'Numara WhatsApp sahibi değil: ' + n };
    await client.sendMessage(contact._serialized, new MessageMedia('image/png', media.buffer.toString('base64'), media.filename), { caption: caption || '' });
    return { sent: true };
  } catch (e) {
    db.addLog('WhatsApp görsel GÖNDERİLEMEDİ: ' + e.message);
    if (!_retry && await isDetachedErr(e)) {
      db.addLog('WhatsApp frame koptu — client yeniden başlatılıyor, tekrar deneniyor');
      rebuildClient();
      start();
      const waitMs = Math.min(3, Math.max(1, Number(getCfg().restartWaitSec || 20))) * 1000;
      await new Promise(r => setTimeout(r, waitMs));
      return sendImage(number, media, caption, true);
    }
    return { sent: false, reason: e.message };
  }
}

module.exports = { start, getQr, getStatus, sendText, sendImage, isReady };