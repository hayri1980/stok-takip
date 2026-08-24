// Sipariş notunu EL YAZISI (handwriting) görüntüsüne çevirir.
// TAM DİKEY A4 boyutunda (1240x1754) PNG üretir; not metni seçilen YARI'ya
// (top/bottom) yerleştirilir. Böylece Epson tam sayfa basar, kesilince alt yarı
// boş kalır ve 2. nota tekrar kullanılabilir. Alt köşede müşteri+kargo kutusu.

const siralama = require('./siralama');

const FONT = '/opt/stok-takip/el_yazisi.ttf';
const W = 1240;
const HALF_H = 877;

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// text: not metni | opts: { region: 'top'|'bottom', corner: {name,kargo} }
async function renderNote(text, opts) {
  const puppeteer = require('puppeteer-core');
  const chrome = siralama.findChrome();
  if (!chrome) throw new Error('Chromium bulunamadı');

  const o = opts || {};
  const region = o.region === 'bottom' ? 'bottom' : 'top';
  const body = esc(String(text || ''));

  let corner = '';
  if (o.corner && (o.corner.name || o.corner.kargo || o.corner.market)) {
    corner =
      '<div style="position:absolute;right:46px;bottom:30px;border:2px solid #000;padding:14px 20px;' +
      'font-family:Elyaz,cursive;font-size:24px;line-height:1.55;background:#fff;">' +
      (o.corner.market ? esc(o.corner.market) + '<br>' : '') +
      (o.corner.name ? 'Müşteri: ' + esc(o.corner.name) + '<br>' : '') +
      (o.corner.kargo ? 'Kargo No: ' + esc(o.corner.kargo) : '') +
      '</div>';
  }

  const wrapper =
    '<div id="w" style="position:absolute;left:0;right:0;' + (region === 'bottom' ? 'bottom:0;' : 'top:0;') +
    'height:' + HALF_H + 'px;padding:46px 60px 150px;box-sizing:border-box;' +
    'white-space:pre-line;font-family:Elyaz,cursive;font-size:27px;line-height:1.62;overflow:hidden;">' +
    body + corner + '</div>';

  const html =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    "@font-face{font-family:'Elyaz';src:url('file://" + FONT + "') format('truetype');}" +
    '*{margin:0;padding:0;box-sizing:border-box;position:relative;}' +
    'body{width:' + W + 'px;height:1754px;background:#fff;}' +
    '</style></head><body>' + wrapper + '</body></html>';

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: 1754, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Otomatik sığdırma: metin yarının içine taşarsa yazıyı küçült.
    const m = await page.evaluate(() => { const w = document.getElementById('w'); return { sh: w.scrollHeight, H: 877 }; });
    if (m.sh > m.H) {
      const scale = Math.max(0.5, (m.H - 6) / m.sh);
      await page.evaluate((s) => {
        const el = document.getElementById('w');
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