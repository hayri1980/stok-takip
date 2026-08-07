const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'store.json');
const REPO = 'hayri1980/stok-takip-yedek';
const FILE = 'data/store.json';

let chain = Promise.resolve();

function token() {
  return process.env.GITHUB_TOKEN || '';
}

function queue(fn) {
  chain = chain.then(fn, fn);
  return chain;
}

async function githubContents(method, sha) {
  const url = 'https://api.github.com/repos/' + REPO + '/contents/' + FILE;
  const headers = {
    Authorization: 'Bearer ' + token(),
    'User-Agent': 'stok-takip',
    Accept: 'application/vnd.github+json'
  };
  const opts = { method: method, headers: headers, signal: AbortSignal.timeout(20000) };
  if (method === 'PUT') {
    headers['Content-Type'] = 'application/json';
    const content = fs.readFileSync(DATA_FILE, 'utf8');
    const body = { message: 'otomatik yedek', content: Buffer.from(content).toString('base64') };
    if (sha) body.sha = sha;
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) throw new Error('GitHub ' + method + ' ' + res.status);
  return res.json();
}

function isEmptyData(data) {
  if (!data || typeof data !== 'object') return true;
  if (Array.isArray(data.products) && data.products.length > 0) return false;
  const s = data.settings || {};
  if ((s.telegram && s.telegram.botToken) || (s.trendyol && s.trendyol.apiKey) || (s.mail && s.mail.enabled)) return false;
  return true;
}

function backupNow() {
  if (!token() || !fs.existsSync(DATA_FILE)) return Promise.resolve();
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return Promise.resolve();
  }
  if (isEmptyData(data)) return Promise.resolve();
  return queue(async () => {
    let sha = null;
    try {
      const current = await githubContents('GET');
      if (current) sha = current.sha;
      await githubContents('PUT', sha);
    } catch (e) {
      console.log('Yedekleme hatas�: ' + e.message);
    }
  });
}

async function restore() {
  if (!token() || fs.existsSync(DATA_FILE)) return false;
  try {
    const data = await githubContents('GET');
    if (!data) return false;
    const text = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
    const parsed = JSON.parse(text);
    if (isEmptyData(parsed)) return false;
    if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, text, 'utf8');
    return true;
  } catch (e) {
    console.log('Geri y�kleme hatas�: ' + e.message);
    return false;
  }
}

module.exports = { backupNow, restore };
