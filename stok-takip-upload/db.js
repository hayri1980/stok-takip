const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const backup = require('./src/backup');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

let state = null;

function defaultData() {
  return {
    products: [],
    settings: {
      mail: { from: '', password: '', to: '', enabled: false, notifySales: true },
      telegram: { botToken: '', chatId: '', enabled: false },
      trendyol: { apiKey: '', apiSecret: '', sellerId: '' },
      hepsiburada: { username: '', password: '', merchantId: '', userAgent: '', sit: false },
      pttavm: { apiKey: '', accessToken: '' },
      idefix: { apiKey: '', apiSecret: '', vendorId: '' },
      n11: { appKey: '', appSecret: '' },
      ciceksepeti: { apiKey: '' },
      sync: { intervalMinutes: 30, threshold: 1, pollSeconds: 15 },
      report: { enabled: true },
      ignoreBarcodes: [],
      productPush: {
        enabled: false,
        mappings: {
          hepsiburada: { categoryId: '', brand: '', vatRate: 20 },
          pttavm: { categoryId: '', brand: '', vatRate: 20 },
          idefix: { categoryId: '', brandId: '', vatRate: 20, cargoCompanyId: 0, shipmentAddressId: 0, returnAddressId: 0 },
          n11: { categoryId: '', brand: '', shipmentTemplate: '', currencyType: 'TRY' },
          ciceksepeti: { categoryId: '', deliveryType: 2, deliveryMessageType: 5 }
        }
      }
    },
    log: [],
    qnaNotifiedIds: [],
    orderNotifiedIds: [],
    dailySales: [],
      shop: {
        products: [],
        orders: [],
        stats: { visits: 0, daily: {} },
        settings: {
          storeName: 'Caparici',
          domain: 'caparici.com',
          phone: '',
          whatsapp: '',
          address: '',
          iban: '',
          ibanHolder: '',
          cargoFee: 0,
          freeShippingThreshold: 0,
          cargoCompany: 'Sürat Kargo',
          cargoTrackingUrl: 'https://gonderitakip.suratkargo.com.tr/Sorgu/',
          iyzico: { apiKey: '', secretKey: '', baseUrl: 'https://sandbox-api.iyzico.com', enabled: false },
          birfatura: { endpoint: '', username: '', password: '', enabled: false, invoiceType: 'earsiv', taxRate: 20 },
          notifyTelegram: true,
          metaDescription: 'İstavrit, uskumru, lüfer, palamut, çinekop ve kolyoz çapari modelleri. 7 li, 10 lu, 15 li çapari, çapari köstekleri ve yemli dip takımları uygun fiyata. Kıyı ve tekne çapari setleri.',
          metaKeywords: 'çapari, istavrit çaparisi, gece istavrit çaparisi, gece çaparisi, uskumru çaparisi, kolyoz çaparisi, çinekop çaparisi, lüfer çaparisi, palamut çaparisi, gümüş çaparisi, çapari köstekleri, 7 li istavrit çaparisi, 10 lu istavrit çaparisi, kıyı çaparisi, tekne çaparisi, 15 li çapari, yemli dip takımları, olta, balıkçılık malzemeleri'
        }
      }
  };
}

function load() {
  if (state) return state;
  if (!fs.existsSync(DATA_FILE)) {
    state = defaultData();
    save();
    return state;
  }
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    state = defaultData();
    save();
    return state;
  }
  const def = defaultData();
  state.settings = mergeSettings(def.settings, state.settings || {});
  if (!Array.isArray(state.products)) state.products = [];
  if (!Array.isArray(state.log)) state.log = [];
  if (!Array.isArray(state.qnaNotifiedIds)) state.qnaNotifiedIds = [];
  if (!Array.isArray(state.dailySales)) state.dailySales = [];
  if (!state.shop) state.shop = {};
  if (!Array.isArray(state.shop.products)) state.shop.products = [];
  if (!Array.isArray(state.shop.orders)) state.shop.orders = [];
  if (!state.shop.stats) state.shop.stats = { visits: 0, daily: {} };
  state.shop.settings = mergeShopSettings(def.shop.settings, state.shop.settings || {});
  save();
  return state;
}

