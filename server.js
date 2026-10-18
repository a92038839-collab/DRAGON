// Dragon Coin serveri: sahifani beradi, kanal promokodlarini oladi,
// vazifa va auksionlarni hamma uchun umumiy saqlaydi.
// Node.js 18+ kerak, qo'shimcha paket kerak emas.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN || '';

// Kutilmagan xato server o'chib qolishiga (502) sabab bo'lmasin, Render Logs'da ko'rinsin
process.on('uncaughtException', (e) => console.error('Xato:', e));
process.on('unhandledRejection', (e) => console.error('Xato:', e));
const CHANNEL = (process.env.CHANNEL || 'dragon_pcode').replace(/^@/, '');
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 3000);
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const DB_KEY = 'dragon_db';
const DB_FILE = path.join(__dirname, 'data.json');
const MAX_DB_BYTES = 900000; // Upstash bepul tarifida bitta qiymat 1 MB gacha

if (!BOT_TOKEN) console.error('DIQQAT: BOT_TOKEN kiritilmagan. Render → Environment bo‘limiga BOT_TOKEN ni qo‘shing. Bot funksiyalari ishlamaydi.');
const WEBHOOK_SECRET = crypto.createHash('sha256').update('wh:' + BOT_TOKEN).digest('hex').slice(0, 32);

/* ---------- Ombor: Upstash Redis (bepul) yoki fayl ---------- */
const defaults = () => ({
  promos: {}, used: {},
  tasks: [
    { id: 't1', type: 'channel', title: 'Dragon Promo kanaliga obuna bo‘ling', link: 'https://t.me/' + CHANNEL, amount: 500, cur: 'coin' },
    { id: 't3', type: 'bot', title: 'Xamster botiga start bosing', link: 'https://t.me/Xamster_uzb_bot', amount: 150, cur: 'coin' },
  ],
  auctions: [],
});
let db = defaults();

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return r.json();
}
async function loadDb() {
  try {
    let raw = null;
    if (REDIS_URL && REDIS_TOKEN) raw = (await redis(['GET', DB_KEY])).result;
    else if (fs.existsSync(DB_FILE)) raw = fs.readFileSync(DB_FILE, 'utf8');
    if (raw) db = { ...defaults(), ...JSON.parse(raw) };
  } catch (e) { console.error('Bazani o‘qib bo‘lmadi:', e.message); }
  if (!(REDIS_URL && REDIS_TOKEN)) console.warn('Diqqat: Upstash ulanmagan, ma’lumot Render qayta ishga tushganda o‘chadi.');
}
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const raw = JSON.stringify(db);
      if (REDIS_URL && REDIS_TOKEN) await redis(['SET', DB_KEY, raw]);
      else fs.writeFileSync(DB_FILE, raw);
    } catch (e) { console.error('Saqlab bo‘lmadi:', e.message); }
  }, 300);
}

/* ---------- Telegram ---------- */
async function tg(method, params = {}) {
  if (!BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN yo‘q' };
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  return r.json();
}
async function isMember(channel, userId) {
  const r = await tg('getChatMember', { chat_id: '@' + channel, user_id: userId });
  if (!r.ok) return false;
  const s = r.result.status;
  return s === 'creator' || s === 'administrator' || s === 'member' || (s === 'restricted' && r.result.is_member);
}
function checkInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const str = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date') || 0) > 86400) return null;
  try { return JSON.parse(params.get('user')); } catch (e) { return null; }
}
const isAdmin = (user) => !!user && ADMIN_IDS.includes(String(user.id));

// Kanal posti: "KOD: NOM | 500 coin" yoki "KOD: NOM | 5 olmos | 100 ta"
function parsePost(text) {
  const parts = String(text || '').split('|').map((x) => x.trim());
  const code = parts[0].match(/^KOD\s*:\s*([A-Za-z0-9_-]{3,32})$/i);
  const reward = (parts[1] || '').match(/^(\d{1,12})\s*(coin|olmos)$/i);
  if (!code || !reward) return null;
  const max = (parts[2] || '').match(/^(\d{1,9})\s*ta$/i);
  return { code: code[1].toUpperCase(), amount: Number(reward[1]), cur: reward[2].toLowerCase() === 'olmos' ? 'gem' : 'coin', max: max ? Number(max[1]) : 0 };
}
function handleUpdate(u) {
  const post = u.channel_post;
  if (!post || !post.chat || String(post.chat.username || '').toLowerCase() !== CHANNEL.toLowerCase()) return;
  const p = parsePost(post.text || post.caption);
  if (p && !db.promos[p.code]) {
    db.promos[p.code] = { amount: p.amount, cur: p.cur, max: p.max, at: Date.now() };
    db.used[p.code] = [];
    saveDb();
    console.log('Yangi promokod:', p.code, p.amount, p.cur);
  }
}

