const API = {
  products: '/api/shop/products',
  settings: '/api/shop/settings',
  orders: '/api/shop/orders',
  track: '/api/shop/track'
};

let products = [];
let settings = {};
let activeCategory = '';
let searchTerm = '';

// ---------- Sepet ----------
function getCart() {
  try { return JSON.parse(localStorage.getItem('capari-cart') || '[]'); } catch (e) { return []; }
}
function saveCart(cart) {
  localStorage.setItem('capari-cart', JSON.stringify(cart));
  renderCartBadge();
}
function renderCartBadge() {
  const n = getCart().reduce((s, i) => s + (i.qty || 0), 0);
  const el = document.getElementById('cartCount');
  el.textContent = n;
  el.classList.toggle('hidden', n === 0);
}

// ---------- Görünümler ----------
function showView(name) {
  view = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  window.scrollTo({ top: 0 });
}

// ---------- Yardımcılar ----------
function findProduct(id) {
  return products.find(p => p.id === id);
}
function fmt(n) {
  return Number(n || 0).toLocaleString('tr-TR') + ' TL';
}
function imgFor(p) {
  const out = p.stock === 0;
  let inner;
  if (p.images && p.images.length) {
    inner = '<img class="product-img" src="' + escapeAttr(p.images[0]) + '" alt="' + escapeHtml(p.name) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
      '<div class="product-img" style="display:none;align-items:center;justify-content:center;color:#94a3b8">📦 ' + escapeHtml(p.name) + '</div>';
  } else {
    inner = '<div class="product-img" style="display:flex;align-items:center;justify-content:center;color:#94a3b8">📦 ' + escapeHtml(p.name) + '</div>';
  }
  return '<div class="product-img-wrap">' + inner +
    (out ? '<div class="stock-out-overlay">Stok Yok</div>' : '') +
  '</div>';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
function stockBadge(p) {
  if (p.stock === null || p.stock === undefined) return '<span class="stock-badge stock-var">Stokta</span>';
  if (p.stock <= 0) return '<span class="stock-badge stock-bitti">Tükendi</span>';
  if (p.stock <= 5) return '<span class="stock-badge stock-kritik">Son ' + p.stock + ' ürün</span>';
  return '<span class="stock-badge stock-var">Stokta</span>';
}
function cargoFeeFor(subtotal) {
  if (!settings.freeShippingThreshold || subtotal >= Number(settings.freeShippingThreshold)) return 0;
  return Number(settings.cargoFee) || 0;
}

// ---------- Ana sayfa ----------
function renderCategories() {
  const cats = [];
  for (const p of products) {
    if (p.category && !cats.includes(p.category)) cats.push(p.category);
  }
  const el = document.getElementById('categories');
  if (!cats.length) { el.innerHTML = ''; return; }
  const chip = (c, label) =>
    '<button class="chip' + (activeCategory === c ? ' active' : '') + '" data-cat="' + escapeAttr(c) + '">' + escapeHtml(label) + '</button>';
  el.innerHTML = chip('', 'Tümü') + cats.map(c => chip(c, c)).join('');
  el.querySelectorAll('.chip').forEach(b => {
    b.addEventListener('click', () => { activeCategory = b.dataset.cat; renderCategories(); renderProducts(); });
  });
}

function renderProducts() {
  const q = searchTerm.toLowerCase();
  const list = products.filter(p => {
    if (activeCategory && p.category !== activeCategory) return false;
    if (q && !(p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const grid = document.getElementById('productGrid');
  grid.innerHTML = list.map(p =>
    '<div class="card product" data-id="' + p.id + '">' +
      imgFor(p) +
      '<div class="product-body">' +
        '<div class="product-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="product-meta">' +
          '<span class="price">' + fmt(p.price) + '</span>' + stockBadge(p) +
        '</div>' +
        '<button class="add-btn' + (p.stock === 0 ? ' disabled' : '') + '" data-add="' + p.id + '"' + (p.stock === 0 ? ' disabled' : '') + '>' + (p.stock === 0 ? 'Tükendi' : 'Sepete Ekle') + '</button>' +
      '</div>' +
    '</div>'
  ).join('');
  document.getElementById('emptyNote').classList.toggle('hidden', list.length > 0);
  grid.querySelectorAll('.product').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.add-btn')) return;
      openProduct(card.dataset.id);
    });
  });
  grid.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.add));
  });
}

