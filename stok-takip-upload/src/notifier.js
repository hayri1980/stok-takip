const nodemailer = require('nodemailer');
const db = require('../db');

function buildTransport(mail) {
  return nodemailer.createTransport({
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    tls: { ciphers: 'SSLv3' },
    auth: { user: mail.from, pass: mail.password }
  });
}

async function sendEmail(subject, html) {
  const mail = db.getSettings().mail;
  if (!mail.enabled) {
    db.addLog('E-posta gönderilmedi (bildirimler kapalı)');
    return { sent: false, reason: 'E-posta bildirimleri kapalı' };
  }
  if (!mail.from || !mail.password || !mail.to) {
    db.addLog('E-posta gönderilmedi (ayarlar eksik)');
    return { sent: false, reason: 'E-posta ayarları eksik' };
  }

  const transport = buildTransport(mail);
  try {
    await transport.sendMail({
      from: `Stok Takip <${mail.from}>`,
      to: mail.to,
      subject,
      html
    });
    db.addLog('E-posta gönderildi: ' + subject);
    return { sent: true };
  } catch (e) {
    db.addLog('E-posta GÖNDERİLEMEDİ: ' + e.message);
    return { sent: false, reason: e.message };
  } finally {
    transport.close();
  }
}

async function sendTelegramTo(chatId, text) {
  const tg = db.getSettings().telegram;
  if (!tg.enabled) {
    db.addLog('Telegram bildirimi gönderilmedi (Telegram kapalı)');
    return { sent: false, reason: 'Telegram bildirimleri kapalı' };
  }
  if (!tg.botToken || !chatId) {
    db.addLog('Telegram bildirimi gönderilmedi (ayarlar eksik)');
    return { sent: false, reason: 'Telegram ayarları eksik' };
  }

  try {
    const url = 'https://api.telegram.org/bot' + tg.botToken + '/sendMessage';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || 'Telegram hatası');
    return { sent: true };
  } catch (e) {
    db.addLog('Telegram GÖNDERİLEMEDİ: ' + e.message);
    return { sent: false, reason: e.message };
  }
}

function sendTelegram(text) {
  return sendTelegramTo(db.getSettings().telegram.chatId, text);
}

async function notify(subject, html, text) {
  const results = {};
  results.email = await sendEmail(subject, html);
  if (text) results.telegram = await sendTelegram(text);
  return results;
}

function sendTestMail() {
  return sendEmail(
    'Stok Takip test mesajı',
    '<h3>Merhaba!</h3><p>Bu bir <b>test e-postasıdır</b>. Stok Takip uygulamasının bildirimleri çalışıyor.</p>'
  );
}

function sendTestTelegram() {
  return sendTelegram('Stok Takip test mesajı. Bildirimler çalışıyor.');
}

module.exports = { notify, sendTestMail, sendTestTelegram, sendTelegramTo };