/* ---------- Tekshiruv (admin yuborgan ma'lumot) ---------- */
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
function cleanTasks(list) {
  if (!Array.isArray(list) || list.length > 50) return null;
  const out = [];
  for (const t of list) {
    const amount = Math.floor(Number(t.amount));
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(t.id)) || !['channel', 'bot', 'link'].includes(t.type)) return null;
    if (!/^https?:\/\/\S{1,190}$/i.test(String(t.link)) || !(amount >= 1 && amount <= 1e9) || !['coin', 'gem'].includes(t.cur)) return null;
    out.push({ id: String(t.id), type: t.type, title: str(t.title, 80), link: String(t.link), amount, cur: t.cur });
  }
  return out;
}
function cleanAuctions(list) {
  if (!Array.isArray(list) || list.length > 50) return null;
  const out = [];
  for (const a of list) {
    const start = Math.floor(Number(a.start)), endsAt = Math.floor(Number(a.endsAt));
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(a.id)) || !(start >= 1 && start <= 1e12) || !(endsAt > 0)) return null;
    const img = String(a.img || '');
    if (img.length > 300000 || !/^(data:image\/|https:\/\/)/.test(img)) return null;
    out.push({ id: String(a.id), name: str(a.name, 60), img, endsAt, start });
  }
  return out;
}
// Tugaganiga 3 kundan oshgan foydalanuvchi lotlarini tozalaymiz (baza kichik qolishi uchun)
function pruneLots() {
  const limit = Date.now() - 3 * 86400e3;
  const before = db.auctions.length;
  db.auctions = db.auctions.filter((x) => !(x.sellerId && x.endsAt < limit));
  if (db.auctions.length !== before) saveDb();
}
const minNext = (a) => (a.bidderId ? a.bid + Math.max(10, Math.ceil(a.bid * 0.05)) : a.start);

