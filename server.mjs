// 內部預覽用的小伺服器：靜態檔（gzip）＋ demo 用的回報 API（存在 runtime/，不進 git）。
// 用法：PORT=8096 HOSTS=100.114.169.66,127.0.0.1 node server.mjs
import http from 'node:http';
import { stripKeepGps } from './functions/_lib/exif-gps.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { staleDays, photoPoints, POINTS, workOrderFor } from './app/js/sim.js';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const APP = path.join(ROOT, 'app');
const RUNTIME = path.join(ROOT, 'runtime');
const PHOTOS = path.join(RUNTIME, 'photos');
const DB = path.join(RUNTIME, 'db.json');
fs.mkdirSync(PHOTOS, { recursive: true });

const PORT = +(process.env.PORT || 8096);
const HOSTS = (process.env.HOSTS || '127.0.0.1').split(',');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

let db = { events: [] };
if (fs.existsSync(DB)) db = JSON.parse(fs.readFileSync(DB, 'utf8')); // 壞檔就讓它當掉，不要靜默覆蓋舊資料
// 先寫暫存檔再改名，寫到一半當掉也不會弄壞 db.json
const save = () => { fs.writeFileSync(DB + '.tmp', JSON.stringify(db)); fs.renameSync(DB + '.tmp', DB); };
const MAX_EVENTS = 5000;

// 樹籍（驗證 treeId、伺服器自己算點數與施工範圍，不信任瀏覽器送來的值）
const TREES = new Map();
{
  const d = JSON.parse(fs.readFileSync(path.join(APP, 'data/trees.json'), 'utf8'));
  for (const r of d.rows) TREES.set(r[0], { id: r[0], lng: r[1], lat: r[2], kind: r[10], place: d.places[r[8]] });
}
const validTree = (id) => TREES.has(id) || /^(HOLE-\d+|DEMO-DONGMEN|JJ0263131034|JJ0253210002)$/.test(id);

// 簡單的寫入頻率限制：每個 IP 每分鐘最多 10 筆
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now); hits.set(ip, list);
  return list.length > 10;
}
const distBand = (d) => (d == null ? null : d <= 15 ? '≤15m' : d <= 40 ? '≤40m' : '>40m');
const gzCache = new Map();

