const API = {
  products: '/api/products',
  settings: '/api/settings',
  log: '/api/log',
  sync: '/api/sync',
  testMail: '/api/test-mail',
  testTelegram: '/api/test-telegram',
  shopSettings: '/api/shop/admin/settings',
  shopStats: '/api/shop/admin/stats',
  shopProducts: '/api/shop/admin/products',
  shopOrders: '/api/shop/admin/orders',
  importTrendyol: '/api/shop/admin/import-trendyol',
  shipments: '/api/shipments',
  repeatFlag: '/api/repeat-purchase-flag',
  repeatFlagClear: '/api/repeat-purchase-flag/clear',
  questions: '/api/questions',
  questionsAnswer: '/api/questions/answer',
  questionFlag: '/api/question-flag',
  questionFlagClear: '/api/question-flag/clear'
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

// ---------- Tekrar satin alma bildirim sesi ----------
let lastFlagCheck = false;
let audioCtx = null;

function playNotifySound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Tek kisa bip
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.15);
    // Kisa sure sonra kapat
    setTimeout(() => { try { audioCtx.close(); audioCtx = null; } catch(e){} }, 300);
  } catch (e) {}
}

async function checkRepeatFlag() {
  try {
    const r = await request(API.repeatFlag);
    const logBtn = document.getElementById('logTabBtn');
    if (!logBtn) return;
    if (r.pending && !lastFlagCheck) {
      // Yeni tekrar satin alma var
      logBtn.classList.add('log-btn-pulse');
      playNotifySound();
    } else if (!r.pending) {
      logBtn.classList.remove('log-btn-pulse');
    }
    lastFlagCheck = !!r.pending;
  } catch (e) {}
}

// Sayfa acilinda ve her 10 sn'de kontrol et
checkRepeatFlag();
setInterval(checkRepeatFlag, 10000);

// ---------- Soru bildirim flag ----------
let lastQuestionFlag = false;

async function checkQuestionFlag() {
  try {
    const r = await request(API.questionFlag);
    const btn = document.getElementById('soruTabBtn');
    if (!btn) return;
    if (r.pending && !lastQuestionFlag) {
      btn.classList.add('log-btn-pulse');
      playNotifySound();
    } else if (!r.pending) {
      btn.classList.remove('log-btn-pulse');
    }
    lastQuestionFlag = !!r.pending;
  } catch (e) {}
}

checkQuestionFlag();
setInterval(checkQuestionFlag, 10000);

// Kayitlar ve Sorular sekmesine tiklaninca flag temizle
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'log') {
      request(API.repeatFlagClear, 'POST').catch(() => {});
      document.getElementById('logTabBtn').classList.remove('log-btn-pulse');
      lastFlagCheck = false;
    }
    if (btn.dataset.tab === 'sorular') {
      request(API.questionFlagClear, 'POST').catch(() => {});
      document.getElementById('soruTabBtn').classList.remove('log-btn-pulse');
      lastQuestionFlag = false;
      loadQuestions();
    }
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'log') loadLog();
    if (btn.dataset.tab === 'istatistik') loadStats();
    if (btn.dataset.tab === 'magaza') loadShop();
    if (btn.dataset.tab === 'kargo') loadShipments();
  });
});

// ---------- Kargo ----------
let shipments = [];
async function loadShipments() {
  try {
    shipments = await request(API.shipments);
    renderShipments();
  } catch (e) {
    document.getElementById('shipTable').innerHTML = '<tr><td colspan="7">Yuklenemedi: ' + e.message + '</td></tr>';
  }
}

function shipStatus(s) {
  const st = String(s && s.status ? s.status : '').toLowerCase();
  if (s && s.delivered) return { label: 'Teslim', cls: 'ok' };
  if (st.indexOf('deliver') !== -1 || (s && s.statusDescription && String(s.statusDescription).toLowerCase().indexOf('teslim') !== -1)) return { label: 'Teslim', cls: 'ok' };
  if (s && s.shippedAt) return { label: 'Kargoda', cls: 'warn' };
  return { label: '—', cls: 'na' };
}