function save() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
  backup.backupNow();
}

function genId() {
  return crypto.randomUUID();
}

function addLog(message) {
  load();
  state.log.unshift({ time: new Date().toISOString(), message });
  if (state.log.length > 500) state.log = state.log.slice(0, 500);
  save();
  return state.log;
}

function defaultProduct(data) {
  return {
    id: genId(),
    name: data.name || '',
    barcode: (data.barcode || '').trim(),
    trendyolStock: data.trendyolStock !== undefined && data.trendyolStock !== null ? Number(data.trendyolStock) : null,
    hepsiburadaStock: data.hepsiburadaStock !== undefined && data.hepsiburadaStock !== null ? Number(data.hepsiburadaStock) : null,
    pttavmStock: data.pttavmStock !== undefined && data.pttavmStock !== null ? Number(data.pttavmStock) : null,
    idefixStock: data.idefixStock !== undefined && data.idefixStock !== null ? Number(data.idefixStock) : null,
    n11Stock: data.n11Stock !== undefined && data.n11Stock !== null ? Number(data.n11Stock) : null,
    ciceksepetiStock: data.ciceksepetiStock !== undefined && data.ciceksepetiStock !== null ? Number(data.ciceksepetiStock) : null,
    sharedStock: data.sharedStock !== undefined && data.sharedStock !== null ? Number(data.sharedStock) : null,
    price: data.price !== undefined && data.price !== null ? Number(data.price) : null,
    listPrice: data.listPrice !== undefined && data.listPrice !== null ? Number(data.listPrice) : null,
    cost: data.cost !== undefined && data.cost !== null ? Number(data.cost) : null,
    idefixBarcode: data.idefixBarcode || null,
    priceUpdatedAt: data.priceUpdatedAt || null,
    lastSeenAt: data.lastSeenAt || null,
    disappearedNotified: data.disappearedNotified || false,
    pushed: data.pushed && typeof data.pushed === 'object' ? data.pushed : {},
    trendyolNotified: false,
    hepsiburadaNotified: false,
    pttavmNotified: false,
    idefixNotified: false,
    n11Notified: false,
    ciceksepetiNotified: false,
    lastSync: null,
    createdAt: new Date().toISOString()
  };
}

function getProducts() {
  load();
  return state.products;
}

function findProductByBarcode(barcode) {
  load();
  const needle = String(barcode || '').toLowerCase();
  return state.products.find(p => String(p.barcode || '').toLowerCase() === needle) || null;
}

function getProduct(id) {
  load();
  return state.products.find(p => p.id === id) || null;
}

function addProduct(data) {
  load();
  const barcode = String(data.barcode || '').trim();
  if (barcode) {
    const existing = state.products.find(p => String(p.barcode || '').trim().toLowerCase() === barcode.toLowerCase());
    if (existing) {
      const merged = Object.assign({}, existing);
      if (data.name !== undefined && data.name !== null && String(data.name) !== '') merged.name = data.name;
      for (const f of ['trendyolStock', 'hepsiburadaStock', 'pttavmStock', 'idefixStock', 'n11Stock', 'ciceksepetiStock', 'sharedStock', 'price', 'listPrice', 'cost']) {
        if (data[f] !== undefined && data[f] !== null) merged[f] = Number(data[f]);
      }
      if (data.priceUpdatedAt !== undefined) merged.priceUpdatedAt = data.priceUpdatedAt;
      if (data.lastSeenAt !== undefined) merged.lastSeenAt = data.lastSeenAt;
      if (data.pushed && typeof data.pushed === 'object') merged.pushed = data.pushed;
      state.products[state.products.indexOf(existing)] = merged;
      save();
      return merged;
    }
  }
  const product = defaultProduct(data);
  state.products.push(product);
  save();
  return product;
}

