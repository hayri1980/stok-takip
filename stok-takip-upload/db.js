const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
      hepsiburada: { username: '', password: '' },
      sync: { intervalMinutes: 30, threshold: 1 }
    },
    log: []
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
  save();
  return state;
}

function save() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
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
    trendyolNotified: false,
    hepsiburadaNotified: false,
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
  return state.products.find(p => p.barcode === barcode) || null;
}

function getProduct(id) {
  load();
  return state.products.find(p => p.id === id) || null;
}

function addProduct(data) {
  load();
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
    sync: { ...base.sync, ...(partial.sync || {}) }
  };
  return out;
}

function getLog() {
  load();
  return state.log;
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
  getLog
};