function isDelivered(s) {
  const st = String(s && s.status ? s.status : '').toLowerCase();
  if (s && s.delivered) return true;
  if (st.indexOf('deliver') !== -1) return true;
  if (s && s.statusDescription && String(s.statusDescription).toLowerCase().indexOf('teslim') !== -1) return true;
  return false;
}

function shipRow(s) {
  const st = shipStatus(s);
  const track = s.trackingNo ? '<a class="mono" href="' + encodeURI('https://gonderitakip.suratkargo.com.tr/Sorgu/' + s.trackingNo) + '" target="_blank">' + escapeHtml(s.trackingNo) + '</a>' : '—';
  const desc = s.statusDescription ? '<div class="muted" style="font-size:12px">' + escapeHtml(s.statusDescription) + '</div>' : '';
  return '<tr>' +
    '<td>' + escapeHtml(s.market || '') + '</td>' +
    '<td class="mono">' + escapeHtml(s.orderNo) + '</td>' +
    '<td>' + track + '</td>' +
    '<td><span class="badge ' + st.cls + '">' + st.label + '</span>' + desc + '</td>' +
    '<td>' + escapeHtml(s.provider || '—') + '</td>' +
    '<td class="muted">' + (s.shippedAt ? fmtTime(new Date(s.shippedAt).toISOString()) : '—') + '</td>' +
    '<td class="muted">' + (s.deliveredAt ? fmtTime(new Date(s.deliveredAt).toISOString()) : '—') + '</td>' +
    '</tr>';
}

function renderShipments() {
  const q = document.getElementById('shipSearch').value.trim().toLowerCase();
  const body = document.getElementById('shipTable');
  const filtered = shipments.filter(s =>
    !q || String(s.orderNo || '').toLowerCase().includes(q) ||
    String(s.trackingNo || '').toLowerCase().includes(q) ||
    String(s.market || '').toLowerCase().includes(q)
  );
  const active = filtered.filter(s => !isDelivered(s));
  const done = filtered.filter(s => isDelivered(s));
  // Kargoda olanlar ustte, teslim edilenler altta (ayirici baslik ile)
  let html = '';
  if (active.length) {
    html += shipGroupHeader('KARGODA (' + active.length + ')');
    html += active.map(shipRow).join('');
  }
  if (done.length) {
    html += shipGroupHeader('TESLİM EDİLENLER (' + done.length + ')');
    html += done.map(shipRow).join('');
  }
  body.innerHTML = html;
  document.getElementById('shipEmpty').style.display = filtered.length ? 'none' : 'block';
  document.getElementById('shipTable').style.display = filtered.length ? '' : 'none';
}

function shipGroupHeader(label) {
  return '<tr><td colspan="7" style="background:#f1f5f9;font-weight:600;padding:8px 10px;color:#475569;cursor:default">' + label + '</td></tr>';
}

document.getElementById('shipSearch').addEventListener('input', renderShipments);
document.getElementById('shipRefreshBtn').addEventListener('click', loadShipments);

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