function updateProduct(id, data) {
  load();
  const idx = state.products.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const current = state.products[idx];
  const merged = { ...current, ...data, id: current.id, createdAt: current.createdAt };
  if (data.barcode !== undefined) merged.barcode = String(data.barcode).trim();
  if (data.name !== undefined) merged.name = data.name;
  if (data.trendyolStock !== undefined) merged.trendyolStock = data.trendyolStock === null ? null : Number(data.trendyolStock);
  if (data.hepsiburadaStock !== undefined) merged.hepsiburadaStock = data.hepsiburadaStock === null ? null : Number(data.hepsiburadaStock);
  if (data.pttavmStock !== undefined) merged.pttavmStock = data.pttavmStock === null ? null : Number(data.pttavmStock);
  if (data.idefixStock !== undefined) merged.idefixStock = data.idefixStock === null ? null : Number(data.idefixStock);
  if (data.n11Stock !== undefined) merged.n11Stock = data.n11Stock === null ? null : Number(data.n11Stock);
  if (data.ciceksepetiStock !== undefined) merged.ciceksepetiStock = data.ciceksepetiStock === null ? null : Number(data.ciceksepetiStock);
  if (data.sharedStock !== undefined) merged.sharedStock = data.sharedStock === null ? null : Number(data.sharedStock);
  if (data.price !== undefined) merged.price = data.price === null ? null : Number(data.price);
  if (data.listPrice !== undefined) merged.listPrice = data.listPrice === null ? null : Number(data.listPrice);
  if (data.cost !== undefined) merged.cost = data.cost === null ? null : Number(data.cost);
  if (data.priceUpdatedAt !== undefined) merged.priceUpdatedAt = data.priceUpdatedAt;
  if (data.lastSeenAt !== undefined) merged.lastSeenAt = data.lastSeenAt;
  if (data.disappearedNotified !== undefined) merged.disappearedNotified = !!data.disappearedNotified;
  if (data.pushed !== undefined && data.pushed && typeof data.pushed === 'object') merged.pushed = data.pushed;
  state.products[idx] = merged;
  save();
  return merged;
}

function deleteProduct(id) {
  load();
  state.products = state.products.filter(p => p.id !== id);
  save();
}

function getSettings() {
  load();
  return state.settings;
}

function setSettings(partial) {
  load();
  state.settings = mergeSettings(state.settings, partial);
  save();
  return state.settings;
}

function mergeSettings(base, partial) {
  const out = {
    mail: { ...base.mail, ...(partial.mail || {}) },
    telegram: { ...base.telegram, ...(partial.telegram || {}) },
    trendyol: { ...base.trendyol, ...(partial.trendyol || {}) },
    hepsiburada: { ...base.hepsiburada, ...(partial.hepsiburada || {}) },
    pttavm: { ...base.pttavm, ...(partial.pttavm || {}) },
    idefix: { ...base.idefix, ...(partial.idefix || {}) },
    n11: { ...base.n11, ...(partial.n11 || {}) },
    ciceksepeti: { ...base.ciceksepeti, ...(partial.ciceksepeti || {}) },
    sync: { ...base.sync, ...(partial.sync || {}) },
    report: { ...base.report, ...(partial.report || {}) },
    ignoreBarcodes: Array.isArray(partial.ignoreBarcodes) ? partial.ignoreBarcodes : (Array.isArray(base.ignoreBarcodes) ? base.ignoreBarcodes : []),
    cost: { ...(base.cost || {}), ...(partial.cost || {}) },
    productPush: mergeProductPush(base.productPush || {}, partial.productPush || {})
  };
  return out;
}

function mergeProductPush(base, partial) {
  const keys = ['hepsiburada', 'pttavm', 'idefix', 'n11', 'ciceksepeti'];
  const mappings = {};
  for (const k of keys) {
    mappings[k] = { ...(base.mappings && base.mappings[k]), ...(partial.mappings && partial.mappings[k]) };
  }
  return { ...base, ...partial, mappings };
}

