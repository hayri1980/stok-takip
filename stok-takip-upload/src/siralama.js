const fs = require('fs');
const path = require('path');
const db = require('../db');
const notifier = require('./notifier');

// Arama kelimesinde BİZİM ürünlerimizin kaçıncı sırada olduğunu TARAYICI ile bulur.
// (API değil; müşteri gibi dışarıdan siteye girilir — kullanıcı isteği.)
//
// Çalışan pazaryerleri (19.08 denenip doğrulandı): idefix ✅, hepsiburada ✅.
// Trendyol/PTT AVM Cloudflare bot koruması ile engelliyor (deneysel konu, ayrı başlık).
//
// ÜRÜN TANITIMI: bot bilgileri settings.siralama.urunler'a kaydedilir (Trendyol
// kataloğumuzdan çekilir — kendi hesabımız, meşru). Kurşunlar hariç tutulur;
// sadece çapariler ('istavrit çaparisi' kelimesinde arayacağımız ürünler).

const CHROME_BASE = '/root/.cache/puppeteer/chrome';

// Trendyol kataloğundan çaparileri al + ayarlara kaydet (kurşunlar hariç).
async function refreshProducts() {
  try {
    const ty = require('./trendyol');
    const cfg = db.getSettings().trendyol;
    if (!(cfg.apiKey && cfg.apiSecret && cfg.sellerId)) return db.getSettings().siralama.urunler || [];
    const list = await ty.fetchProductCatalog(cfg.sellerId, cfg.apiKey, cfg.apiSecret);
    const urunler = list
      .filter(p => !/kur.?un/i.test(p.name || ''))
      .map(p => ({ barcode: String(p.barcode), name: String(p.name || '') }))
      .filter(p => p.name);
    if (urunler.length) {
      db.setSettings({ siralama: { ...(db.getSettings().siralama || {}), urunler } });
    }
    return urunler;
  } catch (e) {
    return db.getSettings().siralama.urunler || [];
  }
}

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

function toks(s) {
  return normalize(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(x => x.length > 1);
}

// Kelime ortaklık oranı (fallback ad etiketleme için).
function score(nameTokens, itemTitle) {
  const b = toks(itemTitle);
  if (!b.length) return 0;
  let hit = 0;
  const sb = new Set(b);
  for (const t of nameTokens) if (sb.has(t)) hit++;
  return hit / nameTokens.length;
}

// Kelime karşılaştırma için kullanılan karakter-temiz sürüm (harf+rakam, boşluksuz).
function collapse(s) {
  return normalize(s).replace(/[^a-z0-9]/g, '');
}

// ---- Ürün İMZALARI (ayırt edici anahtar cümle) ----
// Türkçe normalleştirme ile eşleşmesi için küçük harf + boşluklu yazılır;
// eşleşmede collapse ile (türkçe harsiz + noktalama atılmış) karşılaştırılır.
// Sıralama, "(5 Adet)" vs "(10 Adet)" gibi benzer kardeşleri ayırt eder.
const PRODUCT_KEYS = {
  '7KBX4': '6 numara kahve renk tuy 7 numara beyaz tuy',
  '10TX4': 'tuy 4 adet 10 numara igne 025 beden 015 kostek 150 gr atar kapasitesi',
  '7KTX3': '3 adet farkli igne farkli tuy',
  'P15X4': '15 igneli istavrit caparisi 4 adet 60 gr 4 adet kursun',
  '7TX3': 'istavrit uskumru kolyoz tuy capari',
  'P7KX5': 'gece caparisi 5 adet 5 adet 30 gr kursun',
  '10fx5': '5 adet 11 numara igne 025 beden 015 kostek 150 gr atarl kapasitesi kopuge sarili dugumlu el baglamasi',
  'f10x10': '10 adet 11 numara igne 025 beden 015 kostek 150 gr atarl kapasitesi kopuge sarili dugumlu el baglamasi'
};

// itemTitle -> bizim hangi ürün olduğu {barcode,name,skor} | null
function matchProduct(itemTitle, urunler) {
  const card = collapse(itemTitle);
  if (!card) return null;
  // 1) Önce imza: ürünün ayırt edici cümlesi kart içinde geçiyorsa kesin o ürün.
  for (const u of urunler) {
    const key = PRODUCT_KEYS[u.barcode];
    if (key && collapse(key).length >= 6 && card.indexOf(collapse(key)) !== -1) {
      return { barcode: u.barcode, name: u.name, skor: 100 };
    }
  }
  // 2) İmza bulunamadıysa ama kartta markamız varsa -> bizim ürün olduğu kesin;
  //    adını en çok örtüşen tanımlı ürünle etiketle (başlık kesilmiş olabilir).
  if (/aparici/i.test(itemTitle)) {
    let best = null, bestScore = 0;
    for (const u of urunler) {
      const s = score(toks(u.name), itemTitle);
      if (s > bestScore) { bestScore = s; best = u; }
    }
    if (best) return { barcode: best.barcode, name: best.name, skor: Math.max(70, Math.round(bestScore * 100)) };
    return { barcode: 'CAPARICI', name: 'Çaparici (ürün adı eşleşmedi)', skor: 90 };
  }
  return null;
}

async function launchBrowser() {
  const puppeteer = require('puppeteer-core');
  const chrome = findChrome();
  if (!chrome) throw new Error('Chromium bulunamadı');
  return puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=tr-TR', '--disable-blink-features=AutomationControlled']
  });
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

async function preparePage(page) {
  await page.setViewport({ width: 1366, height: 768 });
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
}