// ---------- SEO ----------
function setMeta(attr, value) {
  let el = document.querySelector('meta[name="' + attr + '"]');
  if (!el) el = document.querySelector('meta[property="' + attr + '"]');
  if (el) el.setAttribute('content', String(value));
}
function setJsonLd(obj) {
  const el = document.getElementById('seoJsonLd');
  if (el) el.textContent = JSON.stringify(obj);
}
function applySeoHome() {
  const name = settings.storeName || 'Caparici';
  const desc = settings.metaDescription || name;
  const base = window.location.origin;
  document.title = name + ' | Çapari Marketi - İstavrit, Uskumru, Lüfer Çapari';
  setMeta('description', desc);
  setMeta('keywords', settings.metaKeywords || 'çapari, istavrit çaparisi, olta, balıkçılık');
  setMeta('og:title', name + ' | Çapari Marketi');
  setMeta('og:description', desc);
  setMeta('og:url', base + '/');
  document.querySelector('link[rel="canonical"]').setAttribute('href', base + '/');
  setJsonLd({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: name,
    url: base + '/',
    potentialAction: { '@type': 'SearchAction', target: base + '/?q={search_term_string}', 'query-input': 'required name=search_term_string' }
  });
}
function applySeoProduct(p) {
  const name = settings.storeName || 'Caparici';
  const base = window.location.origin;
  const url = base + '/urun/' + p.id;
  const desc = [p.name, (p.price ? 'Fiyatı: ' + fmt(p.price) : ''), (p.description || '')].filter(Boolean).join('. ');
  document.title = p.name + ' - ' + name;
  setMeta('description', desc);
  setMeta('keywords', [p.name, p.category, name].filter(Boolean).join(', ').toLowerCase());
  setMeta('og:title', p.name);
  setMeta('og:description', desc);
  setMeta('og:url', url);
  document.querySelector('link[rel="canonical"]').setAttribute('href', url);
  setJsonLd({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description || '',
    category: p.category || 'Çapari',
    offers: {
      '@type': 'Offer',
      priceCurrency: 'TRY',
      price: p.price,
      availability: p.stock === 0 ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      url
    }
  });
}

// ---------- Ürün detay ----------
function openProduct(id) {
  const p = findProduct(id);
  if (!p) return;
  const soldOut = p.stock === 0;
  if (window.location.pathname !== '/urun/' + p.id) {
    history.replaceState(null, '', '/urun/' + p.id);
  }
  applySeoProduct(p);
  document.getElementById('productDetail').innerHTML =
    '<div class="detail-wrap">' +
      '<div>' + imgFor(p) + '</div>' +
      '<div class="detail-info">' +
        '<h1>' + escapeHtml(p.name) + '</h1>' +
        '<div class="detail-price">' + fmt(p.price) + '</div>' + stockBadge(p) +
        '<p class="detail-desc">' + escapeHtml(p.description || '') + '</p>' +
        '<div class="qty-row">' +
          '<button class="qty-btn" id="qtyMinus">−</button>' +
          '<input type="number" id="detailQty" value="1" min="1" max="' + (p.stock || 99) + '">' +
          '<button class="qty-btn" id="qtyPlus">+</button>' +
        '</div>' +
        '<button class="btn-primary" id="detailAdd" ' + (soldOut ? 'disabled' : '') + '>' + (soldOut ? 'Tükendi' : 'Sepete Ekle') + '</button>' +
      '</div>' +
    '</div>';
  showView('product');
  const qtyEl = document.getElementById('detailQty');
  document.getElementById('qtyMinus').addEventListener('click', () => qtyEl.value = Math.max(1, (Number(qtyEl.value) || 1) - 1));
  document.getElementById('qtyPlus').addEventListener('click', () => qtyEl.value = Math.max(1, (Number(qtyEl.value) || 1) + 1));
  document.getElementById('detailAdd').addEventListener('click', () => {
    const qty = Math.max(1, Number(qtyEl.value) || 1);
    addToCart(p.id, qty);
  });
}

function addToCart(id, qty) {
  const p = findProduct(id);
  if (!p || p.stock === 0) return;
  const cart = getCart();
  const ex = cart.find(i => i.id === id);
  const n = qty || 1;
  if (ex) ex.qty = Math.min(ex.qty + n, p.stock || 99);
  else cart.push({ id, qty: Math.min(n, p.stock || 99) });
  saveCart(cart);
  showView('cart');
  reportCartAdd(id);
}

