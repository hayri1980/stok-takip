const fs = require('fs');
const path = require('path');
const db = require('../db');
const notifier = require('./notifier');

// Arama kelimesinde (ör. "istavrit çaparisi") BİZİM ürünlerimizin kaçıncı sırada
// olduğunu TARAYICI ile (API değil, müşteri gibi dışarıdan) bulur.
// Çalışan pazaryerleri (19.08 denendi): idefix ✅, n11 ✅. Trendyol/PTT AVM Cloudflare
// ile engelliyor (403). Kurşun ürünleri rapora girmez (sadece çapariler).
//
// Pupteer-core kullanılır; Chromium VPS'te whatsapp-web.js için kurulu olan
// puppeteer indirmesidir (findChrome ile bulunur).

const CHROME_BASE = '/root/.cache/puppeteer/chrome';

function findChrome() {
  const cands = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const c of cands) if (fs.existsSync(c)) return c;
  try {
    if (fs.existsSync(CHROME_BASE)) {
      for (const v of fs.readdirSync(CHROME_BASE)) {
        const p = path.join(CHROME_BASE, v, 'chrome-linux64', 'chrome');
        if (fs.existsSync(p)) return p;
      }
    }
  } catch (e) {}
  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normalize(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
}

// Bizim ürün mü? marka "Çaparici"/"Caparici" ile başlıyor olması yeterli.
// Kurşun ürünleri hariç tut: başlığında "kurşun" geçip "çaparisi" GEÇMEYENLER
// (ör. "Çaparici 50 Gr Armut Dip Kurşun" → kurşun ürünü, atlanır; ama
// "Çaparici ... 4 Adet Kurşun ... İstavrit Çaparisi" → çapari seti, gösterilir).
function isOurProduct(title) {
  const n = normalize(title);
  if (n.indexOf('aparici') === -1) return false;
  if (n.indexOf('kursun') !== -1 && n.indexOf('caparisi') === -1) return false;
  return true;
}

async function launchBrowser() {
  const puppeteer = require('puppeteer-core');
  const chrome = findChrome();
  if (!chrome) throw new Error('Chromium bulunamadı');
  return puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--lang=tr-TR'
    ]
  });
}

let ua = null;
function getUserAgent() {
  if (!ua) {
    ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  }
  return ua;
}

// Bir pazaryerinde aramayı yap, ürün kartlarını DOM sırasıyla topla.
// Dönüş: { status, total, ours: [{ rank, title, link }] }
async function scanMarket(browser, market, keyword) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(getUserAgent());
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
    let url;
    if (market === 'idefix') url = 'https://www.idefix.com/arama?q=' + encodeURIComponent(keyword);
    else if (market === 'n11') url = 'https://www.n11.com/arama?q=' + encodeURIComponent(keyword);
    else throw new Error('Bilinmeyen pazaryeri: ' + market);

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const status = resp ? resp.status() : 0;
    if (status === 403) return { status, total: 0, ours: [], blocked: true };
    await sleep(7000); // sayfanın ürünleri render etmesi için

    let items = [];
    if (market === 'idefix') {
      // Ürünler <h3> başlığında; DOM sırası = görsel sıra.
      items = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('h3'))
          .map(h => ({ title: (h.innerText || '').replace(/\s+/g, ' ').trim(), link: '' }))
          .filter(x => x.title);
      });
    } else {
      // n11 ürün kartları a[href^="/urun/"] şeklindedir.
      items = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .filter(a => /^\/urun\//.test(a.getAttribute('href') || '') || /\/urun\/|urun-detay/.test(a.getAttribute('href') || ''))
          .map(a => ({ title: (a.innerText || '').replace(/\s+/g, ' ').trim(), link: (a.getAttribute('href') || '') }))
          .filter(x => x.title);
      });
    }

    const ours = [];
    items.forEach((it, idx) => {
      if (!isOurProduct(it.title)) return;
      const link = String(it.link || '').split('#')[0];
      ours.push({ rank: idx + 1, title: it.title, link });
    });

    return { status, total: items.length, ours };
  } finally {
    await page.close();
  }
}

// Kelime için tüm pazaryerlerini tara. Dönüş: { keyword, ts, markets: { idefix: {...} } }
async function scanAll(rootCfg) {
  const cfg = rootCfg || db.getSettings().siralama || {};
  const markets = Array.isArray(cfg.markets) && cfg.markets.length ? cfg.markets : ['idefix'];
  const keyword = String(cfg.keyword || 'istavrit çaparisi').trim() || 'istavrit çaparisi';
  const results = { keyword, ts: new Date().toISOString(), markets: {} };

  const browser = await launchBrowser();
  try {
    for (const m of markets) {
      try {
        results.markets[m] = await scanMarket(browser, m, keyword);
      } catch (e) {
        results.markets[m] = { error: e.message };
      }
    }
  } finally {
    try { await browser.close(); } catch (e) {}
  }
  return results;
}

function buildReport(results) {
  const lines = ['SIRALAMA — "' + results.keyword + '"', 'Zaman: ' + new Date(results.ts).toLocaleString('tr-TR'), ''];
  let any = false;
  for (const m of Object.keys(results.markets)) {
    const mm = results.markets[m];
    const label = m === 'idefix' ? 'idefix' : (m === 'n11' ? 'n11' : m);
    lines.push('『 ' + label.toUpperCase() + ' 』');
    if (mm.error) {
      lines.push('  Hata: ' + mm.error);
      continue;
    }
    if (mm.blocked) {
      lines.push('  Engellendi (403) - pazaryeri bot koruması');
      continue;
    }
    lines.push('  Toplam ürün: ' + mm.total);
    if (mm.ours && mm.ours.length) {
      for (const o of mm.ours) {
        lines.push('  ' + o.rank + ') ' + o.title);
      }
      const best = Math.min(...mm.ours.map(o => o.rank));
      lines.push('  En iyi sıra: ' + best);
    } else {
      lines.push('  Bizim ürün görünmedi.');
    }
    any = true;
    lines.push('');
  }
  if (!any) lines.push('Pazaryeri ayarı yok veya hepsi hatalı.');
  return lines.join('\n');
}

// Taramayı çalıştır + kaydet + bildir. manual=true ise /siralama komutu
function runScan({ notify, manual } = {}) {
  return (async () => {
    const results = await scanAll();
    db.setSiralamaLast(results);
    const text = buildReport(results);
    if (notify || manual) {
      const html = '<h3>Sıralama — "' + results.keyword + '"</h3><pre style="font-size:12px">' +
        text.replace(/</g, '&lt;') + '</pre>';
      await notifier.notify('SIRALAMA (' + results.keyword + ')', html, text);
    }
    db.addLog('Sıralama taraması tamam: "' + results.keyword + '" -> ' + Object.keys(results.markets).join(','));
    return results;
  })();
}

module.exports = { scanAll, buildReport, runScan, findChrome };