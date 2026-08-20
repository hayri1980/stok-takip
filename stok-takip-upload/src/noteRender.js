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

// Metni A4 yarım sayfa görüntüsüne çevirir (baskıda 2 not = 1 A4). PNG buffer döner.
async function renderNote(text, opts) {
  const puppeteer = require('puppeteer-core');
  const chrome = siralama.findChrome();
  if (!chrome) throw new Error('Chromium bulunamadı');
  const body = esc(opts && opts.raw ? text : (text + (opts && opts.footer ? ('\n' + opts.footer) : '')));
  const half = !opts || opts.half !== false; // varsayılan: yarım A4
  const W = 1240;
  const H = half ? 877 : 1754; // yarım A4 yükseklik
  const pad = half ? 46 : 70;
  const fs = half ? 27 : 36; // yazı büyütüldü (yarım sayfa rahat okunsun)
  const bottomGap = half ? 150 : 70; // metin ile köşe kutusu arası boşluk (kesim metni bozmasın)

  // Alt köşe: müşteri ad-soyad + kargo no (kesilip pakete yapıştırılır) — metinden AYRI
  let cornerBox = '';
  if (opts && opts.corner && (opts.corner.name || opts.corner.kargo)) {
    cornerBox =
      '<div style="position:absolute;right:46px;bottom:30px;border:2px solid #000;padding:14px 20px;' +
      'font-family:Elyaz,cursive;font-size:24px;line-height:1.55;background:#fff;">' +
      (opts.corner.name ? 'Müşteri: ' + esc(opts.corner.name) + '<br>' : '') +
      (opts.corner.kargo ? 'Kargo No: ' + esc(opts.corner.kargo) : '') +
      '</div>';
  }

  const html =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    "@font-face{font-family:'Elyaz';src:url('file://" + FONT + "') format('truetype');}" +
    '*{margin:0;padding:0;box-sizing:border-box;position:relative;}' +
    'body{font-family:Elyaz,cursive;color:#000;background:#fff;min-height:100%;' +
    'padding:' + pad + 'px 60px ' + bottomGap + 'px;white-space:pre-line;font-size:' + fs + 'px;line-height:1.62;}' +
    '</style></head><body>' + body + cornerBox + '</body></html>';

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // OTOMATİK SIĞDIRMA: içerik yarım A4'e taşarsa yazıyı (eşit oranda) küçült.
    const m = await page.evaluate(() => ({
      scrollH: document.body.scrollHeight,
      clientH: document.documentElement.clientHeight
    }));
    if (m.scrollH > m.clientH) {
      const scale = Math.max(0.55, (m.clientH - 6) / m.scrollH);
      await page.evaluate((s) => {
        const el = document.body;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        el.style.fontSize = (fs * s).toFixed(1) + 'px';
        el.style.lineHeight = (lh * s).toFixed(1) + 'px';
      }, scale);
      await new Promise(r => setTimeout(r, 60));
    }

    const shot = await page.screenshot({ encoding: 'binary' });
    return Buffer.isBuffer(shot) ? shot : Buffer.from(shot);
  } finally {
    await browser.close();
  }
}

module.exports = { renderNote };