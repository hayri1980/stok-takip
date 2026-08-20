// Sipariş notunu EL YAZISI (handwriting) görüntüsüne çevirir — Epson Email Print'e
// PNG ek olarak gider; böylece yazıcı el yazısı gibi basar (düz font değil).
// Font: Caveat (Google Fonts, Türkçe destekli) — /opt/stok-takip/el_yazisi.ttf

const siralama = require('./siralama');

const FONT = '/opt/stok-takip/el_yazisi.ttf';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Metni A4-ekran görüntüsüne çevirir; PNG buffer döner.
async function renderNote(text, opts) {
  const puppeteer = require('puppeteer-core');
  const chrome = siralama.findChrome();
  if (!chrome) throw new Error('Chromium bulunamadı');
  const body = esc(opts && opts.raw ? text : (text + (opts && opts.footer ? ('\n' + opts.footer) : '')));

  const html =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    "@font-face{font-family:'Elyaz';src:url('file://" + FONT + "') format('truetype');}" +
    '*{margin:0;padding:0;box-sizing:border-box;}' +
    'body{font-family:Elyaz,cursive;color:#000;background:#fff;' +
    'padding:70px 80px;white-space:pre-line;font-size:36px;line-height:1.75;}' +
    '</style></head><body>' + body + '</body></html>';

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const shot = await page.screenshot({ encoding: 'binary' });
    return Buffer.isBuffer(shot) ? shot : Buffer.from(shot);
  } finally {
    await browser.close();
  }
}

module.exports = { renderNote };