// 再保險一次：去掉 JPEG 的 APP1（EXIF／XMP，含 GPS）與 APP13 等 metadata 區段。前端已用 canvas 重新編碼過。
function stripJpegMeta(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xda) { out.push(buf.subarray(i)); break; } // 影像資料開始，之後照抄
    const len = buf.readUInt16BE(i + 2);
    const isMeta = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMeta) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return Buffer.concat(out);
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 4e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const clip = (v, n) => String(v ?? '').slice(0, n);

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const tree = url.searchParams.get('tree');
    const list = tree ? db.events.filter((e) => e.treeId === tree) : db.events.slice(-1000);
    return json(res, 200, list);
  }
  if (req.method === 'POST' && url.pathname === '/api/events') {
    if (rateLimited(req.socket.remoteAddress)) return json(res, 429, { error: '送太快了，請稍後再試' });
    if (db.events.length >= MAX_EVENTS) return json(res, 507, { error: 'demo 儲存空間已滿' });
    let b;
    try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad body' }); }
    if (!b || typeof b !== 'object' || !b.treeId || !['citizen', 'vendor'].includes(b.role)) return json(res, 400, { error: 'missing fields' });
    if (!validTree(String(b.treeId))) return json(res, 400, { error: 'unknown tree' });
    const tree = TREES.get(String(b.treeId));
    // 廠商回報只收模擬施工案範圍內的樹（示範區），避免有人把「異常」掛到真實樹上
    if (b.role === 'vendor' && !(tree && workOrderFor(tree))) return json(res, 400, { error: 'not in demo work order' });
    const ev = {
      id: crypto.randomUUID(),
      treeId: clip(b.treeId, 40),
      role: b.role,
      kind: clip(b.kind, 30),
      nickname: clip(b.nickname, 24),
      note: clip(b.note, 500),
      vendor: clip(b.vendor, 60),
      result: clip(b.result, 30),
      at: new Date().toISOString(),
      photo: null,
      pts: 0,
      // 只存比對結果與距離級距，不存精確距離（精確距離加上暱稱可能被拿來推算使用者位置）
      verify: b.verify && typeof b.verify === 'object' ? { method: clip(b.verify.method, 10), band: distBand(Number.isFinite(+b.verify.dist) && b.verify.dist !== null ? +b.verify.dist : null), ok: !!b.verify.ok } : null,
    };
    // 只有通過 15 公尺比對才保留座標（照片寫回只含 GPS 的 EXIF）
    const gps = b.verify?.ok && Number.isFinite(+b.verify.lat) && Number.isFinite(+b.verify.lng) ? { lat: +(+b.verify.lat).toFixed(5), lng: +(+b.verify.lng).toFixed(5) } : null;
    if (gps && ev.verify) Object.assign(ev.verify, gps);
    if (b.photo) {
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(b.photo);
      const clean = m && stripKeepGps(Buffer.from(m[1], 'base64'), gps);
      if (!clean) return json(res, 400, { error: 'photo must be jpeg' });
      const name = `${ev.id}.jpg`;
      fs.writeFileSync(path.join(PHOTOS, name), clean);
      ev.photo = `/photos/${name}`;
    }
    if (ev.role === 'citizen') {
      const photoed = db.events.some((e) => e.treeId === ev.treeId && e.photo);
      const days = photoed ? 0 : tree ? staleDays(tree.id) : -1;
      ev.pts = POINTS.report + (ev.photo && ev.verify?.ok ? photoPoints(days) : 0);
    }
    db.events.push(ev);
    save();
    return json(res, 200, ev);
  }
  // 許願種樹（本機版；正式站是 functions/api/wishes.js）：另存 db.wishes，不混進回報事件
  if (url.pathname === '/api/wishes') {
    db.wishes ||= [];
    if (req.method === 'GET') return json(res, 200, db.wishes.slice(-2000).reverse().filter((w) => !w.defaultLoc));
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (rateLimited(req.socket.remoteAddress)) return json(res, 429, { error: '送太快了，請稍後再試' });
    if (db.wishes.length >= MAX_EVENTS) return json(res, 507, { error: 'demo 儲存空間已滿' });
    let b;
    try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad body' }); }
    const lat = +(+b?.lat).toFixed(4), lng = +(+b?.lng).toFixed(4);
    if (!(lat > 24.95 && lat < 25.22 && lng > 121.45 && lng < 121.67)) return json(res, 400, { error: '不在台北市範圍' });
    if (!['luan', 'jiadong', 'zhang', 'guangla', 'shanlan', 'shuihuang'].includes(b.species)) return json(res, 400, { error: 'unknown species' });
    const w = { id: crypto.randomUUID(), lat, lng, species: b.species, defaultLoc: !!b.defaultLoc, at: new Date().toISOString(), pts: 30, photo: null };
    if (b.photo) {
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(b.photo);
      const clean = m && stripJpegMeta(Buffer.from(m[1], 'base64'));
      if (!clean) return json(res, 400, { error: 'photo must be jpeg' });
      fs.writeFileSync(path.join(PHOTOS, `${w.id}.jpg`), clean);
      w.photo = `/photos/${w.id}.jpg`;
    }
    db.wishes.push(w);
    save();
    return json(res, 200, w);
  }
  const del = /^\/api\/events\/([\w-]+)$/.exec(url.pathname);
  if (req.method === 'DELETE' && del) {
    if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return json(res, 403, { error: 'forbidden' });
    const before = db.events.length;
    db.events = db.events.filter((e) => e.id !== del[1]);
    save();
    return json(res, 200, { ok: db.events.length < before });
  }
  json(res, 404, { error: 'not found' });
}

function serveFile(req, res, file) {
  const ext = path.extname(file);
  const type = TYPES[ext] || 'application/octet-stream';
  const st = fs.statSync(file);
  const headers = { 'x-content-type-options': 'nosniff', 'content-type': type, 'cache-control': ext === '.json' && file.includes('/data/') ? 'public, max-age=600' : 'no-cache' };
  const gz = /gzip/.test(req.headers['accept-encoding'] || '') && /text|json|svg|javascript/.test(type);
  if (gz) {
    const key = `${file}:${st.mtimeMs}`;
    if (!gzCache.has(key)) gzCache.set(key, zlib.gzipSync(fs.readFileSync(file), { level: 6 }));
    headers['content-encoding'] = 'gzip';
    res.writeHead(200, headers);
    return res.end(gzCache.get(key));
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

const server = (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch((e) => { console.error(e); json(res, 500, { error: 'server error' }); });
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('bad request'); }
  let base = APP;
  if (p.startsWith('/photos/')) { base = PHOTOS; p = p.slice('/photos'.length); }
  // 角色路徑（/gov、/vendor、/esg、/plan）都回同一個頁面
  if (base === APP && (/^\/(gov|vendor|esg|plan|mayor|features)\/?$/.test(p) || /^\/f\/[\w-]+\/?$/.test(p))) p = "/index.html";
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(base, p));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  serveFile(req, res, file);
};

const safe = (req, res) => { try { server(req, res); } catch (e) { console.error(e); try { res.writeHead(500); res.end('server error'); } catch {} } };
for (const h of HOSTS) http.createServer(safe).listen(PORT, h, () => console.log(`tree-twin on http://${h}:${PORT}`));