// Sepete ekleme istatistiği: her eklemede sunucuya haber verilir (Telegram bildirimi + kişi sayısı).
// Ziyaretçiyi ayırt etmek için tarayıcıda kalıcı bir oturum kimliği tutulur.
function cartSid() {
  try {
    let s = localStorage.getItem('capariSid');
    if (!s) {
      s = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('capariSid', s);
    }
    return s;
  } catch (e) {
    return '';
  }
}

function reportCartAdd(id) {
  try {
    fetch('/api/shop/cart-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: id, sid: cartSid() })
    }).catch(() => {});
  } catch (e) {}
}

// ---------- Sepet ----------
function renderCart() {
  const cart = getCart();
  const el = document.getElementById('cartContent');
  if (!cart.length) {
    el.innerHTML = '<p class="empty-note">Sepetiniz boş. <a href="#" id="goShop">Mağazaya dön</a></p>';
    document.getElementById('goShop').addEventListener('click', () => showView('home'));
    return;
  }
  const rows = cart.map(i => {
    const p = findProduct(i.id);
    if (!p) return '';
    const subtotal = p.price * i.qty;
    return '<div class="cart-item">' +
      (p.images && p.images.length ? '<img src="' + escapeAttr(p.images[0]) + '" onerror="this.remove()">' : '<div class="cart-item-img-placeholder">📦</div>') +
      '<div class="cart-item-info">' +
        '<div class="cart-item-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="cart-item-sub">' + fmt(p.price) + ' × ' + i.qty + ' = ' + fmt(subtotal) + '</div>' +
      '</div>' +
      '<div class="cart-item-controls">' +
        '<button class="btn-secondary" data-dec="' + i.id + '">−</button>' +
        '<b>' + i.qty + '</b>' +
        '<button class="btn-secondary" data-inc="' + i.id + '">+</button>' +
        '<button class="btn-secondary" data-del="' + i.id + '" style="color:var(--danger)">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
  const subtotal = cart.reduce((s, i) => {
    const p = findProduct(i.id);
    return p ? s + p.price * i.qty : s;
  }, 0);
  const cargo = cargoFeeFor(subtotal);
  el.innerHTML =
    rows +
    '<div class="cart-total-bar">' +
      '<div>Ürünler: ' + fmt(subtotal) + '<br><small class="muted">Kargo: ' + (cargo ? fmt(cargo) : 'Ücretsiz') + '</small></div>' +
      '<div>Toplam: <b>' + fmt(subtotal + cargo) + '</b></div>' +
    '</div>' +
    '<button class="btn-primary" id="goCheckout" style="width:100%">Ödemeye Geç</button>';
  el.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => changeQty(b.dataset.dec, -1)));
  el.querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => changeQty(b.dataset.inc, 1)));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    saveCart(getCart().filter(i => i.id !== b.dataset.del));
    renderCart();
  }));
  document.getElementById('goCheckout').addEventListener('click', () => showView('checkout'));
}

function changeQty(id, delta) {
  const p = findProduct(id);
  const cart = getCart();
  const it = cart.find(i => i.id === id);
  if (!it) return;
  it.qty = Math.max(1, it.qty + delta);
  if (p && p.stock !== null) it.qty = Math.min(it.qty, p.stock);
  saveCart(cart);
  renderCart();
}

