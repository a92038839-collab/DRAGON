// Dragon Coin serveri: sahifani beradi, kanal promokodlarini oladi,
// vazifa va auksionlarni hamma uchun umumiy saqlaydi.
// Node.js 18+ kerak, qo'shimcha paket kerak emas.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const BOT_TOKEN = process.env.BOT_TOKEN || '';

// Kutilmagan xato server o'chib qolishiga (502) sabab bo'lmasin, Render Logs'da ko'rinsin
process.on('uncaughtException', (e) => console.error('Xato:', e));
process.on('unhandledRejection', (e) => console.error('Xato:', e));
const CHANNEL = (process.env.CHANNEL || 'dragon_pcode').replace(/^@/, '');
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 3000);
const TG_API = process.env.TG_API || 'https://api.telegram.org';
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const DB_KEY = 'dragon_db';
const DB_FILE = path.join(__dirname, 'data.json');
const MAX_DB_BYTES = 900000; // Upstash bepul tarifida bitta qiymat 1 MB gacha

if (!BOT_TOKEN) console.error('DIQQAT: BOT_TOKEN kiritilmagan. Render → Environment bo‘limiga BOT_TOKEN ni qo‘shing. Bot funksiyalari ishlamaydi.');
const WEBHOOK_SECRET = crypto.createHash('sha256').update('wh:' + BOT_TOKEN).digest('hex').slice(0, 32);