function getLog() {
  load();
  return state.log;
}

function getQnaNotifiedIds() {
  load();
  return state.qnaNotifiedIds;
}

function addQnaNotifiedIds(ids) {
  load();
  const set = new Set(state.qnaNotifiedIds);
  for (const id of ids) set.add(String(id));
  state.qnaNotifiedIds = Array.from(set).slice(-500);
  save();
  return state.qnaNotifiedIds;
}

function getFinanceNotifiedIds() {
  load();
  return state.financeNotifiedIds || [];
}

function addFinanceNotifiedIds(ids) {
  load();
  const set = new Set(state.financeNotifiedIds || []);
  for (const id of ids) set.add(String(id));
  state.financeNotifiedIds = Array.from(set).slice(-1000);
  save();
  return state.financeNotifiedIds;
}

function getOrderNotifiedIds() {
  load();
  return state.orderNotifiedIds || [];
}

function addOrderNotifiedIds(ids) {
  load();
  const set = new Set(state.orderNotifiedIds || []);
  for (const id of ids) set.add(String(id));
  state.orderNotifiedIds = Array.from(set).slice(-2000);
  save();
  return state.orderNotifiedIds;
}

// ---- Mağaza ----
function mergeShopSettings(base, partial) {
  return {
    ...base,
    ...(partial || {}),
    iyzico: { ...base.iyzico, ...((partial || {}).iyzico || {}) },
    birfatura: { ...base.birfatura, ...((partial || {}).birfatura || {}) }
  };
}

function getShopProducts() {
  load();
  return state.shop.products;
}

function getShopProduct(id) {
  load();
  return state.shop.products.find(p => p.id === id) || null;
}

function addShopProduct(data) {
  load();
  const product = {
    id: genId(),
    name: (data.name || '').trim(),
    barcode: (data.barcode || '').trim(),
    price: Number(data.price) || 0,
    stock: data.stock !== undefined && data.stock !== null ? Number(data.stock) : null,
    category: (data.category || '').trim(),
    images: Array.isArray(data.images) ? data.images.slice(0, 6) : [],
    description: data.description || '',
    visible: data.visible !== false,
    featured: !!data.featured,
    source: data.source || 'manual',
    sold: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.shop.products.push(product);
  save();
  return product;
}

function updateShopProduct(id, data) {
  load();
  const idx = state.shop.products.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const current = state.shop.products[idx];
  const merged = { ...current, ...data, id: current.id, createdAt: current.createdAt };
  if (data.name !== undefined) merged.name = String(data.name).trim();
  if (data.barcode !== undefined) merged.barcode = String(data.barcode).trim();
  if (data.price !== undefined) merged.price = Number(data.price) || 0;
  if (data.stock !== undefined) merged.stock = data.stock === null ? null : Number(data.stock);
  if (data.category !== undefined) merged.category = String(data.category).trim();
  if (data.images !== undefined) merged.images = Array.isArray(data.images) ? data.images.slice(0, 6) : [];
  if (data.visible !== undefined) merged.visible = !!data.visible;
  if (data.featured !== undefined) merged.featured = !!data.featured;
  merged.updatedAt = new Date().toISOString();
  state.shop.products[idx] = merged;
  save();
  return merged;
}

function deleteShopProduct(id) {
  load();
  state.shop.products = state.shop.products.filter(p => p.id !== id);
  save();
}

function getShopOrders() {
  load();
  return state.shop.orders;
}

function getShopOrder(id) {
  load();
  return state.shop.orders.find(o => o.id === id) || null;
}

function addShopOrder(data) {
  load();
  const now = new Date().toISOString();
  const order = {
    id: genId(),
    orderNo: 'S' + Date.now().toString(36).toUpperCase(),
    items: Array.isArray(data.items) ? data.items : [],
    customer: data.customer || {},
    paymentMethod: data.paymentMethod || 'eft',
    subtotal: Number(data.subtotal) || 0,
    cargoFee: Number(data.cargoFee) || 0,
    total: Number(data.total) || 0,
    status: 'bekliyor',
    cargoNumber: '',
    cargoCompany: '',
    createdAt: now,
    updatedAt: now
  };
  state.shop.orders.unshift(order);
  save();
  return order;
}

function updateShopOrder(id, data) {
  load();
  const idx = state.shop.orders.findIndex(o => o.id === id);
  if (idx === -1) return null;
  state.shop.orders[idx] = { ...state.shop.orders[idx], ...data, id, updatedAt: new Date().toISOString() };
  save();
  return state.shop.orders[idx];
}

function getShopSettings() {
  load();
  return state.shop.settings;
}

function setShopSettings(partial) {
  load();
  state.shop.settings = mergeShopSettings(state.shop.settings, partial);
  save();
  return state.shop.settings;
}

function incrementShopProductSold(id, qty) {
  load();
  const p = state.shop.products.find(x => x.id === id);
  if (!p) return null;
  p.sold = (Number(p.sold) || 0) + Math.max(0, Number(qty) || 0);
  p.updatedAt = new Date().toISOString();
  save();
  return p;
}

function dayKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function addDailySale(sale) {
  load();
  const ts = sale.ts || new Date().toISOString();
  state.dailySales.push({
    ts,
    date: sale.date || localDayKey(new Date(ts)),
    name: sale.name || '',
    barcode: sale.barcode || '',
    market: sale.market || '',
    qty: Math.max(0, Number(sale.qty) || 0),
    price: Number(sale.price) > 0 ? Number(sale.price) : null,
    cost: Number(sale.cost) > 0 ? Number(sale.cost) : null
  });
  save();
  return state.dailySales;
}

function getDailySales(date) {
  load();
  if (!date) return state.dailySales;
  return state.dailySales.filter(s => s.date === date);
}

function purgeDailySales(keepDays) {
  load();
  const keep = Math.max(1, Number(keepDays) || 30);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keep);
  const cutoffKey = localDayKey(cutoff);
  state.dailySales = state.dailySales.filter(s => s.date >= cutoffKey);
  save();
  return state.dailySales;
}