// ---------- Ödeme ----------
function renderCheckout() {
  const cart = getCart();
  if (!cart.length) { showView('cart'); return; }
  const items = cart.map(i => findProduct(i.id)).filter(Boolean);
  const subtotal = items.reduce((s, p) => s + p.price * (cart.find(i => i.id === p.id).qty), 0);
  const cargo = cargoFeeFor(subtotal);
  const total = subtotal + cargo;

  document.getElementById('orderSummary').innerHTML =
    '<h3>Sipariş Özeti</h3>' +
    items.map(p => {
      const q = cart.find(i => i.id === p.id).qty;
      return '<div style="display:flex;justify-content:space-between;font-size:14px;padding:6px 0;border-bottom:1px solid var(--border)">' +
        '<span>' + escapeHtml(p.name) + ' × ' + q + '</span><b>' + fmt(p.price * q) + '</b></div>';
    }).join('') +
    '<div style="display:flex;justify-content:space-between;padding:8px 0"><span>Kargo</span><b>' + (cargo ? fmt(cargo) : 'Ücretsiz') + '</b></div>' +
    '<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800;padding:10px 0"><span>Toplam</span><span>' + fmt(total) + '</span></div>';

  document.getElementById('checkoutForm').innerHTML =
    '<div class="form-card">' +
      '<h3>Teslimat Bilgileri</h3>' +
      '<label>Ad Soyad *</label><input id="cName" placeholder="Adınız Soyadınız">' +
      '<label>Telefon *</label><input id="cPhone" placeholder="05XX XXX XX XX">' +
      '<div class="form-row">' +
        '<div><label>İl *</label><input id="cCity" placeholder="Örn. İstanbul"></div>' +
        '<div><label>İlçe *</label><input id="cDistrict" placeholder="Örn. Kadıköy"></div>' +
      '</div>' +
      '<label>Adres *</label><textarea id="cAddress" placeholder="Mahalle, sokak, no, daire..."></textarea>' +
      '<label>Not</label><textarea id="cNote" placeholder="Sipariş notunuz (opsiyonel)"></textarea>' +
      '<h3 style="margin-top:18px">Ödeme Yöntemi</h3>' +
      '<div class="pay-option" data-pay="eft">' +
        '<input type="radio" name="pay" value="eft" checked>' +
        '<div><b>EFT / Havale</b><div style="font-size:13px;color:var(--muted)">Havale yapınca siparişiniz onaylanır</div></div>' +
      '</div>' +
      '<div class="pay-option" data-pay="iyzico">' +
        '<input type="radio" name="pay" value="iyzico">' +
        '<div><b>Kredi Kartı</b><div style="font-size:13px;color:var(--muted)">Anında ödeme</div></div>' +
      '</div>' +
      '<div id="ibanBox" class="iban-box hidden"></div>' +
      '<button class="btn-primary" id="placeOrder" style="width:100%;margin-top:18px">Siparişi Tamamla (' + fmt(total) + ')</button>' +
    '</div>';

  const ibanBox = document.getElementById('ibanBox');
  function showIban() {
    if (settings.iban) {
      ibanBox.innerHTML = 'Banka Hesabı: <b>' + escapeHtml(settings.iban) + '</b>' +
        (settings.ibanHolder ? '<br>Alıcı: <b>' + escapeHtml(settings.ibanHolder) + '</b>' : '');
    } else {
      ibanBox.innerHTML = 'Havale bilgileri henüz tanımlı değil.';
    }
  }
  document.querySelectorAll('.pay-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.pay-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      opt.querySelector('input').checked = true;
      ibanBox.classList.toggle('hidden', opt.dataset.pay !== 'eft');
      if (opt.dataset.pay === 'eft') showIban();
    });
  });
  showIban();

  document.getElementById('placeOrder').addEventListener('click', placeOrder);
}