/* ---------- HTTP ---------- */
// index.html public/ ichida yoki (telefondan yuklanganda) to'g'ridan-to'g'ri asosiy papkada bo'lishi mumkin
const INDEX_FILES = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')];
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 3000000) {
  return new Promise((resolve) => {
    let d = '', over = false;
    req.on('data', (c) => { d += c; if (d.length > limit) { over = true; req.destroy(); } });
    req.on('end', () => { if (over) return resolve({}); try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      const file = INDEX_FILES.find((f) => fs.existsSync(f));
      if (!file) {
        console.error('index.html topilmadi. GitHub repoda public/index.html bo‘lishi kerak.');
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('index.html topilmadi. GitHub repoga public/index.html faylini yuklang.');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(file));
    }
    if (url === '/health') return send(res, 200, { ok: true });

    if (req.method === 'POST' && url === '/tg') {
      if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) return send(res, 403, { ok: false });
      handleUpdate(await readBody(req));
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url === '/api/promos') {
      const list = Object.entries(db.promos)
        .filter(([c, p]) => !p.max || (db.used[c] || []).length < p.max)
        .map(([code, p]) => ({ code, amount: p.amount, cur: p.cur }));
      return send(res, 200, { promos: list });
    }
    if (req.method === 'GET' && url === '/api/content') {
      pruneLots();
      return send(res, 200, { tasks: db.tasks, auctions: db.auctions });
    }
    if (req.method === 'POST' && url === '/api/me') {
      const { initData } = await readBody(req);
      return send(res, 200, { admin: isAdmin(checkInitData(initData)) });
    }
    if (req.method === 'POST' && url === '/api/check-sub') {
      const { channel, initData } = await readBody(req);
      const user = checkInitData(initData);
      if (!user) return send(res, 401, { ok: false, error: 'Telegram orqali oching' });
      if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(String(channel))) return send(res, 400, { ok: false });
      return send(res, 200, { ok: await isMember(channel, user.id) });
    }
    if (req.method === 'POST' && url === '/api/redeem') {
      const { code, initData } = await readBody(req);
      const user = checkInitData(initData);
      if (!user) return send(res, 401, { ok: false, error: 'Telegram orqali oching' });
      const key = String(code || '').trim().toUpperCase();
      const p = db.promos[key];
      if (!p) return send(res, 200, { ok: false, error: 'Kod topilmadi' });
      if (!(await isMember(CHANNEL, user.id))) return send(res, 200, { ok: false, error: 'Avval @' + CHANNEL + ' kanaliga obuna bo‘ling' });
      const used = db.used[key] || (db.used[key] = []);
      if (used.includes(user.id)) return send(res, 200, { ok: false, error: 'Bu kod ishlatilgan' });
      if (p.max && used.length >= p.max) return send(res, 200, { ok: false, error: 'Kod tugagan' });
      used.push(user.id); saveDb();
      return send(res, 200, { ok: true, amount: p.amount, cur: p.cur });
    }
    if (req.method === 'POST' && url === '/api/bid') {
      const { id, amount, initData } = await readBody(req);
      const user = checkInitData(initData);
      if (!user) return send(res, 401, { ok: false, error: 'Telegram orqali oching' });
      const a = db.auctions.find((x) => x.id === id);
      if (!a) return send(res, 200, { ok: false, error: 'Auksion topilmadi' });
      if (a.endsAt <= Date.now()) return send(res, 200, { ok: false, error: 'Auksion tugagan' });
      if (a.sellerId && a.sellerId === String(user.id)) return send(res, 200, { ok: false, error: 'O‘z lotingizga taklif bera olmaysiz' });
      const v = Math.floor(Number(amount));
      if (!(v >= minNext(a)) || v > 1e12) return send(res, 200, { ok: false, error: 'Taklif juda kam' });
      a.bid = v; a.bidderId = String(user.id); a.bidder = str(user.first_name || user.username || 'Foydalanuvchi', 30);
      saveDb();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/api/lots') {
      const { initData, name, img, hours, start } = await readBody(req);
      const user = checkInitData(initData);
      if (!user) return send(res, 401, { ok: false, error: 'Telegram orqali oching' });
      pruneLots();
      const nm = str(name, 60).trim(), st = Math.floor(Number(start)), im = String(img || '');
      if (!nm) return send(res, 200, { ok: false, error: 'Nom kiriting' });
      if (![1, 6, 24, 72, 168].includes(Number(hours))) return send(res, 200, { ok: false, error: 'Muddat noto‘g‘ri' });
      if (!(st >= 1 && st <= 1e9)) return send(res, 200, { ok: false, error: 'Narx noto‘g‘ri' });
      if (im.length > 80000 || !/^(data:image\/|https:\/\/)/.test(im)) return send(res, 200, { ok: false, error: 'Rasm juda katta' });
      const mine = db.auctions.filter((x) => x.sellerId === String(user.id) && x.endsAt > Date.now()).length;
      if (mine >= 3) return send(res, 200, { ok: false, error: 'Bir vaqtda 3 tadan ko‘p lot qo‘ya olmaysiz' });
      const lot = {
        id: 'u' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), name: nm, img: im,
        endsAt: Date.now() + Number(hours) * 3600e3, start: st, bid: 0, bidder: null, bidderId: null,
        sellerId: String(user.id), seller: str((user.first_name || 'Foydalanuvchi') + (user.username ? ' (@' + user.username + ')' : ''), 60),
      };
      if (JSON.stringify({ ...db, auctions: [...db.auctions, lot] }).length > MAX_DB_BYTES) return send(res, 200, { ok: false, error: 'Hozir lotlar juda ko‘p, keyinroq urinib ko‘ring' });
      db.auctions.push(lot); saveDb();
      return send(res, 200, { ok: true, id: lot.id });
    }
    if (req.method === 'POST' && url === '/api/lots/delete') {
      const { initData, id } = await readBody(req);
      const user = checkInitData(initData);
      if (!user) return send(res, 401, { ok: false, error: 'Telegram orqali oching' });
      const a = db.auctions.find((x) => x.id === id);
      if (!a) return send(res, 200, { ok: false, error: 'Lot topilmadi' });
      if (!(isAdmin(user) || a.sellerId === String(user.id))) return send(res, 403, { ok: false, error: 'Bu sizning lotingiz emas' });
      if (a.bidderId && !isAdmin(user)) return send(res, 200, { ok: false, error: 'Taklif berilgan lotni bekor qilib bo‘lmaydi' });
      db.auctions = db.auctions.filter((x) => x.id !== id); saveDb();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/api/admin/content') {
      const body = await readBody(req);
      const { initData, tasks, auctions } = body;
      if (!isAdmin(checkInitData(initData))) return send(res, 403, { ok: false, error: 'Faqat admin' });
      const t = cleanTasks(tasks), au = cleanAuctions(auctions);
      if (!t || !au) return send(res, 400, { ok: false, error: 'Ma’lumot noto‘g‘ri' });
      const removed = Array.isArray(body.removed) ? body.removed.map(String) : [];
      const old = new Map(db.auctions.map((x) => [x.id, x]));
      const adminNext = au
        .filter((x) => !(old.get(x.id) && old.get(x.id).sellerId)) // foydalanuvchi lotlariga admin tegmaydi (faqat removed orqali o‘chiradi)
        .map((x) => { const o = old.get(x.id); return { ...x, bid: o ? o.bid : 0, bidder: o ? o.bidder : null, bidderId: o ? o.bidderId : null }; });
      const userLots = db.auctions.filter((x) => x.sellerId && !removed.includes(x.id));
      const next = [...adminNext, ...userLots];
      if (JSON.stringify({ ...db, tasks: t, auctions: next }).length > MAX_DB_BYTES) return send(res, 400, { ok: false, error: 'Juda katta. Rasmlarni kichraytiring yoki ba’zi auksionlarni o‘chiring' });
      db.tasks = t; db.auctions = next; saveDb();
      return send(res, 200, { ok: true });
    }
    send(res, 404, { ok: false });
  } catch (e) { console.error(e); send(res, 500, { ok: false }); }
}).listen(PORT, '0.0.0.0', async () => {
  await loadDb();
  console.log('Server', PORT, '| kanal @' + CHANNEL);
  if (PUBLIC_URL) {
    const r = await tg('setWebhook', { url: PUBLIC_URL + '/tg', secret_token: WEBHOOK_SECRET, allowed_updates: ['channel_post'] }).catch((e) => ({ ok: false, description: e.message }));
    console.log('Webhook:', r.ok ? 'ulandi' : r.description);
  } else console.warn('PUBLIC_URL yo‘q: kanal postlarini olish uchun webhook ulanmadi.');
});
