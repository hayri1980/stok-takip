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
  const settings = db.getSettings();
  const costCfg = settings.cost || {};
  const commissionPct = Number(costCfg.commissionPercent) > 0 ? Number(costCfg.commissionPercent) : 0;
  const shippingCost = Number(costCfg.shipping) > 0 ? Number(costCfg.shipping) : 0;
  const feeCost = Number(costCfg.fee) > 0 ? Number(costCfg.fee) : 0;
  const hasCostCfg = commissionPct > 0 || shippingCost > 0 || feeCost > 0;
  let totalQty = 0;
  let totalRevenue = 0;
  let totalDeduct = 0;
  if (!sales || sales.length === 0) {
    lines.push('Bu gun satis yok.');
  } else {
    const groups = new Map();
    for (const s of sales) {
      const key = s.name + '|' + s.barcode + '|' + s.market;
      const qty = Number(s.qty) || 0;
      let price = Number(s.price) > 0 ? Number(s.price) : null;
      let cost = Number(s.cost) > 0 ? Number(s.cost) : null;
      const p = db.findProductByBarcode(s.barcode);
      if (price === null && p) price = p.price !== null && p.price !== undefined ? Number(p.price) : null;
      if (cost === null && p) cost = Number(p.cost) > 0 ? Number(p.cost) : null;
      const revenue = price !== null ? Math.round(qty * price * 100) / 100 : null;
      let deduct = null;
      if (price !== null) {
        const prodCost = cost !== null ? cost : 0;
        const perUnit = prodCost + (hasCostCfg ? price * commissionPct / 100 + shippingCost + feeCost : 0);
        if (perUnit > 0) deduct = Math.round(qty * perUnit * 100) / 100;
      }
      const rec = groups.get(key);
      if (rec) {
        rec.qty += qty;
        if (revenue !== null) rec.revenue = Math.round((rec.revenue + revenue) * 100) / 100;
        if (price !== null) rec.price = price;
        if (deduct !== null) rec.deduct = Math.round((rec.deduct + deduct) * 100) / 100;
      } else {
        groups.set(key, { qty, revenue: revenue, deduct: deduct });
      }
    }
    for (const [key, rec] of groups) {
      const parts = key.split('|');
      totalQty += rec.qty;
      if (rec.revenue !== null) totalRevenue = Math.round((totalRevenue + rec.revenue) * 100) / 100;
      if (rec.deduct !== null) totalDeduct = Math.round((totalDeduct + rec.deduct) * 100) / 100;
      lines.push(parts[0] + ' (' + parts[1] + ') - ' + parts[2] + ': ' + rec.qty + ' adet' +
        (rec.revenue !== null ? ' = ' + rec.revenue + ' TL' : ''));
    }
  }
  lines.push('--------------------------------');
  lines.push('Toplam satis: ' + totalQty + ' adet');
  if (totalRevenue > 0) lines.push('Gunun ciro: ' + Math.round(totalRevenue * 100) / 100 + ' TL');
  if (totalDeduct > 0) {
    lines.push('Maliyet ve kesintiler: ' + Math.round(totalDeduct * 100) / 100 + ' TL');
    lines.push('NET KAR: ' + Math.round((totalRevenue - totalDeduct) * 100) / 100 + ' TL');
  }
  return lines.join('\n');
}

function buildCriticalStockText() {
  const settings = db.getSettings();
  const threshold = Math.max(0, Number(settings.sync.threshold) || 1);
  const products = db.getProducts();
  const critical = products.filter(p => sync.MARKETS.some(k => {
    const v = p[k + 'Stock'];
    return v !== null && v !== undefined && Number(v) <= threshold;
  }));
  if (critical.length === 0) return null;
  const lines = [];
  lines.push('');
  lines.push('KRITIK STOK HATIRLATMALARI');
  lines.push('--------------------------------');
  for (const p of critical) {
    const details = sync.MARKETS
      .filter(k => {
        const v = p[k + 'Stock'];
        return v !== null && v !== undefined && Number(v) <= threshold;
      })
      .map(k => sync.kindLabel(k) + ': ' + p[k + 'Stock']);
    lines.push(p.barcode + (p.price ? ' (' + p.price + ' TL)' : '') + ' - ' + details.join(', '));
  }
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
  const criticalText = buildCriticalStockText();
  const text = buildDailyReportText(sales, date) + (criticalText ? criticalText : '');
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
