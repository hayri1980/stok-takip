const db = require('../db');
const sync = require('./sync');
const backup = require('./backup');
const notifier = require('./notifier');

const SYNC_MAX_AGE_MIN = 60;

function marketReady(kind) {
  const cfg = db.getSettings()[kind] || {};
  if (kind === 'trendyol') return !!(cfg.apiKey && cfg.apiSecret && cfg.sellerId);
  if (kind === 'hepsiburada') return !!(cfg.username && cfg.password);
  if (kind === 'pttavm') return !!(cfg.apiKey && cfg.accessToken);
  if (kind === 'idefix') return !!(cfg.apiKey && cfg.apiSecret && cfg.vendorId);
  if (kind === 'n11') return !!(cfg.appKey && cfg.appSecret);
  if (kind === 'ciceksepeti') return !!cfg.apiKey;
  return false;
}

function lastSyncDate(kind) {
  const label = sync.kindLabel(kind);
  const log = db.getLog();
  for (const l of log) {
    if (l.message && l.message.indexOf(label + ' senkronu tamam') === 0) {
      const t = new Date(l.time).getTime();
      if (!isNaN(t)) return t;
    }
  }
  return null;
}

function checkSettings() {
  const s = db.getSettings();
  const out = [];
  const tg = s.telegram || {};
  const tgReady = !!(tg.enabled && tg.botToken && (tg.chatId || (tg.chatIds && tg.chatIds.length)));
  out.push({ name: 'Telegram', ok: tgReady, status: tgReady ? 'OK' : 'EKSIK', detail: tgReady ? '' : 'bot token/chat eksik veya kapalı' });
  for (const kind of sync.MARKETS) {
    const ready = marketReady(kind);
    if (ready) {
      out.push({ name: sync.kindLabel(kind), ok: true, status: 'OK', detail: '' });
    } else {
      out.push({ name: sync.kindLabel(kind), ok: true, status: 'KAPALI', detail: 'ayarlanmadı' });
    }
  }
  const rep = s.report || {};
  out.push({ name: 'Gün sonu raporu', ok: true, status: rep.enabled ? 'Aktif' : 'Kapalı', detail: '' });
  return out;
}

function fixDataIntegrity() {
  const fixed = [];
  const products = db.getProducts();
  const seen = new Map();
  const toDelete = [];

  for (const p of products) {
    const upd = {};
    let changed = false;

    if (!p.name || !String(p.name).trim()) {
      upd.name = p.barcode || 'Bilinmeyen ürün';
      changed = true;
    }

    for (const kind of sync.MARKETS) {
      const f = kind + 'Stock';
      const v = p[f];
      if (v !== null && v !== undefined && Number(v) < 0) {
        upd[f] = 0;
        changed = true;
      }
    }
    if (p.sharedStock !== null && p.sharedStock !== undefined && Number(p.sharedStock) < 0) {
      upd.sharedStock = 0;
      changed = true;
    }

    const key = String(p.barcode || '').trim();
    if (key && seen.has(key)) {
      const keeper = seen.get(key);
      let merged = false;
      for (const kind of sync.MARKETS) {
        const f = kind + 'Stock';
        if ((keeper[f] === null || keeper[f] === undefined) && p[f] !== null && p[f] !== undefined) {
          db.updateProduct(keeper.id, { [f]: p[f] });
          merged = true;
        }
      }
      if ((keeper.sharedStock === null || keeper.sharedStock === undefined) && p.sharedStock !== null && p.sharedStock !== undefined) {
        db.updateProduct(keeper.id, { sharedStock: p.sharedStock });
        merged = true;
      }
      if (!keeper.price && p.price) {
        db.updateProduct(keeper.id, { price: p.price });
        merged = true;
      }
      toDelete.push(p.id);
      fixed.push(merged ? 'tekil barkod birleştirildi: ' + key : 'mükerrer kayıt silindi: ' + key);
      continue;
    }
    if (key) seen.set(key, p);

    if (changed) {
      db.updateProduct(p.id, upd);
      fixed.push('veri düzeltildi: ' + (p.barcode || p.name));
    }
  }

  for (const id of toDelete) db.deleteProduct(id);
  return fixed;
}

