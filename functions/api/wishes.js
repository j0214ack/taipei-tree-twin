// 許願種樹：沿用 events／photos 表，不改表結構。role='wish'、tree_id='WISH'、kind=樹種 id、
// note 存 {lat,lng,def}（座標只留小數 4 位，約 10 公尺）。不收任何個資。
import { json, stripJpegMeta, ipHash } from '../_lib/common.js';

const SPECIES = ['luan', 'jiadong', 'zhang', 'guangla', 'shanlan', 'shuihuang'];
const WISH_POINTS = 30;
const MAX_PHOTO = 600 * 1024;
const MAX_WISHES = 5000;
const inTaipei = (lat, lng) => lat > 24.95 && lat < 25.22 && lng > 121.45 && lng < 121.67;

const toWish = (r) => {
  let n = {}; try { n = JSON.parse(r.note || '{}'); } catch {}
  return { id: r.id, lat: n.lat, lng: n.lng, species: r.kind, defaultLoc: !!n.def, at: r.at, pts: r.pts, photo: r.photo_id ? `/photos/${r.photo_id}.jpg` : null };
};

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare("SELECT * FROM events WHERE role = 'wish' AND hidden = 0 ORDER BY at DESC LIMIT 2000").all();
  // 拿不到定位、用預設位置送出的許願不畫上地圖（不是真的想種在那裡）
  return json(results.map(toWish).filter((w) => !w.defaultLoc));
}

export async function onRequestPost({ request, env }) {
  try {
    let b;
    try { b = await request.json(); } catch { return json({ error: 'bad body' }, 400); }
    const lat = +(+b?.lat).toFixed(4), lng = +(+b?.lng).toFixed(4);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inTaipei(lat, lng)) return json({ error: '不在台北市範圍' }, 400);
    if (!SPECIES.includes(b.species)) return json({ error: 'unknown species' }, 400);
    const ip = await ipHash(request, env.IP_SALT);
    const since = new Date(Date.now() - 60000).toISOString();
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE ip = ? AND at > ?').bind(ip, since).first();
    if (recent.n >= 10) return json({ error: '送太快了，請稍後再試' }, 429);
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE role = 'wish'").first();
    if (total.n >= MAX_WISHES) return json({ error: 'demo 儲存空間已滿' }, 507);

    const id = crypto.randomUUID();
    let photoBytes = null;
    if (b.photo) {
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(b.photo);
      if (!m) return json({ error: 'photo must be jpeg' }, 400);
      const raw = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
      if (raw.length > MAX_PHOTO) return json({ error: '照片太大' }, 413);
      photoBytes = stripJpegMeta(raw);
      if (!photoBytes) return json({ error: 'photo must be jpeg' }, 400);
    }
    const at = new Date().toISOString();
    const note = JSON.stringify({ lat, lng, def: !!b.defaultLoc });
    const stmts = [];
    if (photoBytes) stmts.push(env.DB.prepare('INSERT INTO photos (id, data, created) VALUES (?, ?, ?)').bind(id, photoBytes, at));
    stmts.push(env.DB.prepare('INSERT INTO events (id, tree_id, role, kind, note, at, pts, photo_id, ip) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, 'WISH', 'wish', b.species, note, at, WISH_POINTS, photoBytes ? id : null, ip));
    await env.DB.batch(stmts);
    return json(toWish({ id, kind: b.species, note, at, pts: WISH_POINTS, photo_id: photoBytes ? id : null }));
  } catch (e) { console.error(e); return json({ error: 'server error' }, 500); }
}
