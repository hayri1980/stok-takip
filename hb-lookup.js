// Hepsiburada kategori / marka / zorunlu özellik arama aracı
// Kullanım:
//   node hb-lookup.js                      -> balıkçılık kategorilerini + "Caparici" markasını listeler
//   node hb-lookup.js attrs <kategoriId>   -> o kategorinin zorunlu/isteğe bağlı özelliklerini listeler
//   node hb-lookup.js brand <markaAdı>     -> marka ara
// Önce panelden Hepsiburada Kullanıcı Adı (Merchant ID) ve API Parolası kaydedilmiş olmalı.
const db = require('./db');

const BASE = 'https://mpop.hepsiburada.com/product/api';
const KEYWORDS = ['olta', 'çapari', 'balik', 'balık', 'kamis', 'kamış', 'makara', 'kursun', 'kurşun', 'igne', 'iğne', 'yem', 'takim', 'takım', 'av'];

function authHeaders(cfg) {
  return {
    'Authorization': 'Basic ' + Buffer.from(cfg.username + ':' + cfg.password).toString('base64'),
    'Content-Type': 'application/json',
    'User-Agent': cfg.username + ' - StokTakip'
  };
}

async function getJson(url, cfg) {
  const res = await fetch(url, { headers: authHeaders(cfg) });
  if (!res.ok) {
    throw new Error('HB API hata (' + res.status + '): ' + (await res.text()).slice(0, 300));
  }
  return res.json();
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && payload.data && Array.isArray(payload.data.categories)) return payload.data.categories;
  if (payload && payload.data && Array.isArray(payload.data.items)) return payload.data.items;
  return [];
}

async function listCategories(cfg) {
  const data = await getJson(BASE + '/categories/get-all-categories', cfg);
  const cats = extractArray(data);
  const flat = [];
  const walk = (list, parents) => {
    for (const c of list || []) {
      const rec = {
        categoryId: c.categoryId ?? c.id,
        name: c.name || '',
        leaf: c.leaf === true || c.leaf === 'true' || !(Array.isArray(c.subCategories) && c.subCategories.length > 0),
        path: c.path || '',
        parents
      };
      flat.push(rec);
      if (Array.isArray(c.subCategories)) walk(c.subCategories, parents.concat(rec.name));
    }
  };
  walk(cats, []);
  return flat;
}

async function listBrands(cfg, name) {
  const url = BASE + '/brands?name=' + encodeURIComponent(name || '');
  const data = await getJson(url, cfg);
  return extractArray(data);
}

async function listAttributes(cfg, categoryId) {
  const data = await getJson(BASE + '/categories/' + categoryId + '/attributes', cfg);
  return extractArray(data);
}

function norm(s) {
  return String(s || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

(async () => {
  const cfg = db.getSettings().hepsiburada || {};
  if (!cfg.username || !cfg.password) {
    console.log('Hepsiburada API bilgileri eksik.');
    console.log('Önce panelde "Hepsiburada API" kartına Merchant ID ve API Parolası girip kaydet.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args[0] === 'brand') {
    const brands = await listBrands(cfg, args[1] || 'Caparici');
    console.log('Markalar:');
    for (const b of brands) console.log('  id=' + (b.id ?? b.brandId) + '  ' + (b.name || b.brandName));
    return;
  }

  if (args[0] === 'attrs') {
    const attrs = await listAttributes(cfg, args[1]);
    console.log(args[1] + ' kategorisinin özellikleri:');
    for (const a of attrs) {
      const req = a.required === true || a.zorunlu === true ? '[ZORUNLU]' : '';
      console.log('  ' + req + ' ' + (a.name || a.attributeName) + '  (id=' + (a.attributeId ?? a.id) + ')');
    }
    return;
  }

  const cats = await listCategories(cfg);
  console.log('Balıkçılık ile ilgili kategoriler:');
  let any = false;
  for (const c of cats) {
    const hay = KEYWORDS.some(k => norm(c.path || c.name).includes(norm(k)));
    if (!hay) continue;
    any = true;
    const leaf = c.leaf ? '(LEAF - ürün buraya)' : '';
    console.log('  id=' + c.categoryId + '  ' + [c.path, c.name].filter(Boolean).join(' / ') + '  ' + leaf);
  }
  if (!any) console.log('  (balıkçılık kategorisi bulunamadı)');

  console.log('');
  console.log('Marka (Caparici):');
  try {
    const brands = await listBrands(cfg, 'Caparici');
    for (const b of brands) console.log('  id=' + (b.id ?? b.brandId) + '  ' + (b.name || b.brandName));
  } catch (e) {
    console.log('  Marka listesi alınamadı: ' + e.message);
  }

  console.log('');
  console.log('Zorunlu özellikler için:  node hb-lookup.js attrs <kategoriId>');
})().catch(e => {
  console.error('HATA: ' + e.message);
  process.exit(1);
});
