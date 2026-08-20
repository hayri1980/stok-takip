const db = require('../db');
const nodemailer = require('nodemailer');

// Epson Email Print entegrasyonu: yazıcının Epson Connect e-posta adresine
// SİPARİŞ NOTU gönderilir; yazıcı PC kapalı olsa bile (internete bağlıysa) basar.
//
// Ayarlar (settings.printer):
//   enabled, emailPrint ("yazicinin e-posta adresi"), from (gönderen SMTP),
//   password, smtpHost (varsayılan smtp-mail.outlook.com), smtpPort (587),
//   printedOrderIds (tekrar baskı önleyici)

function cfg() {
  return db.getSettings().printer || {};
}

function buildTransport(c, from, pass) {
  return nodemailer.createTransport({
    host: c.smtpHost || 'smtp-mail.outlook.com',
    port: Number(c.smtpPort) || 587,
    secure: false,
    tls: { ciphers: 'SSLv3' },
    auth: { user: from, pass }
  });
}

function senderCreds(c) {
  const from = c.from || (db.getSettings().mail || {}).from;
  const pass = c.password || (db.getSettings().mail || {}).password;
  return { from, pass };
}

// Sipariş notunu yazıcıya e-posta (gövde metni olarak) gönder. Epson gövdeyi de basar.
async function printNote(noteText, subject) {
  const c = cfg();
  if (!c.enabled || !c.emailPrint) return { sent: false, reason: 'printer ayarlari yok' };
  const { from, pass } = senderCreds(c);
  if (!from || !pass) return { sent: false, reason: 'gonderen (smtp) ayari yok' };
  const text = String(noteText || '').trim();
  if (!text) return { sent: false, reason: 'not bos' };

  const transport = buildTransport(c, from, pass);
  try {
    await transport.sendMail({
      from: 'Stok Takip <' + from + '>',
      to: c.emailPrint,
      subject: String(subject || 'Siparis Notu'),
      text
    });
    db.addLog('Yaziciya siparis notu gonderildi: ' + String(subject || '').slice(0, 60));
    return { sent: true };
  } catch (e) {
    db.addLog('Yaziciya siparis notu GÖNDERİLEMEDİ: ' + e.message);
    return { sent: false, reason: e.message };
  } finally {
    transport.close();
  }
}

// Tekrar baskıyı önleme
function printedIds() {
  const s = cfg();
  return Array.isArray(s.printedOrderIds) ? s.printedOrderIds : [];
}
function markPrinted(id) {
  const s = cfg();
  const set = new Set(printedIds());
  set.add(String(id));
  const arr = Array.from(set).slice(-800);
  db.setSettings({ printer: { ...s, printedOrderIds: arr } });
  return arr;
}

module.exports = { printNote, printedIds, markPrinted, cfg };