async function placeOrder() {
  const cart = getCart();
  if (!cart.length) return;
  const name = document.getElementById('cName').value.trim();
  const phone = document.getElementById('cPhone').value.trim();
  const city = document.getElementById('cCity').value.trim();
  const district = document.getElementById('cDistrict').value.trim();
  const address = document.getElementById('cAddress').value.trim();
  if (!name || !phone || !city || !district || !address) {
    alert('Lütfen tüm zorunlu alanları doldurun.');
    return;
  }
  const pay = document.querySelector('input[name=pay]:checked').value;
  const body = {
    items: cart,
    customer: { name, phone, city, district, address, note: document.getElementById('cNote').value.trim() },
    paymentMethod: pay
  };
  const btn = document.getElementById('placeOrder');
  btn.disabled = true;
  btn.textContent = 'Sipariş oluşturuluyor...';
  try {
    const res = await fetch(API.orders, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sipariş oluşturulamadı');
    saveCart([]);
    if (pay === 'iyzico' && data.payment && data.payment.form) {
      const slot = document.getElementById('paymentFormSlot');
      slot.innerHTML = '<p style="text-align:center;margin-bottom:12px">Güvenli ödeme sayfasına yönlendiriliyorsunuz...</p>' + data.payment.form;
      document.getElementById('paymentOverlay').classList.remove('hidden');
      const form = slot.querySelector('form');
      if (form) setTimeout(() => form.submit(), 800);
      else showSuccess(data.order);
    } else if (pay === 'iyzico') {
      throw new Error('Kart ödemesi şu an aktif değil. EFT/Havale ile deneyin.');
    } else {
      showSuccess(data.order);
    }
  } catch (e) {
    alert('Hata: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Siparişi Tamamla';
  }
}

function showSuccess(order) {
  const lines = order.items.map(i =>
    '<tr><td>' + escapeHtml(i.name) + '</td><td>' + i.qty + '</td><td>' + fmt(i.price * i.qty) + '</td></tr>'
  ).join('');
  document.getElementById('successContent').innerHTML =
    '<div class="success-wrap">' +
      '<div class="success-icon">✅</div>' +
      '<h1>Siparişiniz Alındı!</h1>' +
      '<p style="color:var(--muted)">Sipariş numaranız: <b style="color:var(--text)">' + escapeHtml(order.orderNo) + '</b></p>' +
      '<div class="success-order">' +
        '<table><tr><th>Ürün</th><th>Adet</th><th>Tutar</th></tr>' + lines + '</table>' +
        '<div style="display:flex;justify-content:space-between"><span>Ürün tutarı</span><b>' + fmt(order.subtotal) + '</b></div>' +
        '<div style="display:flex;justify-content:space-between"><span>Kargo</span><b>' + (order.cargoFee ? fmt(order.cargoFee) : 'Ücretsiz') + '</b></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:18px;margin-top:8px"><span>Toplam</span><b>' + fmt(order.total) + '</b></div>' +
        (order.paymentMethod === 'eft'
          ? '<div class="iban-box" style="margin-top:14px"><b>Havale / EFT Bilgileri:</b><br>' +
            (settings.iban ? 'IBAN: <b>' + escapeHtml(settings.iban) + '</b><br>' : '') +
            (settings.ibanHolder ? 'Alıcı: <b>' + escapeHtml(settings.ibanHolder) + '</b><br>' : '') +
            'Ödemeyi yapınca siparişiniz onaylanacaktır.</div>'
          : '<p style="color:var(--ok);margin-top:10px"><b>Ödemeniz alındı.</b></p>') +
      '</div>' +
      '<button class="btn-primary" id="goHome" style="margin-top:18px">Mağazaya Dön</button>' +
    '</div>';
  showView('success');
  document.getElementById('goHome').addEventListener('click', () => showView('home'));
}

// ---------- Başlangıç ----------
async function init() {
  const [p, s] = await Promise.all([
    fetch(API.products).then(r => r.json()),
    fetch(API.settings).then(r => r.json())
  ]);
  products = p;
  settings = s;
  if (settings.storeName) {
    document.title = settings.storeName;
    document.getElementById('logoBtn').textContent = settings.storeName;
  }
  document.getElementById('footerInfo').innerHTML =
    '<strong>' + escapeHtml(settings.storeName || 'Mağaza') + '</strong>' +
    (settings.phone ? ' | ☎ ' + escapeHtml(settings.phone) : '') +
    (settings.whatsapp ? ' | 📱 ' + escapeHtml(settings.whatsapp) : '') +
    (settings.address ? '<br>' + escapeHtml(settings.address) : '');
  renderCategories();
  renderProducts();
  renderCartBadge();
  applySeoHome();

  if (!sessionStorage.getItem('capari-tracked')) {
    sessionStorage.setItem('capari-tracked', '1');
    fetch(API.track, { method: 'POST' }).catch(() => {});
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('durum') === 'basarili' && params.get('siparis')) {
    showSuccess({ orderNo: params.get('siparis'), items: [], subtotal: 0, cargoFee: 0, total: 0, paymentMethod: 'kart' });
  } else {
    const urun = window.location.pathname.match(/^\/urun\/([^/]+)/);
    if (urun) {
      const p = findProduct(urun[1]);
      if (p) openProduct(p.id);
      else showView('home');
    }
  }

  document.getElementById('logoBtn').addEventListener('click', e => {
    e.preventDefault();
    history.replaceState(null, '', '/');
    applySeoHome();
    showView('home');
  });
  document.getElementById('cartBtn').addEventListener('click', () => showView('cart'));
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  document.querySelectorAll('.back-btn').forEach(b => {
    b.addEventListener('click', () => showView(b.dataset.back));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.getElementById('paymentOverlay').classList.add('hidden');
  });
}

function doSearch() {
  searchTerm = document.getElementById('searchInput').value.trim();
  activeCategory = '';
  renderCategories();
  renderProducts();
  showView('home');
}

window.addEventListener('popstate', () => {
  if (view !== 'home') showView('home');
});

init();