function sharedCell(p) {
  const s = status(p.sharedStock);
  const val = p.sharedStock === null || p.sharedStock === undefined ? '—' : p.sharedStock;
  // Ortak stok hucesine tiklayinca stok yazilabilir (inline)
  return '<span class="stock shared-stock" data-id="' + p.id + '" data-qty="' +
    (val === '—' ? '' : val) + '" title="Stok girmek icin tikla">' +
    '<b>' + val + '</b> <span class="badge ' + s.cls + '">' + s.label + '</span></span>';
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
    const ptt = stockCell(p.pttavmStock);
    const ide = stockCell(p.idefixStock);
    const n11 = stockCell(p.n11Stock);
    const cs = stockCell(p.ciceksepetiStock);
    const shared = sharedCell(p);
    return '<tr>' +
      '<td>' + escapeHtml(p.name) + '</td>' +
      '<td class="mono">' + escapeHtml(p.barcode) + '</td>' +
      '<td>' + ty + '</td>' +
      '<td>' + hb + '</td>' +
      '<td>' + ptt + '</td>' +
      '<td>' + ide + '</td>' +
      '<td>' + n11 + '</td>' +
      '<td>' + cs + '</td>' +
      '<td>' + shared + '</td>' +
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
    for (const s of [p.trendyolStock, p.hepsiburadaStock, p.pttavmStock, p.idefixStock, p.n11Stock, p.ciceksepetiStock]) {
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
  document.getElementById('pPttavmStock').value = '';
  document.getElementById('pIdefixStock').value = '';
  document.getElementById('pN11Stock').value = '';
  document.getElementById('pCsStock').value = '';
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
  document.getElementById('pPttavmStock').value = p.pttavmStock === null ? '' : p.pttavmStock;
  document.getElementById('pIdefixStock').value = p.idefixStock === null ? '' : p.idefixStock;
  document.getElementById('pN11Stock').value = p.n11Stock === null ? '' : p.n11Stock;
  document.getElementById('pCsStock').value = p.ciceksepetiStock === null ? '' : p.ciceksepetiStock;
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
  const ptt = document.getElementById('pPttavmStock').value;
  const ide = document.getElementById('pIdefixStock').value;
  const n11 = document.getElementById('pN11Stock').value;
  const cs = document.getElementById('pCsStock').value;
  body.trendyolStock = ty === '' ? null : Number(ty);
  body.hepsiburadaStock = hb === '' ? null : Number(hb);
  body.pttavmStock = ptt === '' ? null : Number(ptt);
  body.idefixStock = ide === '' ? null : Number(ide);
  body.n11Stock = n11 === '' ? null : Number(n11);
  body.ciceksepetiStock = cs === '' ? null : Number(cs);
  if (!body.barcode) return alert('Stok kodu gerekli.');
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

// Ortak stok hucesine tiklayinca inline stok giris inputu
document.getElementById('productTable').addEventListener('click', async function (e) {
  const cell = e.target.closest('.shared-stock');
  if (!cell || cell.querySelector('input')) return;
  const id = cell.getAttribute('data-id');
  const cur = cell.getAttribute('data-qty');
  cell.innerHTML = '<input type="number" min="0" value="' + cur + '" class="shared-input" style="width:60px">';
  const inp = cell.querySelector('input');
  inp.focus();
  inp.select();
  const commit = async (val) => {
    const qty = parseInt(val, 10);
    cell.innerHTML = cur === '' ? '<b>—</b>' : '<b>' + cur + '</b>';
    cell.classList.add('saving');
    try {
      const r = await request(API.products + '/' + id + '/set-stock', 'POST', { qty: qty });
      if (r && r.ok) {
        // listeyi guncelle
        const p = products.find(x => x.id === id);
        if (p) {
          p.sharedStock = qty; p.trendyolStock = qty; p.hepsiburadaStock = qty;
          p.pttavmStock = qty; p.idefixStock = qty; p.n11Stock = qty; p.ciceksepetiStock = qty;
        }
        renderProducts();
      } else {
        alert('Hata: ' + (r && r.error ? r.error : 'Bilinmeyen'));
      }
    } catch (err) {
      alert('Hata: ' + err.message);
    }
  };
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') commit(inp.value);
    if (ev.key === 'Escape') { cell.innerHTML = cur === '' ? '<b>—</b>' : '<b>' + cur + '</b>'; }
  });
  inp.addEventListener('blur', () => { /* Enter kullanilmasini bekle */ });
});


// ---------- Mağaza Yönetimi ----------
let shopProducts = [];
const shopModal = document.getElementById('shopModal');

async function loadShop() {
  shopProducts = await request(API.shopProducts);
  renderShop();
  renderOrders();
}

function renderShop() {
  const q = document.getElementById('shopSearch').value.trim().toLowerCase();
  const list = shopProducts.filter(p =>
    p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q)
  );
  document.getElementById('shopTable').innerHTML = list.map(p =>
    '<tr>' +
      '<td>' + (p.images && p.images[0] ? '<img class="thumb" src="' + escapeHtml(p.images[0]) + '" onerror="this.remove()"> ' : '') + escapeHtml(p.name) + '</td>' +
      '<td>' + escapeHtml(p.category || '') + '</td>' +
      '<td>' + fmtTL(p.price) + '</td>' +
      '<td>' + (p.stock === null || p.stock === undefined ? '—' : p.stock) + '</td>' +
      '<td>' + (p.sold || 0) + '</td>' +
      '<td>' + (p.visible ? '<span class="badge ok">Açık</span>' : '<span class="badge danger">Kapalı</span>') + '</td>' +
      '<td class="actions">' +
        '<button class="btn small" onclick="openShopEdit(\'' + p.id + '\')">Düzenle</button> ' +
        '<button class="btn small danger-btn" onclick="removeShopProduct(\'' + p.id + '\')">Sil</button>' +
      '</td>' +
    '</tr>'
  ).join('');
  document.getElementById('shopEmpty').style.display = list.length ? 'none' : 'block';
}

