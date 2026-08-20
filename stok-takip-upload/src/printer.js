const db = require('../db');
const nodemailer = require('nodemailer');
const noteRender = require('./noteRender');

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

// Onaylanan müşteri notu (el yazısı render + alt köşede müşteri/kargo no)
const NOTE_BODY =
  '\nSiparişinizi güzel günlerde kullanmanızı dileriz.\n\n' +
  'KULLANIM ÖNCESİ: Kullanmaya başlamadan önce çaparınızı suya sokup çıkarırsanız, düğümlerin yanmasını ve patlamasını engellemiş olursunuz.\n\n' +
  'KULLANIM SONRASI: Tatlı suyla durularsanız denizin tuzlu suyundan arınmış olur ve bir dahaki kullanımınızda sanki ilk kullanmış gibi olur.\n\n' +
  'Siparişiniz elinize ulaştığında bize kısa bir değerlendirme bırakabilir misiniz?\n' +
  '- Kargo süreci nasıldı?\n' +
  '- Ürün görseldeki ile aynı mı, farklı mı?\n' +
  '- Ürünün kalitesi ve kullanımı nasıl?\n\n' +
  'Ürünü kullandıktan sonra fikriniz değişirse, yorumunuzu güncelleyerek deneyiminizi paylaşmanız bizi çok mutlu eder. ' +
  'Yapacağınız değerlendirme hem bize destek olur, hem diğer balıkçı arkadaşların doğru ürünü seçmesine yardımcı olur.\n\n' +
  'Bir sonraki alışverişinizde kullanabileceğiniz indirim kuponunuz da bizden küçük bir teşekkür olsun.\n\n' +
  'Şimdiden teşekkür eder, rastgele!';

const MARKET_LABEL = { trendyol: 'Trendyol', hepsiburada: 'Hepsiburada', idefix: 'idefix', pttavm: 'PTT AVM', n11: 'N11' };

// Bir sipariş için onaylı notu EL YAZISI olarak bastırır (tam dikey A4, not üst yarıda).
// params: { market, name, kargo, orderNo, region }
async function printOrderNote(params) {
  const p = params || {};
  const c = cfg();
  if (!c.enabled || !c.emailPrint) return { sent: false, reason: 'printer ayarlari yok' };
  const { from, pass } = senderCreds(c);
  if (!from || !pass) return { sent: false, reason: 'gonderen (smtp) ayari yok' };

  const market = MARKET_LABEL[(p.market || '').toLowerCase()] || p.market || 'Pazaryeri';
  const name = String(p.name || '').trim();
  const greeting = name
    ? ('Sayın ' + name + ' ' + market + ' müşterisi,')
    : ('Sayın ' + market + ' Müşterimiz,');
  const text = greeting + NOTE_BODY;

  let png;
  try {
    png = await noteRender.renderNote(text, { region: p.region === 'bottom' ? 'bottom' : 'top', corner: { name, kargo: String(p.kargo || '') } });
  } catch (e) {
    db.addLog('Yazici not render hatasi: ' + e.message);
    return { sent: false, reason: 'render: ' + e.message };
  }

  const transport = buildTransport(c, from, pass);
  try {
    await transport.sendMail({
      from: 'Stok Takip <' + from + '>',
      to: c.emailPrint,
      subject: 'Siparis Notu ' + (p.orderNo || ''),
      text: ' ',
      attachments: [{ filename: 'siparis-notu.png', content: png, contentType: 'image/png' }]
    });
    db.addLog('Yaziciya siparis notu (el yazisi) gonderildi: ' + String(p.orderNo || '').slice(0, 40));
    return { sent: true };
  } catch (e) {
    db.addLog('Yaziciya siparis notu GÖNDERİLEMEDİ: ' + e.message);
    return { sent: false, reason: e.message };
  } finally {
    transport.close();
  }
}

module.exports = { printNote, printOrderNote, printedIds, markPrinted, cfg };