/* ---------- Ombor: Upstash Redis (bepul) yoki fayl ---------- */
const defaults = () => ({
  promos: {}, used: {}, users: {}, adj: {}, adjLog: [],
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

/* ---------- Promokod rasmi (PNG, qo'shimcha paketsiz) ---------- */
const GLYPHS = {
  A: [[[0,6],[2,0],[4,6]], [[0.9,4],[3.1,4]]],
  B: [[[0,0],[0,6]], [[0,0],[2.5,0],[3.6,0.9],[3.6,2.1],[2.5,3],[0,3]], [[0,3],[2.8,3],[4,4],[4,5.1],[2.8,6],[0,6]]],
  C: [[[4,1],[3,0],[1,0],[0,1],[0,5],[1,6],[3,6],[4,5]]],
  D: [[[0,0],[0,6]], [[0,0],[2.5,0],[4,1.5],[4,4.5],[2.5,6],[0,6]]],
  E: [[[4,0],[0,0],[0,6],[4,6]], [[0,3],[3,3]]],
  F: [[[4,0],[0,0],[0,6]], [[0,3],[3,3]]],
  G: [[[4,1],[3,0],[1,0],[0,1],[0,5],[1,6],[3,6],[4,5],[4,3],[2,3]]],
  H: [[[0,0],[0,6]], [[4,0],[4,6]], [[0,3],[4,3]]],
  I: [[[0.5,0],[3.5,0]], [[2,0],[2,6]], [[0.5,6],[3.5,6]]],
  J: [[[4,0],[4,5],[3,6],[1,6],[0,5]]],
  K: [[[0,0],[0,6]], [[4,0],[0,3.5]], [[1.2,2.6],[4,6]]],
  L: [[[0,0],[0,6],[4,6]]],
  M: [[[0,6],[0,0],[2,3],[4,0],[4,6]]],
  N: [[[0,6],[0,0],[4,6],[4,0]]],
  O: [[[1,0],[3,0],[4,1],[4,5],[3,6],[1,6],[0,5],[0,1],[1,0]]],
  P: [[[0,6],[0,0],[3,0],[4,1],[4,2.5],[3,3.5],[0,3.5]]],
  Q: [[[1,0],[3,0],[4,1],[4,5],[3,6],[1,6],[0,5],[0,1],[1,0]], [[2.6,4.2],[4,6.2]]],
  R: [[[0,6],[0,0],[3,0],[4,1],[4,2.5],[3,3.5],[0,3.5]], [[2,3.5],[4,6]]],
  S: [[[4,1],[3,0],[1,0],[0,1],[0,2.2],[1,3],[3,3],[4,3.8],[4,5],[3,6],[1,6],[0,5]]],
  T: [[[0,0],[4,0]], [[2,0],[2,6]]],
  U: [[[0,0],[0,5],[1,6],[3,6],[4,5],[4,0]]],
  V: [[[0,0],[2,6],[4,0]]],
  W: [[[0,0],[1,6],[2,2.5],[3,6],[4,0]]],
  X: [[[0,0],[4,6]], [[4,0],[0,6]]],
  Y: [[[0,0],[2,3],[4,0]], [[2,3],[2,6]]],
  Z: [[[0,0],[4,0],[0,6],[4,6]]],
  0: [[[1,0],[3,0],[4,1],[4,5],[3,6],[1,6],[0,5],[0,1],[1,0]], [[1.1,4.7],[2.9,1.3]]],
  1: [[[1,1.2],[2.2,0],[2.2,6]], [[1,6],[3.4,6]]],
  2: [[[0,1],[1,0],[3,0],[4,1],[4,2.2],[0,6],[4,6]]],
  3: [[[0,1],[1,0],[3,0],[4,1],[4,2],[3,3],[1.5,3]], [[3,3],[4,4],[4,5],[3,6],[1,6],[0,5]]],
  4: [[[3,6],[3,0],[0,4.2],[4,4.2]]],
  5: [[[4,0],[0,0],[0,2.8],[3,2.8],[4,3.8],[4,5],[3,6],[1,6],[0,5]]],
  6: [[[3.6,0.4],[2,0],[1,0],[0,1],[0,5],[1,6],[3,6],[4,5],[4,3.8],[3,2.8],[1,2.8],[0,3.8]]],
  7: [[[0,0],[4,0],[1.5,6]]],
  8: [[[1,0],[3,0],[4,1],[4,2],[3,3],[1,3],[0,2],[0,1],[1,0]], [[1,3],[0,4],[0,5],[1,6],[3,6],[4,5],[4,4],[3,3]]],
  9: [[[0.4,5.6],[2,6],[3,6],[4,5],[4,1],[3,0],[1,0],[0,1],[0,2.2],[1,3.2],[3,3.2],[4,2.2]]],
  '-': [[[0.5,3],[3.5,3]]],
  '_': [[[0,6.6],[4,6.6]]],
  '+': [[[0.5,3],[3.5,3]], [[2,1.2],[2,4.8]]],
  '/': [[[0,6],[4,0]]],
  '.': [[[2,5.9],[2,6]]],
};
const W = 800, H = 420, SS = 2;
const GOLD = [245, 181, 61], GEM = [79, 209, 232], WHITE = [244, 239, 217], MUTED = [155, 184, 162], RED = [226, 60, 48];

function makeCanvas() { const w = W * SS, h = H * SS; return { w, h, px: new Float32Array(w * h * 3) }; }
function blend(c, i, col, a) { c.px[i] += (col[0] - c.px[i]) * a; c.px[i + 1] += (col[1] - c.px[i + 1]) * a; c.px[i + 2] += (col[2] - c.px[i + 2]) * a; }
function seg(c, x1, y1, x2, y2, r, col, alpha = 1) {
  const x0 = Math.max(0, Math.floor(Math.min(x1, x2) - r - 1)), xe = Math.min(c.w - 1, Math.ceil(Math.max(x1, x2) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(y1, y2) - r - 1)), ye = Math.min(c.h - 1, Math.ceil(Math.max(y1, y2) + r + 1));
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
  for (let y = y0; y <= ye; y++) for (let x = x0; x <= xe; x++) {
    let t = ((x + 0.5 - x1) * dx + (y + 0.5 - y1) * dy) / len2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x + 0.5 - (x1 + t * dx), y + 0.5 - (y1 + t * dy));
    const a = Math.min(1, Math.max(0, r + 0.5 - d)) * alpha;
    if (a > 0) blend(c, (y * c.w + x) * 3, col, a);
  }
}
function textWidth(s, h) { const sc = h / 6; return s.length ? s.length * 5.7 * sc - 1.7 * sc : 0; }
function drawText(c, s, cx, cy, h, col, sw, alpha = 1) {
  const sc = (h / 6) * SS, adv = 5.7 * sc, total = s.length * adv - 1.7 * sc;
  let ox = cx * SS - total / 2; const oy = cy * SS - 3 * sc;
  for (const ch of s) {
    for (const line of GLYPHS[ch] || []) for (let i = 0; i < line.length - 1; i++)
      seg(c, ox + line[i][0] * sc, oy + line[i][1] * sc, ox + line[i + 1][0] * sc, oy + line[i + 1][1] * sc, (sw * SS) / 2, col, alpha);
    ox += adv;
  }
}
function ring(c, cx, cy, r, w, col, alpha = 1) {
  const R = r * SS, hw = (w * SS) / 2, x0 = Math.floor(cx * SS - R - hw - 1), x1 = Math.ceil(cx * SS + R + hw + 1), y0 = Math.floor(cy * SS - R - hw - 1), y1 = Math.ceil(cy * SS + R + hw + 1);
  for (let y = Math.max(0, y0); y <= Math.min(c.h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(c.w - 1, x1); x++) {
    const d = Math.abs(Math.hypot(x + 0.5 - cx * SS, y + 0.5 - cy * SS) - R);
    const a = Math.min(1, Math.max(0, hw + 0.5 - d)) * alpha; if (a > 0) blend(c, (y * c.w + x) * 3, col, a);
  }
}
function roundBorder(c, inset, rad, w, col) {
  const hw = (w * SS) / 2, L = inset * SS, T = inset * SS, R = c.w - inset * SS, B = c.h - inset * SS, r = rad * SS;
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const px = x + 0.5, py = y + 0.5;
    const qx = Math.max(Math.abs(px - (L + R) / 2) - ((R - L) / 2 - r), 0), qy = Math.max(Math.abs(py - (T + B) / 2) - ((B - T) / 2 - r), 0);
    const d = Math.abs(Math.hypot(qx, qy) - r + (qx === 0 && qy === 0 ? 0 : 0));
    const dist = Math.hypot(qx, qy) + Math.min(Math.max(Math.abs(px - (L + R) / 2) - ((R - L) / 2 - r), Math.abs(py - (T + B) / 2) - ((B - T) / 2 - r)), 0) - r;
    const a = Math.min(1, Math.max(0, hw + 0.5 - Math.abs(dist))); if (a > 0) blend(c, (y * c.w + x) * 3, col, a);
  }
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function toPng(c) {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) for (let ch = 0; ch < 3; ch++) {
      let s = 0; for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) s += c.px[((y * SS + j) * c.w + (x * SS + i)) * 3 + ch];
      raw[y * (1 + W * 3) + 1 + x * 3 + ch] = Math.max(0, Math.min(255, Math.round(s / (SS * SS))));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
// Promokod kartasi. used=true bo'lsa ustiga qizil X chiziladi
function promoPng({ code, amount, cur, used, channel }) {
  const c = makeCanvas();
  for (let y = 0; y < c.h; y++) { const t = y / c.h; for (let x = 0; x < c.w; x++) { const i = (y * c.w + x) * 3; c.px[i] = 16 - 9 * t; c.px[i + 1] = 44 - 24 * t; c.px[i + 2] = 28 - 16 * t; } }
  // bambuk chiziqlari (fon)
  [70, 150, 650, 730].forEach((x, k) => { seg(c, x * SS, -10, x * SS, c.h + 10, (6 + (k % 2) * 3) * SS, [30, 92, 56], 0.35); for (let y = 40 + k * 17; y < H; y += 85) seg(c, (x - 9) * SS, y * SS, (x + 9) * SS, y * SS, 2.5 * SS, [14, 50, 30], 0.6); });
  roundBorder(c, 12, 26, 5, GOLD); roundBorder(c, 24, 18, 1.6, [190, 140, 50]);
  drawText(c, 'PROMOKOD', W / 2, 74, 40, GOLD, 5);
  const codeStr = String(code).toUpperCase();
  const h = Math.min(104, Math.max(30, (W - 150) / (codeStr.length * 5.7 / 6)));
  drawText(c, codeStr, W / 2, 205, h, WHITE, Math.max(4, h / 9));
  const rew = '+' + String(amount) + (cur === 'gem' ? ' OLMOS' : ' COIN');
  drawText(c, rew, W / 2, 318, 46, cur === 'gem' ? GEM : GOLD, 5);
  drawText(c, ('T.ME/' + String(channel || 'DRAGON_PCODE')).toUpperCase().replace(/[^A-Z0-9_\/.]/g, ''), W / 2, 376, 20, MUTED, 2.6);
  if (used) {
    for (let i = 0; i < c.px.length; i += 3) { c.px[i] *= 0.45; c.px[i + 1] *= 0.45; c.px[i + 2] *= 0.45; }
    seg(c, 70 * SS, 40 * SS, (W - 70) * SS, (H - 40) * SS, 11 * SS, RED, 0.95);
    seg(c, (W - 70) * SS, 40 * SS, 70 * SS, (H - 40) * SS, 11 * SS, RED, 0.95);
  }
  return toPng(c);
}


/* ---------- Telegram ---------- */
async function tg(method, params = {}) {
  if (!BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN yo‘q' };
  const r = await fetch(`${TG_API}/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  return r.json();
}
// Rasm yuborish / almashtirish uchun multipart so'rov
async function tgForm(method, fields, fileField, buf) {
  if (!BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN yo‘q' };
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  f.append(fileField, new Blob([buf], { type: 'image/png' }), 'promo.png');
  const r = await fetch(`${TG_API}/bot${BOT_TOKEN}/${method}`, { method: 'POST', body: f });
  return r.json();
}
const rewardText = (p) => '+' + p.amount + (p.cur === 'gem' ? ' olmos' : ' coin');
async function postPromoImage(code, p) {
  return tgForm('sendPhoto', { chat_id: '@' + CHANNEL, caption: '🎁 Promokod: ' + code + '\n' + rewardText(p) + '\n\nKodni Dragon Coin ilovasida Profil bo‘limiga kiriting.' },
    'photo', promoPng({ code, amount: p.amount, cur: p.cur, channel: CHANNEL }));
}
async function markPromoUsed(code, p) {
  if (!p.msgId) return;
  const r = await tgForm('editMessageMedia', {
    chat_id: '@' + CHANNEL, message_id: p.msgId,
    media: { type: 'photo', media: 'attach://photo', caption: '❌ Promokod ishlatilgan: ' + code },
  }, 'photo', promoPng({ code, amount: p.amount, cur: p.cur, used: true, channel: CHANNEL })).catch((e) => ({ ok: false, description: e.message }));
  if (!r.ok) console.error('Rasmni almashtirib bo‘lmadi:', r.description);
}
function touchUser(u) {
  if (!u) return;
  const id = String(u.id), name = str(u.first_name || u.username || 'Foydalanuvchi', 40), username = str(u.username || '', 40);
  const o = db.users[id];
  if (!o || o.name !== name || o.username !== username) {
    if (!o && Object.keys(db.users).length >= 3000) return;
    db.users[id] = { name, username, at: Date.now() }; saveDb();
  }
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
// Botga /start bosilganda xush kelibsiz xabari
function welcome(chatId) {
  const text = '🐉 Assalomu alaykum! Dragon Coin botiga xush kelibsiz! 🐲\n\n'
    + '📢 Bizning rasmiy kanalimiz: @' + CHANNEL + '\n\n'
    + '💚 Biz bilan ekanligingizdan xursandmiz! Omad va maroqli o‘yin tilaymiz! 🎉';
  const msg = { chat_id: chatId, text };
  if (/^https:\/\//.test(PUBLIC_URL)) msg.reply_markup = { inline_keyboard: [[{ text: '🎮 O‘ynash', web_app: { url: PUBLIC_URL } }]] };
  tg('sendMessage', msg).then((r) => { if (!r.ok) console.error('sendMessage:', r.description); }).catch((e) => console.error(e.message));
}
function handleUpdate(u) {
  const m = u.message;
  if (m && m.chat && m.chat.type === 'private' && /^\/start(\s|$|@)/i.test(String(m.text || ''))) return welcome(m.chat.id);
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
      return send(res, 200, { promos: [] }); // kodlar faqat kanalda rasm bo‘lib ko‘rinadi
    }
    if (req.method === 'GET' && url === '/api/content') {
      pruneLots();
      return send(res, 200, { tasks: db.tasks, auctions: db.auctions });
    }
    if (req.method === 'POST' && url === '/api/me') {
      const { initData } = await readBody(req);
      const me = checkInitData(initData); touchUser(me);
      return send(res, 200, { admin: isAdmin(me), admins: ADMIN_IDS.length });
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
      used.push(user.id); touchUser(user); saveDb();
      if (p.max && used.length >= p.max) markPromoUsed(key, p);
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
    if (req.method === 'POST' && url === '/api/admin/promo') {
      const b = await readBody(req);
      if (!isAdmin(checkInitData(b.initData))) return send(res, 403, { ok: false, error: 'Faqat admin' });
      const amount = Math.floor(Number(b.amount)), max = Math.floor(Number(b.max) || 1);
      if (!(amount >= 1 && amount <= 1e9) || !['coin', 'gem'].includes(b.cur) || !(max >= 1 && max <= 1e6)) return send(res, 200, { ok: false, error: 'Miqdor yoki son noto‘g‘ri' });
      let code = String(b.code || '').trim().toUpperCase();
      if (!code) code = 'DR' + crypto.randomBytes(3).toString('hex').toUpperCase();
      if (!/^[A-Z0-9_-]{3,16}$/.test(code)) return send(res, 200, { ok: false, error: 'Kod 3-16 ta lotin harf, raqam, - yoki _ dan iborat bo‘lsin' });
      if (db.promos[code]) return send(res, 200, { ok: false, error: 'Bu kod bor' });
      if (Object.keys(db.promos).length >= 500) return send(res, 200, { ok: false, error: 'Eski kodlarni o‘chiring' });
      const p = { amount, cur: b.cur, max, at: Date.now() };
      const r = await postPromoImage(code, p);
      if (!r.ok) return send(res, 200, { ok: false, error: 'Kanalga yuborilmadi: ' + (r.description || 'noma’lum xato') + '. Bot @' + CHANNEL + ' kanalida admin ekanini tekshiring.' });
      p.msgId = r.result.message_id; db.promos[code] = p; db.used[code] = []; saveDb();
      return send(res, 200, { ok: true, code });
    }
    if (req.method === 'POST' && url === '/api/admin/promos') {
      const { initData } = await readBody(req);
      if (!isAdmin(checkInitData(initData))) return send(res, 403, { ok: false, error: 'Faqat admin' });
      const promos = Object.entries(db.promos).sort((a, b) => b[1].at - a[1].at).slice(0, 100)
        .map(([code, p]) => ({ code, amount: p.amount, cur: p.cur, max: p.max || 1, used: (db.used[code] || []).length }));
      return send(res, 200, { ok: true, promos });
    }
    if (req.method === 'POST' && url === '/api/admin/promo/delete') {
      const { initData, code } = await readBody(req);
      if (!isAdmin(checkInitData(initData))) return send(res, 403, { ok: false, error: 'Faqat admin' });
      const k = String(code || '').toUpperCase(), p = db.promos[k];
      if (!p) return send(res, 200, { ok: false, error: 'Kod topilmadi' });
      if (p.msgId) tg('deleteMessage', { chat_id: '@' + CHANNEL, message_id: p.msgId }).catch(() => {});
      delete db.promos[k]; delete db.used[k]; saveDb();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/api/admin/users') {
      const { initData, q } = await readBody(req);
      if (!isAdmin(checkInitData(initData))) return send(res, 403, { ok: false, error: 'Faqat admin' });
      const needle = String(q || '').trim().toLowerCase().replace(/^@/, '');
      const users = needle ? Object.entries(db.users)
        .filter(([id, u]) => id === needle || u.username.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle))
        .slice(0, 10).map(([id, u]) => ({ id, name: u.name, username: u.username })) : [];
      return send(res, 200, { ok: true, users, log: db.adjLog.slice(0, 10) });
    }
    if (req.method === 'POST' && url === '/api/admin/adjust') {
      const b = await readBody(req);
      if (!isAdmin(checkInitData(b.initData))) return send(res, 403, { ok: false, error: 'Faqat admin' });
      const id = String(b.userId || '');
      const coin = Math.floor(Number(b.coin) || 0), gem = Math.floor(Number(b.gem) || 0);
      if (!/^\d{4,15}$/.test(id)) return send(res, 200, { ok: false, error: 'Telegram ID noto‘g‘ri' });
      if (!(coin >= 0 && gem >= 0 && coin <= 1e12 && gem <= 1e12) || !(coin || gem)) return send(res, 200, { ok: false, error: 'Miqdor noto‘g‘ri' });
      const sign = b.mode === 'take' ? -1 : 1;
      const list = db.adj[id] || (db.adj[id] = []);
      if (list.length >= 50) return send(res, 200, { ok: false, error: 'Foydalanuvchi hali oldingi o‘zgarishlarni olmagan' });
      const entry = { id: 'a' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), c: sign * coin, g: sign * gem, at: Date.now() };
      list.push(entry);
      const u = db.users[id];
      db.adjLog.unshift({ at: entry.at, to: u ? u.name + ' (' + id + ')' : id, c: entry.c, g: entry.g });
      db.adjLog = db.adjLog.slice(0, 30);
      saveDb();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/api/adjustments') {
      const { initData } = await readBody(req);
      const user = checkInitData(initData);
      if (!user) return send(res, 401, { ok: false });
      return send(res, 200, { ok: true, list: db.adj[String(user.id)] || [] });
    }
    if (req.method === 'POST' && url === '/api/adjustments/ack') {
      const { initData, ids } = await readBody(req);
      const user = checkInitData(initData);
      if (!user) return send(res, 401, { ok: false });
      const set = new Set(Array.isArray(ids) ? ids.map(String) : []), k = String(user.id);
      if (db.adj[k]) { db.adj[k] = db.adj[k].filter((x) => !set.has(x.id)); if (!db.adj[k].length) delete db.adj[k]; saveDb(); }
      return send(res, 200, { ok: true });
    }
    send(res, 404, { ok: false });
  } catch (e) { console.error(e); send(res, 500, { ok: false }); }
}).listen(PORT, '0.0.0.0', async () => {
  await loadDb();
  console.log('Server', PORT, '| kanal @' + CHANNEL);
  if (PUBLIC_URL) {
    const r = await tg('setWebhook', { url: PUBLIC_URL + '/tg', secret_token: WEBHOOK_SECRET, allowed_updates: ['channel_post', 'message'] }).catch((e) => ({ ok: false, description: e.message }));
    console.log('Webhook:', r.ok ? 'ulandi' : r.description);
  } else console.warn('PUBLIC_URL yo‘q: kanal postlarini olish uchun webhook ulanmadi.');
});
