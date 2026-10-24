// Pages Functions 共用：與 server.mjs 相同的防護規則（樹籍驗證、伺服器算點數、距離只存級距、頻率限制）。
import { staleDays, photoPoints, POINTS } from '../../app/js/sim.js';
import { WO_IDS } from './wo-ids.js';

export const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clip = (v, n) => String(v ?? '').slice(0, n);
const SPECIAL = /^(HOLE-\d+|DEMO-DONGMEN|JJ0263131034|JJ0253210002)$/;
// 完整樹籍清單太大，Functions 只驗格式（兩個英文字母＋10 位數字）；本機 server.mjs 驗完整清單
const validTree = (id) => /^[A-Z]{2}\d{10}$/.test(id) || SPECIAL.test(id);
const distBand = (d) => (d == null ? null : d <= 15 ? '≤15m' : d <= 40 ? '≤40m' : '>40m');
import { stripKeepGps } from './exif-gps.js';
const MAX_PHOTO = 600 * 1024;
const MAX_EVENTS = 20000;

export function stripJpegMeta(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xda) { parts.push(buf.subarray(i)); break; }
    const len = (buf[i + 2] << 8) | buf[i + 3];
    const isMeta = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMeta) parts.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function ipHash(request, salt) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + (salt || 'tree-twin')));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function rowToEvent(r) {
  return {
    id: r.id, treeId: r.tree_id, role: r.role, kind: r.kind, nickname: r.nickname, note: r.note, vendor: r.vendor, result: r.result,
    at: r.at, pts: r.pts, verify: r.verify ? JSON.parse(r.verify) : null, photo: r.photo_id ? `/photos/${r.photo_id}.jpg` : null,
  };
}

export async function listEvents(env, tree) {
  const q = tree
    ? env.DB.prepare("SELECT * FROM events WHERE tree_id = ? AND hidden = 0 AND role != 'wish' ORDER BY at").bind(tree)
    : env.DB.prepare("SELECT * FROM (SELECT * FROM events WHERE hidden = 0 AND role != 'wish' ORDER BY at DESC LIMIT 1000) ORDER BY at");
  const { results } = await q.all();
  return results.map(rowToEvent);
}

export async function createEvent(request, env) {
  // 解析前先擋：只收 JSON、本體不超過 900 KB
  if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ error: 'json only' }, 415);
  if (+(request.headers.get('content-length') || 0) > 900 * 1024) return json({ error: '照片太大' }, 413);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad body' }, 400); }
  if (!b || typeof b !== 'object' || !b.treeId || !['citizen', 'vendor'].includes(b.role)) return json({ error: 'missing fields' }, 400);
  const treeId = clip(b.treeId, 40);
  if (!validTree(treeId)) return json({ error: 'unknown tree' }, 400);
  if (b.role === 'vendor' && !WO_IDS.has(treeId)) return json({ error: 'not in demo work order' }, 400);
  const ip = await ipHash(request, env.IP_SALT);
  const since = new Date(Date.now() - 60000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE ip = ? AND at > ?').bind(ip, since).first();
  if (recent.n >= 10) return json({ error: '送太快了，請稍後再試' }, 429);
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM events').first();
  if (total.n >= MAX_EVENTS) return json({ error: 'demo 儲存空間已滿' }, 507);

  const id = crypto.randomUUID();
  const v = b.verify && typeof b.verify === 'object' ? b.verify : null;
  // 只有通過 15 公尺比對的照片才保留座標（寫回只含 GPS 的 EXIF，也存進 verify）
  const gps = v?.ok && Number.isFinite(+v.lat) && Number.isFinite(+v.lng) ? { lat: +(+v.lat).toFixed(5), lng: +(+v.lng).toFixed(5) } : null;
  let photoId = null, photoBytes = null;
  if (b.photo) {
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(b.photo);
    if (!m) return json({ error: 'photo must be jpeg' }, 400);
    const bin = atob(m[1]), raw = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) raw[k] = bin.charCodeAt(k); // 一般迴圈比 Uint8Array.from(fn) 快 20 倍（Workers 免費方案 CPU 上限 10 ms）
    if (raw.length > MAX_PHOTO) return json({ error: '照片太大' }, 413);
    photoBytes = stripKeepGps(raw, gps);
    if (!photoBytes) return json({ error: 'photo must be jpeg' }, 400);
    photoId = id;
  }
  const verify = v ? { method: clip(v.method, 10), band: distBand(Number.isFinite(+v.dist) && v.dist !== null ? +v.dist : null), ok: !!v.ok, ...(gps || {}) } : null;
  let pts = 0;
  if (b.role === 'citizen') {
    const photoed = await env.DB.prepare('SELECT 1 FROM events WHERE tree_id = ? AND photo_id IS NOT NULL AND hidden = 0 LIMIT 1').bind(treeId).first();
    const days = photoed ? 0 : /^[A-Z]{2}\d{10}$/.test(treeId) ? staleDays(treeId) : -1;
    pts = POINTS.report + (photoBytes && verify?.ok ? photoPoints(days) : 0);
  }
  const at = new Date().toISOString();
  const stmts = [];
  if (photoBytes) stmts.push(env.DB.prepare('INSERT INTO photos (id, data, created) VALUES (?, ?, ?)').bind(photoId, photoBytes, at));
  stmts.push(env.DB.prepare('INSERT INTO events (id, tree_id, role, kind, nickname, note, vendor, result, at, pts, verify, photo_id, ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, treeId, b.role, clip(b.kind, 30), clip(b.nickname, 24), clip(b.note, 500), clip(b.vendor, 60), clip(b.result, 30), at, pts, verify ? JSON.stringify(verify) : null, photoId, ip));
  await env.DB.batch(stmts);
  return json(rowToEvent({ id, tree_id: treeId, role: b.role, kind: clip(b.kind, 30), nickname: clip(b.nickname, 24), note: clip(b.note, 500), vendor: clip(b.vendor, 60), result: clip(b.result, 30), at, pts, verify: verify ? JSON.stringify(verify) : null, photo_id: photoId }));
}
