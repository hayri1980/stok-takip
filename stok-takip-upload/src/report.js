const db = require('../db');
const notifier = require('./notifier');
const sync = require('./sync');

function displayDate(key) {
  const parts = String(key || '').split('-');
  return parts.length === 3 ? parts[2] + '.' + parts[1] + '.' + parts[0] : key;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildDailyReportText(sales, date) {
  const lines = [];
  lines.push('GUN SONU RAPORU — ' + displayDate(date));
  lines.push('(00:00 - 23:59 arasi satislar)');
  lines.push('--------------------------------');
  if (!sales || sales.length === 0) {
    lines.push('Bu gun satis yok.');
  } else {
    const groups = new Map();
    for (const s of sales) {
      const key = s.name + '|' + s.barcode + '|' + s.market;
      groups.set(key, (groups.get(key) || 0) + (Number(s.qty) || 0));
    }
    for (const [key, qty] of groups) {
      const parts = key.split('|');
      lines.push(parts[0] + ' (' + parts[1] + ') - ' + parts[2] + ': ' + qty + ' adet');
    }
  }
  lines.push('--------------------------------');
  const total = (sales || []).reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
  lines.push('Toplam satis: ' + total + ' adet');
  return lines.join('\n');
}

async function sendDailyReport() {
  const settings = db.getSettings();
  const rep = settings.report || {};
  if (rep.enabled === false) return { skipped: true, reason: 'Gün sonu raporu kapalı' };
  if (sync.marketConfiguredKinds().length === 0) {
    return { skipped: true, reason: 'Pazar yeri API ayarları yok (rapor için senkron gerekli)' };
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = db.localDayKey(yesterday);

  const sales = db.getDailySales(date);
  const text = buildDailyReportText(sales, date);
  const subject = 'Gün sonu raporu — ' + displayDate(date);
  const html = '<h3>Gün sonu raporu — ' + displayDate(date) + '</h3><pre>' + escapeHtml(text) + '</pre>';

  const results = await notifier.notify(subject, html, text);
  const sent = (results.email && results.email.sent) || (results.telegram && results.telegram.sent);
  db.addLog('Gün sonu raporu gönderildi (' + date + '): ' + sales.length + ' satış kaydı' + (sent ? '' : ', GÖNDERİLEMEDİ'));

  const total = sales.reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
  db.purgeDailySales(30);
  return { date, sales: sales.length, total, sent, results };
}

async function maybeSendDailyReport() {
  const rep = db.getSettings().report || {};
  if (rep.enabled === false) return { skipped: true, reason: 'Gün sonu raporu kapalı' };

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = db.localDayKey(yesterday);
  if (rep.lastReportDate === date) return { skipped: true, reason: 'Bugünün raporu zaten gönderildi' };

  const result = await sendDailyReport();
  if (result.sent) {
    db.setSettings({ report: { ...db.getSettings().report, lastReportDate: date } });
  }
  return result;
}

module.exports = { sendDailyReport, maybeSendDailyReport, buildDailyReportText };