function openShopAdd() {
  document.getElementById('shopModalTitle').textContent = 'Ürün Ekle';
  document.getElementById('spId').value = '';
  document.getElementById('spName').value = '';
  document.getElementById('spBarcode').value = '';
  document.getElementById('spPrice').value = '';
  document.getElementById('spStock').value = '';
  document.getElementById('spCategory').value = '';
  document.getElementById('spImage').value = '';
  document.getElementById('spDescription').value = '';
  document.getElementById('spVisible').checked = true;
  document.getElementById('spImageFile').value = '';
  shopModal.classList.remove('hidden');
  updateShopPreview();
  document.getElementById('spName').focus();
}

function openShopEdit(id) {
  const p = shopProducts.find(x => x.id === id);
  if (!p) return;
  document.getElementById('shopModalTitle').textContent = 'Ürünü Düzenle';
  document.getElementById('spId').value = p.id;
  document.getElementById('spName').value = p.name;
  document.getElementById('spBarcode').value = p.barcode || '';
  document.getElementById('spPrice').value = p.price || '';
  document.getElementById('spStock').value = (p.stock === null || p.stock === undefined) ? '' : p.stock;
  document.getElementById('spCategory').value = p.category || '';
  document.getElementById('spImage').value = (p.images && p.images[0]) || '';
  document.getElementById('spDescription').value = p.description || '';
  document.getElementById('spVisible').checked = p.visible !== false;
  document.getElementById('spImageFile').value = '';
  shopModal.classList.remove('hidden');
  updateShopPreview();
}

function closeShopModal() { shopModal.classList.add('hidden'); }

function updateShopPreview() {
  const url = document.getElementById('spImage').value.trim();
  const img = document.getElementById('spImagePreview');
  if (url) { img.src = url; img.classList.remove('hidden'); }
  else img.classList.add('hidden');
}