async function checkMarketSync(kind) {
  if (!marketReady(kind)) {
    return { name: sync.kindLabel(kind), ok: true, status: 'KAPALI', detail: 'ayarlanmadı' };
  }
  const last = lastSyncDate(kind);
  let fixed = false;
  if (last === null || (Date.now() - last) > SYNC_MAX_AGE_MIN * 60000) {
    try {
      const r = await sync.syncMarketplace(kind);
      if (r && r.error) {
        return { name: sync.kindLabel(kind), ok: false, status: 'HATA', detail: r.error };
      }
      fixed = true;
    } catch (e) {
      return { name: sync.kindLabel(kind), ok: false, status: 'HATA', detail: e.message };
    }
  }
  return { name: sync.kindLabel(kind), ok: true, status: fixed ? 'TAMIR' : 'OK', detail: fixed ? 'senkron yenilendi' : 'güncel' };
}

function checkBackup() {
  if (!process.env.GITHUB_TOKEN) {
    return { name: 'Otomatik yedek', ok: false, status: 'YOK', detail: 'GITHUB_TOKEN tanımlı değil, yedek kaydedilmiyor' };
  }
  try {
    backup.backupNow();
  } catch (e) {
    return { name: 'Otomatik yedek', ok: false, status: 'HATA', detail: e.message };
  }
  return { name: 'Otomatik yedek', ok: true, status: 'OK', detail: '' };
}

function marker(c) {
  if (c.status === 'KAPALI') return '\u26AA';
  if (c.status === 'TAMIR') return '\uD83D\uDD27';
  if (c.ok) return '\u2705';
  if (c.status === 'YOK' || c.status === 'EKSIK') return '\u26A0\uFE0F';
  return '\u274C';
}

function buildText(checks, dataFixes) {
  const lines = ['SİSTEM DENETİMİ'];
  lines.push('Ürün: ' + db.getProducts().length + ' | Ayarlı pazar: ' + sync.marketConfiguredKinds().length);
  for (const c of checks) {
    lines.push(marker(c) + ' ' + c.name + (c.detail ? ' - ' + c.detail : ''));
  }
  if (dataFixes.length) lines.push('\uD83D\uDD27 Veri tamiri: ' + dataFixes.length + ' işlem (' + dataFixes.slice(0, 3).join(', ') + (dataFixes.length > 3 ? '...' : '') + ')');
  return lines.join('\n');
}

let lastProblemsKey = '';

async function runAudit({ notify = false } = {}) {
  const checks = [];
  checks.push(...checkSettings());
  const dataFixes = fixDataIntegrity();
  for (const kind of sync.MARKETS) {
    checks.push(await checkMarketSync(kind));
  }
  checks.push(checkBackup());

  const problems = checks.filter(c => !c.ok);
  const repairs = dataFixes.length + checks.filter(c => c.status === 'TAMIR').length;
  const text = buildText(checks, dataFixes);

  const key = problems.map(c => c.name + ':' + c.status).sort().join('|') + '|tamir:' + repairs;
  const shouldSend = notify || (problems.length + repairs > 0 && key !== lastProblemsKey);
  lastProblemsKey = key;

  if (shouldSend) {
    try {
      const tg = db.getSettings().telegram;
      if (tg.enabled && tg.chatId) {
        await notifier.sendTelegramTo(tg.chatId, text);
      }
    } catch (e) {
      db.addLog('Denetim bildirimi gönderilemedi: ' + e.message);
    }
  }

  return { ok: problems.length === 0, problems: problems.length, repairs, text };
}

module.exports = { runAudit };
