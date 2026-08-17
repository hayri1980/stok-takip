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
  function noteGroupId(msg) {
    try {
      const from = String((msg && (msg.from || (msg._data && msg._data.id && msg._data.id.remote))) || '');
      const gid = from.toLowerCase().endsWith('@g.us') ? from : '';
      if (!gid) return;
      const config = db.getSettings().whatsapp || {};
      db.addLog('WhatsApp GRUP MESAJI: id=' + gid);
      if (!config.foundGroupId || config.foundGroupId !== gid) {
        db.setSettings({ whatsapp: { ...config, foundGroupId: gid, foundGroupAt: new Date().toISOString() } });
      }
    } catch (e) {
      db.addLog('WhatsApp grup mesajı izleme hatası: ' + e.message);
    }
  }
  client.on('message', (msg) => noteGroupId(msg));
  client.on('message_create', (msg) => noteGroupId(msg));
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

async function resolveTarget(number, cfg) {
  // Öncelik: (1) davet linki/kodu (acceptInvite ile çöz), (2) ayardaki grup ID (@g.us),
  // (3) ayardaki grup ADI (gruplarda ara), (4) numara / @g.us.
  const invite = String(cfg.targetGroupInvite || '').trim();
  if (invite) {
    const code = invite.toLowerCase().startsWith('https://chat.whatsapp.com/')
      ? invite.slice('https://chat.whatsapp.com/'.length).trim()
      : invite;
    if (code) {
      try {
        const joined = await client.acceptInvite(code);
        // acceptInvite grupta zaten üyesek "already in group" hatası verir; yine de ID dönebiliyor.
        const id = (joined && joined.id && joined.id._serialized) || '';
        if (id) return { chatId: id };
      } catch (e) {
        // Hata mesajında gid/kimlik arayalım
        const s = String((e && e.message) || e);
        const m = s.match(/@g\.us|([0-9]{16,})@/);
        if (m) return { chatId: m[0] };
        db.addLog('WhatsApp davet çözülemedi: ' + s.slice(0, 200));
      }
    }
  }
  const grpId = String(cfg.targetGroupId || '').trim();
  if (grpId.toLowerCase().endsWith('@g.us')) return { chatId: grpId };
  const grpName = String(cfg.targetGroupName || '').trim();
  if (grpName) {
    let chats = null;
    try {
      chats = await client.getChats();
    } catch (e1) {
      if (client.store && client.store.chats && client.store.chats.models) {
        chats = client.store.chats.models.map(m => ({ isGroup: m.isGroup, name: m.name, id: m.id }));
      } else {
        throw e1;
      }
    }
    const gl = (chats || []).filter(c => c && c.isGroup);
    const g = gl.find(c => String(c.name || '').toLowerCase().trim() === grpName.toLowerCase().trim());
    if (g) return { chatId: (g.id && (g.id._serialized || g.id)) || '' };
    const g2 = gl.find(c => String(c.name || '').toLowerCase().includes(grpName.toLowerCase()));
    if (g2) return { chatId: (g2.id && (g2.id._serialized || g2.id)) || '' };
    return null;
  }
  let raw = String(number || cfg.targetNumber || '').trim();
  if (raw.toLowerCase().endsWith('@g.us')) return { chatId: raw };
  const n = parseNumber(raw);
  const contact = await client.getNumberId(n);
  if (!contact || !contact._serialized) return null;
  return { chatId: contact._serialized };
}

async function listGroups() {
  if (!isReady()) return { error: 'WhatsApp bağlı değil (QR okutulmadı)' };
  try {
    let chats = null;
    try {
      chats = await client.getChats();
    } catch (e1) {
      // getChats bazen store hazır değilken "r" gibi kısa hata döner → store'dan oku.
      if (client.store && client.store.chats && client.store.chats.models) {
        chats = client.store.chats.models.map(m => ({ isGroup: m.isGroup, name: m.name, id: m.id }));
      } else {
        throw e1;
      }
    }
    if (!Array.isArray(chats)) return { error: 'Grup verisi dizi değil' };
    return chats
      .filter(c => c && c.isGroup)
      .map(c => ({ name: c.name || '(isimsiz)', id: (c.id && (c.id._serialized || c.id)) || '' }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } catch (e) {
    db.addLog('WhatsApp grup listesi alınamadı: ' + (e && e.stack ? e.stack : String(e)));
    return { error: String((e && e.message) || e) };
  }
}

async function sendText(number, text) {
  const cfg = getCfg();
  const chk = await ensureNumber(cfg);
  if (chk.err) return { sent: false, reason: chk.err };
  try {
    const t = await resolveTarget(number, cfg);
    if (!t) return { sent: false, reason: 'Hedef bulunamadı (numara WhatsApp sahibi değil veya grup yok)' };
    await client.sendMessage(t.chatId, String(text));
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
    const t = await resolveTarget(number, cfg);
    if (!t) return { sent: false, reason: 'Hedef bulunamadı (numara WhatsApp sahibi değil veya grup yok)' };
    await client.sendMessage(t.chatId, new MessageMedia('image/png', media.buffer.toString('base64'), media.filename), { caption: caption || '' });
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

async function getProfile() {
  if (!isReady()) return { error: 'WhatsApp bağlı değil' };
  try {
    return {
      wid: (client.info && client.info.wid && client.info.wid._serialized) || '',
      pushname: (client.info && client.info.pushname) || '',
      phone: (client.info && client.info.me && client.info.me.user) || ''
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function acceptInvite(code) {
  if (!isReady()) throw new Error('WhatsApp bağlı değil (QR okutulmadı)');
  return client.acceptInvite(code);
}

module.exports = { start, getQr, getStatus, sendText, sendImage, isReady, listGroups, acceptInvite, getProfile };