document.getElementById('spImageFile').addEventListener('change', function (e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return alert('Lütfen bir resim dosyası seçin.');
  if (file.size > 8 * 1024 * 1024) return alert('Resim çok büyük. Maksimum 8 MB.');
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const max = 800;
      let w = img.width, h = img.height;
      if (w > max || h > max) {
        const r = Math.min(max / w, max / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      document.getElementById('spImage').value = canvas.toDataURL('image/jpeg', 0.8);
      updateShopPreview();
    };
    img.onerror = () => alert('Resim okunamadı.');
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

document.getElementById('spImage').addEventListener('input', updateShopPreview);

async function saveShopProduct() {
  const id = document.getElementById('spId').value;
  const name = document.getElementById('spName').value.trim();
  if (!name) return alert('Ürün adı gerekli.');
  const stock = document.getElementById('spStock').value;
  const img = document.getElementById('spImage').value.trim();
  const body = {
    name,
    barcode: document.getElementById('spBarcode').value.trim(),
    price: Number(document.getElementById('spPrice').value) || 0,
    stock: stock === '' ? null : Number(stock),
    category: document.getElementById('spCategory').value.trim(),
    images: img ? [img] : [],
    description: document.getElementById('spDescription').value.trim(),
    visible: document.getElementById('spVisible').checked
  };
  if (id) await request(API.shopProducts + '/' + id, 'PUT', body);
  else await request(API.shopProducts, 'POST', body);
  closeShopModal();
  await loadShop();
}

async function removeShopProduct(id) {
  if (!confirm('Bu mağaza ürünü silinsin mi?')) return;
  await request(API.shopProducts + '/' + id, 'DELETE');
  await loadShop();
}

async function importTrendyol() {
  if (!confirm('Trendyol katalogu mağazaya aktarılacak. Yeni ürünler eklenir, mevcutların stoku güncellenir. Devam?')) return;
  const btn = document.getElementById('importTrendyolBtn');
  btn.disabled = true;
  btn.textContent = 'İçe aktarılıyor...';
  try {
    const r = await request(API.importTrendyol, 'POST');
    alert('Eklendi: ' + r.added + ', Güncellendi: ' + r.updated + ' (Toplam: ' + r.total + ' ürün bulundu)');
    await loadShop();
  } catch (e) {
    alert('Hata: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Trendyol'dan İçe Aktar";
  }
}

document.getElementById('addShopBtn').addEventListener('click', openShopAdd);
document.getElementById('shopCancelBtn').addEventListener('click', closeShopModal);
document.getElementById('saveShopBtn').addEventListener('click', saveShopProduct);
document.getElementById('importTrendyolBtn').addEventListener('click', importTrendyol);
document.getElementById('shopSearch').addEventListener('input', renderShop);
shopModal.addEventListener('click', e => { if (e.target === shopModal) closeShopModal(); });

// ---------- Siparişler ----------
function orderStatusBadge(s) {
  if (s === 'odendi') return '<span class="badge ok">Ödendi</span>';
  if (s === 'tamamlandı') return '<span class="badge ok">Tamamlandı</span>';
  if (s === 'iptal') return '<span class="badge danger">İptal</span>';
  return '<span class="badge warn">Bekliyor</span>';
}

async function renderOrders() {
  const orders = await request(API.shopOrders);
  const el = document.getElementById('orderTable');
  if (!orders.length) {
    el.innerHTML = '';
    document.getElementById('orderEmpty').style.display = 'block';
    return;
  }
  document.getElementById('orderEmpty').style.display = 'none';
  el.innerHTML = orders.map(o =>
    '<tr>' +
      '<td class="mono">' + escapeHtml(o.orderNo) + '</td>' +
      '<td class="muted">' + fmtTime(o.createdAt) + '</td>' +
      '<td>' + escapeHtml(o.items.map(i => i.name + ' x' + i.qty).join(', ')) + '</td>' +
      '<td>' + escapeHtml((o.customer.name || '') + ' - ' + (o.customer.phone || '')) + '</td>' +
      '<td>' + (o.paymentMethod === 'iyzico' ? 'Kart' : 'EFT/Havale') + '</td>' +
      '<td><b>' + fmtTL(o.total) + '</b></td>' +
      '<td>' + orderStatusBadge(o.status) + '</td>' +
      '<td><input class="cargo-input" id="cargo-' + o.id + '" value="' + escapeHtml(o.cargoNumber || '') + '" placeholder="Takip no">' +
        '<button class="btn small" onclick="saveCargo(\'' + o.id + '\')">Kaydet</button></td>' +
      '<td class="actions">' +
        (o.status !== 'tamamlandı'
          ? '<button class="btn small" onclick="completeOrder(\'' + o.id + '\')">Tamamlandı</button> ' +
            '<button class="btn small danger-btn" onclick="cancelOrder(\'' + o.id + '\')">İptal</button>'
          : '<span class="muted">Fatura: ' + escapeHtml(o.faturaNo || '—') + '</span>') +
      '</td>' +
    '</tr>'
  ).join('');
}

async function saveCargo(id) {
  const val = document.getElementById('cargo-' + id).value.trim();
  await request(API.shopOrders + '/' + id, 'PUT', { cargoNumber: val });
  await renderOrders();
}

async function completeOrder(id) {
  await request(API.shopOrders + '/' + id, 'PUT', { status: 'tamamlandı' });
  await loadShop();
}

async function cancelOrder(id) {
  if (!confirm('Sipariş iptal edilsin mi?')) return;
  await request(API.shopOrders + '/' + id, 'PUT', { status: 'iptal' });
  await loadShop();
}

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
    if (r.productPush) {
      const pp = r.productPush;
      if (pp.created) parts.push('Diğer pazarlara yüklenen ürün: ' + pp.created);
      if (pp.error) parts.push('Ürün yükleme hatası: ' + pp.error);
      if (pp.skipped && !pp.created) parts.push('Ürün yükleme: ' + pp.reason);
    }
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
  document.getElementById('pttApiKey').value = s.pttavm.apiKey || '';
  document.getElementById('pttAccessToken').value = s.pttavm.accessToken || '';
  document.getElementById('idefixApiKey').value = s.idefix.apiKey || '';
  document.getElementById('idefixApiSecret').value = s.idefix.apiSecret || '';
  document.getElementById('idefixVendorId').value = s.idefix.vendorId || '';
  document.getElementById('n11AppKey').value = s.n11.appKey || '';
  document.getElementById('n11AppSecret').value = s.n11.appSecret || '';
  document.getElementById('csApiKey').value = s.ciceksepeti.apiKey || '';
  document.getElementById('syncInterval').value = s.sync.intervalMinutes || 30;
  document.getElementById('notifyThreshold').value = s.sync.threshold !== undefined ? s.sync.threshold : 1;
  const pp = s.productPush || { mappings: {} };
  const pm = pp.mappings || {};
  document.getElementById('ppEnabled').checked = !!pp.enabled;
  document.getElementById('ppHbCategoryId').value = (pm.hepsiburada && pm.hepsiburada.categoryId) || '';
  document.getElementById('ppHbBrand').value = (pm.hepsiburada && pm.hepsiburada.brand) || '';
  document.getElementById('ppHbVatRate').value = (pm.hepsiburada && pm.hepsiburada.vatRate) || 20;
  document.getElementById('ppPttCategoryId').value = (pm.pttavm && pm.pttavm.categoryId) || '';
  document.getElementById('ppPttBrand').value = (pm.pttavm && pm.pttavm.brand) || '';
  document.getElementById('ppPttVatRate').value = (pm.pttavm && pm.pttavm.vatRate) || 20;
  document.getElementById('ppIdefixCategoryId').value = (pm.idefix && pm.idefix.categoryId) || '';
  document.getElementById('ppIdefixBrandId').value = (pm.idefix && pm.idefix.brandId) || '';
  document.getElementById('ppIdefixVatRate').value = (pm.idefix && pm.idefix.vatRate) || 20;
  document.getElementById('ppIdefixCargoCompanyId').value = (pm.idefix && pm.idefix.cargoCompanyId) || 0;
  document.getElementById('ppIdefixShipmentAddressId').value = (pm.idefix && pm.idefix.shipmentAddressId) || 0;
  document.getElementById('ppIdefixReturnAddressId').value = (pm.idefix && pm.idefix.returnAddressId) || 0;
  document.getElementById('ppN11CategoryId').value = (pm.n11 && pm.n11.categoryId) || '';
  document.getElementById('ppN11Brand').value = (pm.n11 && pm.n11.brand) || '';
  document.getElementById('ppN11ShipmentTemplate').value = (pm.n11 && pm.n11.shipmentTemplate) || '';
  document.getElementById('ppCsCategoryId').value = (pm.ciceksepeti && pm.ciceksepeti.categoryId) || '';
  document.getElementById('ppCsDeliveryType').value = (pm.ciceksepeti && pm.ciceksepeti.deliveryType) || 2;
  document.getElementById('ppCsDeliveryMessageType').value = (pm.ciceksepeti && pm.ciceksepeti.deliveryMessageType) || 5;
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
    pttavm: {
      apiKey: document.getElementById('pttApiKey').value.trim(),
      accessToken: document.getElementById('pttAccessToken').value.trim()
    },
    idefix: {
      apiKey: document.getElementById('idefixApiKey').value.trim(),
      apiSecret: document.getElementById('idefixApiSecret').value.trim(),
      vendorId: document.getElementById('idefixVendorId').value.trim()
    },
    n11: {
      appKey: document.getElementById('n11AppKey').value.trim(),
      appSecret: document.getElementById('n11AppSecret').value.trim()
    },
    ciceksepeti: {
      apiKey: document.getElementById('csApiKey').value.trim()
    },
    sync: {
      intervalMinutes: Number(document.getElementById('syncInterval').value) || 30,
      threshold: Number(document.getElementById('notifyThreshold').value)
    },
    productPush: {
      enabled: document.getElementById('ppEnabled').checked,
      mappings: {
        hepsiburada: {
          categoryId: document.getElementById('ppHbCategoryId').value.trim(),
          brand: document.getElementById('ppHbBrand').value.trim(),
          vatRate: Number(document.getElementById('ppHbVatRate').value) || 20
        },
        pttavm: {
          categoryId: document.getElementById('ppPttCategoryId').value.trim(),
          brand: document.getElementById('ppPttBrand').value.trim(),
          vatRate: Number(document.getElementById('ppPttVatRate').value) || 20
        },
        idefix: {
          categoryId: document.getElementById('ppIdefixCategoryId').value.trim(),
          brandId: document.getElementById('ppIdefixBrandId').value.trim(),
          vatRate: Number(document.getElementById('ppIdefixVatRate').value) || 20,
          cargoCompanyId: Number(document.getElementById('ppIdefixCargoCompanyId').value) || 0,
          shipmentAddressId: Number(document.getElementById('ppIdefixShipmentAddressId').value) || 0,
          returnAddressId: Number(document.getElementById('ppIdefixReturnAddressId').value) || 0
        },
        n11: {
          categoryId: document.getElementById('ppN11CategoryId').value.trim(),
          brand: document.getElementById('ppN11Brand').value.trim(),
          shipmentTemplate: document.getElementById('ppN11ShipmentTemplate').value.trim(),
          currencyType: 'TRY'
        },
        ciceksepeti: {
          categoryId: document.getElementById('ppCsCategoryId').value.trim(),
          deliveryType: Number(document.getElementById('ppCsDeliveryType').value) || 2,
          deliveryMessageType: Number(document.getElementById('ppCsDeliveryMessageType').value) || 5
        }
      }
    }
  };
  await request(API.settings, 'PUT', body);
  const msg = document.getElementById('saveMsg');
  msg.textContent = 'Ayarlar kaydedildi.';
  msg.style.color = '#2e7d32';
  setTimeout(() => { msg.textContent = ''; }, 3000);
}

document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

// ---------- BirFatura ----------
async function loadBirFatura() {
  const s = await request(API.shopSettings);
  const b = s.birfatura || {};
  document.getElementById('bfEndpoint').value = b.endpoint || '';
  document.getElementById('bfUsername').value = b.username || '';
  document.getElementById('bfPassword').value = b.password || '';
  document.getElementById('bfInvoiceType').value = b.invoiceType || 'earsiv';
  document.getElementById('bfTaxRate').value = b.taxRate !== undefined ? b.taxRate : 20;
  document.getElementById('bfEnabled').checked = !!b.enabled;
}

async function saveBirFatura() {
  const body = {
    birfatura: {
      endpoint: document.getElementById('bfEndpoint').value.trim(),
      username: document.getElementById('bfUsername').value.trim(),
      password: document.getElementById('bfPassword').value.trim(),
      invoiceType: document.getElementById('bfInvoiceType').value,
      taxRate: Number(document.getElementById('bfTaxRate').value) || 20,
      enabled: document.getElementById('bfEnabled').checked
    }
  };
  await request(API.shopSettings, 'PUT', body);
  const msg = document.getElementById('bfMsg');
  msg.textContent = 'BirFatura ayarları kaydedildi.';
  msg.style.color = '#2e7d32';
  setTimeout(() => { msg.textContent = ''; }, 3000);
}

document.getElementById('saveBfBtn').addEventListener('click', saveBirFatura);

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

// ---------- İstatistik ----------
function fmtTL(n) {
  return Number(n || 0).toLocaleString('tr-TR') + ' TL';
}

async function loadStats() {
  const [stats, products, orders] = await Promise.all([
    request(API.shopStats),
    request(API.shopProducts),
    request(API.shopOrders)
  ]);
  const cards = [
    { label: 'Toplam Ziyaret', val: stats.visitsTotal },
    { label: 'Bugünkü Ziyaret', val: stats.today },
    { label: 'Toplam Satılan', val: stats.soldTotal + ' adet' },
    { label: 'Toplam Sipariş', val: stats.ordersTotal },
    { label: 'Toplam Ciro', val: fmtTL(stats.revenue) }
  ];
  document.getElementById('statsCards').innerHTML = cards.map(c =>
    '<span class="pill">' + c.label + ': <b>' + c.val + '</b></span>'
  ).join('');

  const max = Math.max(1, ...stats.daily.map(d => d.count));
  document.getElementById('visitChart').innerHTML =
    '<div class="visit-bars">' + stats.daily.map(d =>
      '<div class="visit-bar" title="' + d.day + ': ' + d.count + '"><div class="visit-bar-fill" style="height:' + Math.round((d.count / max) * 100) + '%"><b>' + (d.count || '') + '</b></div><small>' + d.day.slice(8) + '</small></div>'
    ).join('') + '</div>';

  const sellers = products
    .map(p => ({ name: p.name, sold: Number(p.sold) || 0, stock: p.stock, price: p.price, visible: p.visible }))
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'tr'));
  document.getElementById('sellerTable').innerHTML = sellers.map(p =>
    '<tr>' +
      '<td>' + escapeHtml(p.name) + '</td>' +
      '<td><b>' + p.sold + '</b></td>' +
      '<td>' + (p.stock === null || p.stock === undefined ? '—' : p.stock) + '</td>' +
      '<td>' + fmtTL(p.price) + '</td>' +
      '<td>' + (p.visible ? '<span class="badge ok">Açık</span>' : '<span class="badge danger">Kapalı</span>') + '</td>' +
    '</tr>'
  ).join('');
}

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

