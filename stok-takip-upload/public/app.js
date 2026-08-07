const API = {
  products: '/api/products',
  settings: '/api/settings',
  log: '/api/log',
  sync: '/api/sync',
  testMail: '/api/test-mail',
  testTelegram: '/api/test-telegram'
};

let products = [];
let notifyThreshold = 1;

async function request(url, method = 'GET', body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'İstek başarısız');
  return data;
}

// ---------- Sekmeler ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'log') loadLog();
  });
});

// ---------- Stoklar ----------
function status(qty) {
  if (qty === null || qty === undefined) return { label: '—', cls: 'na' };
  if (qty <= 0) return { label: 'Bitti', cls: 'danger' };
  if (qty <= notifyThreshold) return { label: 'Kritik', cls: 'warn' };
  return { label: 'Var', cls: 'ok' };
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

function stockCell(qty) {
  const s = status(qty);
  const val = qty === null || qty === undefined ? '—' : qty;
  return '<span class="stock"><b>' + val + '</b> <span class="badge ' + s.cls + '">' + s.label + '</span></span>';
}

function renderProducts() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const tbody = document.getElementById('productTable');
  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q)
  );
  tbody.innerHTML = filtered.map(p => {
    const ty = stockCell(p.trendyolStock);
    const hb = stockCell(p.hepsiburadaStock);
    return '<tr>' +
      '<td>' + escapeHtml(p.name) + '</td>' +
      '<td class="mono">' + escapeHtml(p.barcode) + '</td>' +
      '<td>' + ty + '</td>' +
      '<td>' + hb + '</td>' +
      '<td class="muted">' + fmtTime(p.lastSync) + '</td>' +
      '<td class="actions">' +
        '<button class="btn small" onclick="openEdit(\'' + p.id + '\')">Düzenle</button> ' +
        '<button class="btn small danger-btn" onclick="removeProduct(\'' + p.id + '\')">Sil</button>' +
      '</td>' +
      '</tr>';
  }).join('');
  document.getElementById('emptyNote').style.display = filtered.length ? 'none' : 'block';
  renderSummary();
}

function renderSummary() {
  const total = products.length;
  let out = 0, low = 0;
  for (const p of products) {
    for (const s of [p.trendyolStock, p.hepsiburadaStock]) {
      if (s === null || s === undefined) continue;
      if (s <= 0) out++;
      else if (s <= notifyThreshold) low++;
    }
  }
  document.getElementById('summary').innerHTML =
    '<span class="pill">Ürün: ' + total + '</span>' +
    '<span class="pill pill-danger">Stok biten: ' + out + '</span>' +
    '<span class="pill pill-warn">Kritik (en fazla ' + notifyThreshold + '): ' + low + '</span>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadProducts() {
  products = await request(API.products);
  renderProducts();
}

// ---------- Ürün Ekle/Düzenle ----------
const modal = document.getElementById('modal');

function openAdd() {
  document.getElementById('modalTitle').textContent = 'Ürün Ekle';
  document.getElementById('pId').value = '';
  document.getElementById('pName').value = '';
  document.getElementById('pBarcode').value = '';
  document.getElementById('pTyStock').value = '';
  document.getElementById('pHbStock').value = '';
  modal.classList.remove('hidden');
  document.getElementById('pName').focus();
}

function openEdit(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('modalTitle').textContent = 'Ürünü Düzenle';
  document.getElementById('pId').value = p.id;
  document.getElementById('pName').value = p.name;
  document.getElementById('pBarcode').value = p.barcode;
  document.getElementById('pTyStock').value = p.trendyolStock === null ? '' : p.trendyolStock;
  document.getElementById('pHbStock').value = p.hepsiburadaStock === null ? '' : p.hepsiburadaStock;
  modal.classList.remove('hidden');
}

function closeModal() {
  modal.classList.add('hidden');
}

async function saveProduct() {
  const id = document.getElementById('pId').value;
  const body = {
    name: document.getElementById('pName').value.trim(),
    barcode: document.getElementById('pBarcode').value.trim()
  };
  const ty = document.getElementById('pTyStock').value;
  const hb = document.getElementById('pHbStock').value;
  body.trendyolStock = ty === '' ? null : Number(ty);
  body.hepsiburadaStock = hb === '' ? null : Number(hb);
  if (!body.barcode) return alert('Barkod gerekli.');
  if (id) {
    await request(API.products + '/' + id, 'PUT', body);
  } else {
    await request(API.products, 'POST', body);
  }
  closeModal();
  await loadProducts();
}

async function removeProduct(id) {
  if (!confirm('Bu ürün silinsin mi?')) return;
  await request(API.products + '/' + id, 'DELETE');
  await loadProducts();
}

document.getElementById('addBtn').addEventListener('click', openAdd);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('saveProductBtn').addEventListener('click', saveProduct);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