// Pazaryerinde kelimeyi ara; sayfa adım adım gezilir, ürün kartları DOM sırasıyla okunur.
// Dönüş: { status, total, ours: [{rank, barcode, name, title, skor}] }
async function scanMarket(browser, market, keyword, urunler, maxPages) {
  const page = await browser.newPage();
  try {
    await preparePage(page);

    const PAGE_SIZE = market === 'hepsiburada' ? 36 : 24;
    let globalRank = 0;
    let status = 0;
    let ours = [];
    let pageCount = 0;

    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      let url;
      if (market === 'idefix') {
        url = 'https://www.idefix.com/arama?q=' + encodeURIComponent(keyword) + '&sayfa=' + pageNo;
      } else if (market === 'hepsiburada') {
        // HB arama: p1 -> ?q=..., devamı sayfa=2 (sayfa2)
        url = 'https://www.hepsiburada.com/ara?q=' + encodeURIComponent(keyword) + (pageNo === 1 ? '' : '&sayfa=' + pageNo);
      } else {
        throw new Error('Bilinmeyen pazaryeri: ' + market);
      }

      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (pageNo === 1) status = resp ? resp.status() : 0;
      if (status === 403) return { status, total: 0, ours: [], blocked: true };
      await sleep(6500);

      let items = [];
      if (market === 'idefix') {
        items = await page.evaluate(() =>
          Array.from(document.querySelectorAll('h3'))
            .map(h => (h.innerText || '').replace(/\s+/g, ' ').trim())
            .filter(x => x)
        );
      } else {
        const list = await page.evaluate(() => {
          const el = document.querySelector('ul[class*="productList"], ol[class*="productList"]');
          if (!el) return [];
          return Array.from(el.children)
            .filter(li => li && li.tagName === 'LI')
            .map(li => (li.innerText || '').replace(/\s+/g, ' ').trim())
            .filter(x => x.length > 8);
        });
        // HB kartında "Teslimat bilgisi: ..." öneki başlıktan önce; ürün adı genelde ondan sonradır.
        items = list;
      }

      if (items.length === 0 && pageNo > 1) break;

      for (const it of items) {
        globalRank++;
        const m = matchProduct(it, urunler);
        if (m) {
          ours.push({ rank: globalRank, barcode: m.barcode, name: m.name, title: it, skor: Math.round(m.skor * 100) });
        }
      }
      pageCount = pageNo;
      // Sayfa dolmadıysa (kısa sonuç) bitir
      if (items.length < PAGE_SIZE) break;
      if (pageNo >= maxPages) break;
    }

    return { status, total: globalRank, ours, pages: pageCount };
  } finally {
    await page.close();
  }
}

async function scanAll(rootCfg) {
  const cfg = Object.assign({}, rootCfg || db.getSettings().siralama || {});
  const markets = Array.isArray(cfg.markets) && cfg.markets.length ? cfg.markets : ['hepsiburada'];
  const keyword = String(cfg.keyword || 'istavrit çaparisi').trim() || 'istavrit çaparisi';
  const maxPages = Math.max(1, Math.min(20, Number(cfg.maxPages) || 5));

  const urunler = await refreshProducts();
  const results = { keyword, ts: new Date().toISOString(), urunler: urunler.map(u => u.barcode), markets: {} };

  const browser = await launchBrowser();
  try {
    for (const m of markets) {
      try {
        results.markets[m] = await scanMarket(browser, m, keyword, urunler, maxPages);
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
  if (results.urunler && results.urunler.length) {
    lines.push('Tanitilan capari urun: ' + results.urunler.length + ' (kayitli)');
  }
  let any = false;
  for (const m of Object.keys(results.markets)) {
    const mm = results.markets[m];
    const label = m === 'hepsiburada' ? 'Hepsiburada' : (m === 'idefix' ? 'idefix' : m);
    lines.push('『 ' + label.toUpperCase() + ' 』');
    if (mm.error) { lines.push('  Hata: ' + mm.error); continue; }
    if (mm.blocked) { lines.push('  Sayfa engellendi (403)'); continue; }
    lines.push('  Taranan: ' + mm.total + ' urun (sayfa ' + (mm.pages || 1) + ')');
    if (mm.ours && mm.ours.length) {
      for (const o of mm.ours) {
        lines.push('  ' + o.rank + ') ' + o.barcode + ' - ' + o.name);
      }
      const best = Math.min(...mm.ours.map(o => o.rank));
      lines.push('  En iyi sira: ' + best);
    } else {
      lines.push('  Caparilerimiz gorunmedi (ilk ' + (mm.pages || 1) + ' sayfada).');
    }
    any = true;
    lines.push('');
  }
  if (!any) lines.push('Pazaryeri ayari yok veya hepsi hatali.');
  return lines.join('\n');
}

function runScan({ notify, manual } = {}) {
  return (async () => {
    const results = await scanAll();
    db.setSiralamaLast(results);
    const text = buildReport(results);
    if (notify || manual) {
      const html = '<h3>Sıralama — "' + results.keyword + '"</h3><pre style="font-size:12px">' + text.replace(/</g, '&lt;') + '</pre>';
      await notifier.notify('SIRALAMA (' + results.keyword + ')', html, text);
    }
    db.addLog('Sıralama taraması tamam: "' + results.keyword + '" -> ' + Object.keys(results.markets).join(','));
    return results;
  })();
}

module.exports = { scanAll, buildReport, runScan, findChrome, refreshProducts, matchProduct };