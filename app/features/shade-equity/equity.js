// 樹蔭公平排行的計算核心（首長儀表板也會用）。
// 公平優先分＝（缺蔭權重×缺蔭百分位＋兒童權重×兒童百分位＋長者權重×長者百分位）÷ 權重總和，0–100，越高越該先補。
// 百分位：在同一層級（全部里或全部區）裡排第幾，0＝最好、100＝最需要。

// 缺蔭代理指標：樹越少＝越缺蔭。全部都是「登錄樹木密度」，不是樹冠覆蓋或實際遮蔭。
export const PROXIES = {
  sw_km: { label: '每公里人行道行道樹', short: '行道樹／人行道公里', unit: '株／km', dist: true, vil: false, val: (u) => u.perKm },
  st_km2: { label: '每 km² 行道樹', short: '行道樹／km²', unit: '株／km²', dist: true, vil: true, val: (u) => u.st / u.a },
  all_km2: { label: '每 km² 登錄樹木', short: '登錄樹木／km²', unit: '株／km²', dist: true, vil: true, val: (u) => (u.st + u.pt) / u.a },
  all_1k: { label: '每千人登錄樹木', short: '登錄樹木／千人', unit: '株／千人', dist: true, vil: true, val: (u) => ((u.st + u.pt) / u.p) * 1000 },
};
export const MODES = {
  share: { label: '人口占比', fmt: (n, p) => `${((n / p) * 100).toFixed(1)}%` },
  dens: { label: '每 km² 人數', fmt: (n, p, a) => `${Math.round(n / a).toLocaleString()}／km²` },
};
export const DEFAULTS = { level: 'village', proxyV: 'all_km2', proxyD: 'sw_km', mode: 'share', w: { gap: 50, kid: 25, old: 25 }, minDens: true };
export const MIN_DENS = 2000; // 人／km²：低於這個的里多為山區或大型綠地，登錄樹木被低估

export function settings(ctx) {
  const s = ctx.store.get('equity', null) || {};
  return { ...DEFAULTS, ...s, w: { ...DEFAULTS.w, ...(s.w || {}) } };
}
export const saveSettings = (ctx, s) => ctx.store.set('equity', s);

// ---------- 資料 ----------
let cache = null;
export async function loadEquity(ctx) {
  if (cache) return cache;
  cache = (async () => {
    const [vg, dj, ds] = await Promise.all([
      ctx.fetchJSON('/data/policy/villages-equity.geojson'),
      ctx.fetchJSON('/data/policy/districts-equity.json'),
      ctx.fetchJSON('/data/district-stats.json'),
    ]);
    const perKm = new Map(ds.rows.map((r) => [r.dist, r]));
    const villages = vg.features.map((f, i) => ({ ...f.properties, i, name: `${f.properties.d}${f.properties.v}`, bbox: bboxOf(f.geometry) }));
    const districts = dj.rows.map((r) => ({ ...r, name: r.d, perKm: perKm.get(r.d)?.per_km ?? null, swKm: perKm.get(r.d)?.sidewalk_km ?? null }));
    // 區的範圍＝所屬里的範圍聯集
    for (const d of districts) {
      const vs = villages.filter((v) => v.d === d.d);
      d.bbox = vs.reduce((b, v) => [Math.min(b[0], v.bbox[0]), Math.min(b[1], v.bbox[1]), Math.max(b[2], v.bbox[2]), Math.max(b[3], v.bbox[3])], [180, 90, -180, -90]);
    }
    return { vg, villages, districts, period: dj.period || vg.period };
  })();
  try { return await cache; } catch (e) { cache = null; throw e; }
}

function bboxOf(g) {
  const b = [180, 90, -180, -90];
  const walk = (c) => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
  walk(g.coordinates);
  return b;
}

// ---------- 計算 ----------
// 百分位（平手取平均名次）：0＝最小、100＝最大
function pct(vals) {
  const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
  const out = new Array(vals.length);
  const n = vals.length;
  for (let r = 0; r < n;) {
    let e = r;
    while (e + 1 < n && vals[idx[e + 1]] === vals[idx[r]]) e++;
    const p = n > 1 ? (((r + e) / 2) / (n - 1)) * 100 : 50;
    for (let k = r; k <= e; k++) out[idx[k]] = p;
    r = e + 1;
  }
  return out;
}

// 回傳排序好的列：{ unit, proxy, gapP, kidP, oldP, score, rank }；被排除的里另放 excluded
export function compute(data, s) {
  const level = s.level === 'district' ? 'district' : 'village';
  const units = level === 'district' ? data.districts : data.villages;
  const pk = level === 'district' ? s.proxyD : s.proxyV;
  const P = PROXIES[pk] && (level === 'district' ? PROXIES[pk].dist : PROXIES[pk].vil) ? PROXIES[pk] : PROXIES[level === 'district' ? DEFAULTS.proxyD : DEFAULTS.proxyV];
  const keep = [], excluded = [];
  for (const u of units) {
    const v = P.val(u);
    if (!(u.p > 0) || !Number.isFinite(v) || (level === 'village' && s.minDens && u.p / u.a < MIN_DENS)) excluded.push(u); else keep.push({ u, proxy: v });
  }
  const m = (n, u) => (s.mode === 'dens' ? n / u.a : n / u.p);
  const gapP = pct(keep.map((r) => -r.proxy));
  const kidP = pct(keep.map((r) => m(r.u.k, r.u)));
  const oldP = pct(keep.map((r) => m(r.u.e, r.u)));
  const W = s.w, sum = W.gap + W.kid + W.old || 1;
  keep.forEach((r, i) => {
    r.gapP = gapP[i]; r.kidP = kidP[i]; r.oldP = oldP[i];
    r.score = (W.gap * r.gapP + W.kid * r.kidP + W.old * r.oldP) / sum;
  });
  keep.sort((a, b) => b.score - a.score || a.proxy - b.proxy);
  keep.forEach((r, i) => { r.rank = i + 1; });
  return { level, proxyKey: Object.keys(PROXIES).find((k) => PROXIES[k] === P), proxy: P, rows: keep, excluded };
}

// 首長儀表板用：區級、預設設定（每公里人行道行道樹＋兒童長者占比，權重 50/25/25）
export async function topDistricts(ctx, n = 3) {
  const data = await loadEquity(ctx);
  return compute(data, { ...DEFAULTS, level: 'district' }).rows.slice(0, n);
}

// 面量圖顏色（0–100 分五級）；被排除的里灰色
export const CLASSES = [
  [0, '#fef0d9', '0–20'],
  [20, '#fdcc8a', '20–40'],
  [40, '#fc8d59', '40–60'],
  [60, '#e34a33', '60–80'],
  [80, '#a3141f', '80–100'],
];