// ---------- Senkron ----------
document.getElementById('syncBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true;
  btn.textContent = 'Kontrol ediliyor...';
  try {
    const r = await request(API.sync, 'POST');
    await loadProducts();
    await loadLog();
    const parts = [];
    if (r.trendyol) parts.push('Trendyol: ' + (r.trendyol.updated || 0) + ' güncelleme');
    if (r.hepsiburada) parts.push('Hepsiburada: ' + (r.hepsiburada.updated || 0) + ' güncelleme');
    alert(parts.join('\n'));
  } catch (e) {
    alert('Hata: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Şimdi Kontrol Et';
  }
});

// ---------- Ayarlar ----------
async function loadSettings() {
  const s = await request(API.settings);
  notifyThreshold = s.sync.threshold !== undefined ? s.sync.threshold : 1;
  document.getElementById('mailFrom').value = s.mail.from || '';
  document.getElementById('mailPassword').value = s.mail.password || '';
  document.getElementById('mailTo').value = s.mail.to || '';
  document.getElementById('mailEnabled').checked = !!s.mail.enabled;
  document.getElementById('mailNotifySales').checked = s.mail.notifySales !== undefined ? !!s.mail.notifySales : true;
  document.getElementById('tgBotToken').value = s.telegram.botToken || '';
  document.getElementById('tgChatId').value = s.telegram.chatId || '';
  document.getElementById('tgEnabled').checked = !!s.telegram.enabled;
  document.getElementById('tyApiKey').value = s.trendyol.apiKey || '';
  document.getElementById('tyApiSecret').value = s.trendyol.apiSecret || '';
  document.getElementById('tySellerId').value = s.trendyol.sellerId || '';
  document.getElementById('hbUsername').value = s.hepsiburada.username || '';
  document.getElementById('hbPassword').value = s.hepsiburada.password || '';
  document.getElementById('syncInterval').value = s.sync.intervalMinutes || 30;
  document.getElementById('notifyThreshold').value = s.sync.threshold !== undefined ? s.sync.threshold : 1;
}

async function saveSettings() {
  const body = {
    mail: {
      from: document.getElementById('mailFrom').value.trim(),
      password: document.getElementById('mailPassword').value.trim(),
      to: document.getElementById('mailTo').value.trim(),
      enabled: document.getElementById('mailEnabled').checked,
      notifySales: document.getElementById('mailNotifySales').checked
    },
    telegram: {
      botToken: document.getElementById('tgBotToken').value.trim(),
      chatId: document.getElementById('tgChatId').value.trim(),
      enabled: document.getElementById('tgEnabled').checked
    },
    trendyol: {
      apiKey: document.getElementById('tyApiKey').value.trim(),
      apiSecret: document.getElementById('tyApiSecret').value.trim(),
      sellerId: document.getElementById('tySellerId').value.trim()
    },
    hepsiburada: {
      username: document.getElementById('hbUsername').value.trim(),
      password: document.getElementById('hbPassword').value.trim()
    },
    sync: {
      intervalMinutes: Number(document.getElementById('syncInterval').value) || 30,
      threshold: Number(document.getElementById('notifyThreshold').value)
    }
  };
  await request(API.settings, 'PUT', body);
  const msg = document.getElementById('saveMsg');
  msg.textContent = 'Ayarlar kaydedildi.';
  msg.style.color = '#2e7d32';
  setTimeout(() => { msg.textContent = ''; }, 3000);
}

document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

document.getElementById('testMailBtn').addEventListener('click', async () => {
  const btn = document.getElementById('testMailBtn');
  btn.disabled = true;
  btn.textContent = 'Gönderiliyor...';
  try {
    const r = await request(API.testMail, 'POST');
    alert(r.sent ? 'Test e-postası gönderildi. Gelen kutusunu kontrol et.' : 'Gönderilemedi: ' + (r.reason || ''));
  } catch (e) {
    alert('Hata: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test E-postası Gönder';
  }
});

document.getElementById('testTgBtn').addEventListener('click', async () => {
  const btn = document.getElementById('testTgBtn');
  btn.disabled = true;
  btn.textContent = 'Gönderiliyor...';
  try {
    const r = await request(API.testTelegram, 'POST');
    alert(r.sent ? 'Test bildirimi gönderildi. Telefonunu kontrol et.' : 'Gönderilemedi: ' + (r.reason || ''));
  } catch (e) {
    alert('Hata: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Bildirimi Gönder';
  }
});

// ---------- Log ----------
async function loadLog() {
  const items = await request(API.log);
  const list = document.getElementById('logList');
  if (!items.length) {
    list.innerHTML = '<p class="muted">Henüz kayıt yok.</p>';
    return;
  }
  list.innerHTML = items.map(i =>
    '<div class="log-item"><span class="muted">' + fmtTime(i.time) + '</span> ' + escapeHtml(i.message) + '</div>'
  ).join('');
}

// ---------- Başlangıç ----------
loadProducts();
loadSettings();
setInterval(loadProducts, 30000);