// ---------- Sorular ----------
let questions = [];
async function loadQuestions() {
  try {
    questions = await request(API.questions);
    renderQuestions();
  } catch (e) {
    document.getElementById('questionList').innerHTML = '<p>Yüklenemedi: ' + e.message + '</p>';
  }
}

function renderQuestions() {
  const el = document.getElementById('questionList');
  if (!questions.length) {
    el.innerHTML = '<p class="empty-note">Henüz soru yok.</p>';
    return;
  }
  el.innerHTML = questions.map(q => {
    const marketLabel = q.market || 'Pazaryeri';
    const qText = escapeHtml(q.question || q.text || q.content || '');
    const aText = escapeHtml(q.answer || '');
    const pName = escapeHtml(q.productName || q.productNameText || '');
    const date = q.date || q.createdAt || '';
    const dateStr = date ? new Date(date).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    return '<div class="question-card" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:10px;background:#fafafa">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<span class="badge" style="background:#dbeafe;color:#1e40af">' + escapeHtml(marketLabel) + '</span>' +
        '<span class="muted" style="font-size:12px">' + dateStr + '</span>' +
      '</div>' +
      (pName ? '<div style="font-size:13px;margin-bottom:4px"><b>Ürün:</b> ' + pName + '</div>' : '') +
      '<div style="margin-bottom:8px"><b>Soru:</b> ' + qText + '</div>' +
      (aText ? '<div style="background:#dcfce7;padding:8px;border-radius:6px;margin-bottom:8px"><b>Cevap:</b> ' + aText + '</div>' :
        '<div style="margin-bottom:8px">' +
          '<textarea id="ans-' + (q.id || q.questionId || '') + '" placeholder="Cevabını yaz..." style="width:100%;min-height:50px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px"></textarea>' +
          '<button class="btn btn-primary" style="margin-top:6px;font-size:12px" onclick="answerQuestion(\'' + escapeHtml(q.id || q.questionId || '') + '\', \'' + escapeHtml(q.market || '') + '\')">Cevap Gönder</button>' +
        '</div>') +
      '</div>';
  }).join('');
}

async function answerQuestion(qid, market) {
  const ta = document.getElementById('ans-' + qid);
  if (!ta) return;
  const answer = ta.value.trim();
  if (!answer) return alert('Cevap boş olamaz.');
  try {
    await request(API.questionsAnswer, 'POST', { questionId: qid, market, answer });
    alert('Cevap gönderildi.');
    loadQuestions();
  } catch (e) {
    alert('Hata: ' + e.message);
  }
}

// ---------- Başlangıç ----------
loadProducts();
loadSettings();
loadBirFatura();
loadShop();
setInterval(loadProducts, 30000);