function recordShopVisit() {
  load();
  const key = dayKey(new Date());
  state.shop.stats.visits = (state.shop.stats.visits || 0) + 1;
  if (!state.shop.stats.daily) state.shop.stats.daily = {};
  state.shop.stats.daily[key] = (state.shop.stats.daily[key] || 0) + 1;
  save();
  return state.shop.stats;
}

function getShopStats() {
  load();
  const s = state.shop.stats || { visits: 0, daily: {} };
  const today = dayKey(new Date());
  const daily = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(new Date(Date.now() - i * 86400000));
    daily.push({ day: k, count: s.daily[k] || 0 });
  }
  const orders = state.shop.orders;
  return {
    visitsTotal: s.visits || 0,
    today: s.daily[today] || 0,
    daily,
    ordersTotal: orders.length,
    revenue: orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0),
    soldTotal: state.shop.products.reduce((sum, p) => sum + (Number(p.sold) || 0), 0)
  };
}

module.exports = {
  load,
  save,
  addLog,
  getProducts,
  findProductByBarcode,
  getProduct,
  addProduct,
  updateProduct,
  deleteProduct,
  getSettings,
  setSettings,
  getLog,
  getQnaNotifiedIds,
  addQnaNotifiedIds,
  getFinanceNotifiedIds,
  addFinanceNotifiedIds,
  getOrderNotifiedIds,
  addOrderNotifiedIds,
  localDayKey,
  addDailySale,
  getDailySales,
  purgeDailySales,
  getShopProducts,
  getShopProduct,
  addShopProduct,
  updateShopProduct,
  deleteShopProduct,
  getShopOrders,
  getShopOrder,
  addShopOrder,
  updateShopOrder,
  getShopSettings,
  setShopSettings,
  incrementShopProductSold,
  recordShopVisit,
  getShopStats
};
