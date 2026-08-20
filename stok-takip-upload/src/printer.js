const db = require('../db');
const barcode = require('./barcode');
const nodemailer = require('nodemailer');

// Epson Email Print entegrasyonu: yazıcının Epson Connect e-posta adresine
// barkod görseli gönderilir; yazıcı PC kapalı olsa bile (internete bağlıysa) basar.
//
// Ayarlar (settings.printer):
//   enabled, emailPrint ("yazicinin e-posta adresi"), from, password,
//   smtpHost (varsayılan smtp-mail.outlook.com), smtpPort (587), printedOrderIds

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

// Barkod PNG üretip yazıcıya e-posta ile gönderir.
// text: e-posta gövdesi (Epson, gövdeyi de basar — gönderen ayarlarla kapatılabilir)
async function printBarcode(trackingNo, text) {
  const c = cfg();
  if (!c.enabled || !c.emailPrint) return { sent: false, reason: 'printer ayarlari yok' };
  if (!trackingNo) return { sent: false, reason: 'takip no yok' };
  const from = c.from || (db.getSettings().mail || {}).from;
  const pass = c.password || (db.getSettings().mail || {}).password;
  if (!from || !pass) return { sent: false, reason: 'gonderen (smtp) ayari yok' };

  let png;
  try {
    png = await barcode.makeBarcode(trackingNo);
  } catch (e) {
    return { sent: false, reason: 'barkod uretilemedi: ' + e.message };
  }

  const transport = buildTransport(c, from, pass);
  try {
    await transport.sendMail({
      from: 'Stok Takip <' + from + '>',
      to: c.emailPrint,
      subject: 'Kargo ' + trackingNo,
      text: text || '',
      attachments: [{ filename: 'kargo-' + trackingNo + '.png', content: png }]
    });
    db.addLog('Yaziciya barkod gonderildi: ' + trackingNo + ' (' + c.emailPrint + ')');
    return { sent: true };
  } catch (e) {
    db.addLog('Yaziciya gonderilemedi: ' + e.message);
    return { sent: false, reason: e.message };
  } finally {
    transport.close();
  }
}

// Aynı takip no için tekrar baskıyı önlemek için kayıt.
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

module.exports = { printBarcode, printedIds, markPrinted };