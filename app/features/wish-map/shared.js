// 許願種樹共用：樹種、儲存鍵、上傳與讀取（許願頁 app/wish/ 與許願地圖模組共用）。
// 後端：POST/GET /api/wishes（Pages Functions＋D1，存在 events 表 role='wish'）；沒有後端就退回 localStorage 並標「模擬」。

// 依公園處行道樹建議樹種挑六種；不收「不再新植」的黑板樹、木棉、橡膠樹、菩提樹、盾柱木、刺桐類
export const SPECIES = [
  { id: 'luan', name: '臺灣欒樹', color: '#e8a33a', leaf: '#7fae3c', note: '秋天會變色' },
  { id: 'jiadong', name: '茄苳', color: '#4f8f3a', leaf: '#3f8a3a', note: '東門市場那棵就是茄苳' },
  { id: 'zhang', name: '樟樹', color: '#5f9e4a', leaf: '#4c9a44', note: '四季常綠' },
  { id: 'guangla', name: '光蠟樹', color: '#8cbf4a', leaf: '#8cc04c', note: '葉子透光' },
  { id: 'shanlan', name: '大葉山欖', color: '#2f7a4a', leaf: '#2f7d4c', note: '抗風耐鹽' },
  { id: 'shuihuang', name: '水黃皮', color: '#9a7fd1', leaf: '#5ea84a', note: '春天開紫花' },
];
export const speciesById = (id) => SPECIES.find((s) => s.id === id) || SPECIES[0];

export const DEFAULT_LOC = { lat: 25.0347, lng: 121.527 }; // 東門市場一帶
export const WISH_POINTS = 30;
export const GOAL = 12; // 同一格許願人數達到這個數，就出現「許願成真」進度條的滿格
export const CELL_M = 100; // 格網邊長（公尺）
export const NEAR_M = 30; // 推薦種樹點在許願點多近內算「可種」

// localStorage：tt.wishes（本機許願）、tt.points（和收集頁共用，JSON 數字）
const LS = (k) => 'tt.' + k;
export function lsGet(k, d) { try { const v = localStorage.getItem(LS(k)); return v == null ? d : JSON.parse(v); } catch { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(LS(k), JSON.stringify(v)); return true; } catch { return false; } }
export function addPoints(n) { const p = Number(lsGet('points', 0)); const v = (Number.isFinite(p) ? p : 0) + n; lsSet('points', v); return v; }

// 一筆許願：{ id, lat, lng, species, defaultLoc, at, photo, src: 'live'|'local' }
// base：主站根目錄的相對或絕對前綴，許願頁傳 '../'，主站模組傳 '/'
export async function postWish(base, w) {
  try {
    const r = await fetch(base + 'api/wishes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(w) });
    if (!r.ok) throw new Error('http ' + r.status);
    const ev = await r.json();
    return { ...ev, src: 'live' };
  } catch {
    // 沒有後端：存本機，照片縮小存，最多留 20 筆
    const ev = { id: 'local-' + Date.now().toString(36), lat: +(+w.lat).toFixed(4), lng: +(+w.lng).toFixed(4), species: w.species, defaultLoc: !!w.defaultLoc, at: new Date().toISOString(), pts: WISH_POINTS, photo: w.thumb || null, src: 'local' };
    const list = lsGet('wishes', []);
    list.push(ev);
    while (list.length > 20) list.shift();
    if (!lsSet('wishes', list)) { for (const x of list) x.photo = null; lsSet('wishes', list); }
    return ev;
  }
}

export async function getWishes(base) {
  let live = [];
  try {
    const r = await fetch(base + 'api/wishes');
    if (r.ok) live = (await r.json()).map((w) => ({ ...w, src: 'live' }));
  } catch {}
  const local = lsGet('wishes', []).map((w) => ({ ...w, src: 'local' }));
  // 用預設位置（拿不到定位）送出的許願不畫上地圖
  return [...live, ...local].filter((w) => !w.defaultLoc);
}
