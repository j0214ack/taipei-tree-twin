// 樹冠負債模型（推估＋模擬）。參數全部讀 /data/policy/planting-params.json
// （複製自 data/derived/policy/planting-params.json，2026-10-23 決策功能資料準備 thread 產出；
//  來源、下載時間與處理步驟見同目錄 planting-params.manifest.json、research/18b-planting-params.md）。
// 模型設計（research/18b 第三節）：
//   被移除的樹：W0 = a·D^b（樹種別，臺中開放資料自行擬合，低信心），A0 = π/4·W0²
//   新苗：胸徑 D(t) 從苗木米徑起算，建立期內不長；之後茄苳／樟樹／楓香用台北實測 RGR 式 ΔD = a·D^(1+b)，其他樹種用固定年增量
//         冠幅 W(t) = 苗木冠幅 + max(0, f(D(t)) − f(d0))（差值法：苗圃苗比同胸徑的行道樹窄）
//   存活：期望值逐年乘 s；還清條件 N·s^t·A(t) ≥ A0
// 這個組合是推測（模型設計），不是文獻公式；畫面一律標推估／模擬。

let P = null;
let loading = null;

export const NONEW = /^(榕樹|橡膠樹|印度橡膠樹|菩提樹|盾柱木|木棉|黑板樹)$|刺桐/; // 公園處缺株補植改種他種的 7 類（2026-05-21 頁面，18c 核對）

export async function loadParams(ctx) {
  if (P) return P;
  if (!loading) loading = (async () => {
    const d = await ctx.fetchJSON('/data/policy/planting-params.json');
    const prm = d.defaults_for_site.params;
    const allo = {};
    for (const [k, v] of Object.entries(prm.crown_allometry.default_by_species)) allo[k] = { a: v.a, b: v.b };
    const fb = prm.crown_allometry.fallback;
    const fit = {}; const rgr = {}; const inv = {};
    let pooled = null;
    for (const s of d.species_growth) {
      const p = s.params || {};
      if (p.rgr_a != null) rgr[s.species_zh] = { a: p.rgr_a, b: p.rgr_b, mean: p.mean_cm_per_yr, n: s.sample_n };
      if (p.clean && p.clean.dbh_p05 != null) {
        if (s.species_zh.includes('全樹種')) pooled = { a: p.clean.a, b: p.clean.b, lo: p.clean.dbh_p05, hi: p.clean.dbh_p95 };
        else fit[s.species_zh] = { lo: p.clean.dbh_p05, hi: p.clean.dbh_p95, r2: p.clean.r2 };
      }
      if (s.taipei_inventory_dbh && !inv[s.species_zh]) inv[s.species_zh] = s.taipei_inventory_dbh;
    }
    P = {
      raw: d, prm, allo, fallback: { a: fb.a, b: fb.b }, pooled: pooled || { a: fb.a, b: fb.b, lo: 5.1, hi: 52.9 }, fit, rgr, inv,
      notRec: prm.crown_allometry.not_recommended || [],
      errorNote: d.defaults_for_site.error_note,
      examples: d.defaults_for_site.worked_examples || [],
    };
    return P;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
export const params = () => P;

// ---------- 可調假設 ----------
export function defaults() {
  const p = P.prm;
  return {
    d0: p.nursery_caliper_cm.default, // 苗木米徑（cm）
    wn: p.nursery_crown_width_m.default, // 苗木冠幅（m）
    lag: p.establishment_lag_years.default, // 建立期（年）
    g: 0.8, // 其他樹種胸徑年增量（cm／年）
    rgr: true, // 茄苳／樟樹／楓香用台北實測式
    s: p.annual_survival.default, // 年存活率
    T: p.target_years.default, // 目標年數
    sp: 'auto', // 補種樹種
    cap: 0, // 新樹樹冠上限（m²，0＝不設）
  };
}
export const RANGES = () => {
  const p = P.prm;
  return {
    d0: [...p.nursery_caliper_cm.range, 0.5], wn: [...p.nursery_crown_width_m.range, 0.05], lag: [...p.establishment_lag_years.range, 0.2],
    g: [...p.dbh_growth_cm_per_yr.range, 0.05], s: [p.annual_survival.range[0], 1, 0.01], T: [...p.target_years.range, 1],
  };
};
const KEY = 'canopy-debt.params.v1';
export function loadUserParams(store) {
  const d = defaults();
  const u = store.get(KEY, null);
  if (!u || typeof u !== 'object') return d;
  const r = RANGES();
  const out = { ...d };
  for (const k of Object.keys(d)) {
    if (u[k] == null) continue;
    if (r[k]) { const v = +u[k]; if (Number.isFinite(v)) out[k] = Math.min(r[k][1], Math.max(r[k][0], v)); }
    else if (k === 'rgr') out.rgr = !!u.rgr;
    else if (k === 'sp' && typeof u.sp === 'string') out.sp = u.sp;
    else if (k === 'cap' && [0, 16, 25, 36].includes(+u.cap)) out.cap = +u.cap;
  }
  return out;
}
export const saveUserParams = (store, q) => store.set(KEY, q);

// ---------- 被移除的樹 ----------
export const dbhValid = (d) => Number.isFinite(d) && d > 0 && d <= 300;
export function alloFor(species) {
  if (P.allo[species]) return { ...P.allo[species], src: 'species' };
  return { ...P.fallback, src: 'fallback' };
}
export const crownW = (species, dbh) => { const c = alloFor(species); return c.a * dbh ** c.b; };
export const areaOf = (w) => (Math.PI / 4) * w * w;
export function removed(species, dbh) {
  const c = alloFor(species);
  const W = c.a * dbh ** c.b;
  const A = areaOf(W);
  const fit = c.src === 'species' ? P.fit[species] : P.pooled;
  const extrap = fit ? dbh < fit.lo || dbh > fit.hi : false;
  return { W, A, lo: A * 0.64, hi: A * 1.44, allo: c, fit, extrap };
}

// ---------- 新苗 ----------
export const SAPLING_SPECIES = ['茄苳', '樟樹', '楓香', '臺灣欒樹', '小葉欖仁'];
export function saplingSpecies(q, removedSpecies) {
  if (q.sp && q.sp !== 'auto') return q.sp === 'pooled' ? null : q.sp;
  if (SAPLING_SPECIES.includes(removedSpecies) && !NONEW.test(removedSpecies)) return removedSpecies;
  return null; // 樹種未定：用合併式
}
// variant: 'offset'（預設差值法）／'direct'（直接套冠幅式，最樂觀）／'pooled'（改用合併式）
const curveCache = new Map();
const STEP = 0.1, MAXY = 200;
export function curve(q, sp, variant = 'offset') {
  const key = JSON.stringify([q.d0, q.wn, q.lag, q.g, q.rgr, q.cap, sp, variant]);
  if (curveCache.has(key)) return curveCache.get(key);
  const f = variant === 'pooled' || !sp ? P.pooled : alloFor(sp);
  const fd = (D) => f.a * D ** f.b;
  const r = sp && q.rgr ? P.rgr[sp] : null;
  const n = Math.round(MAXY / STEP);
  const D = new Float64Array(n + 1), A = new Float64Array(n + 1);
  let d = q.d0;
  for (let i = 0; i <= n; i++) {
    const t = i * STEP;
    D[i] = d;
    let W = variant === 'direct' ? fd(d) : q.wn + Math.max(0, fd(d) - fd(q.d0));
    let a = areaOf(W);
    if (q.cap) a = Math.min(a, q.cap);
    A[i] = a;
    if (t + STEP > q.lag) {
      const inc = r ? r.a * Math.max(d, 5) ** (1 + r.b) : q.g;
      d += inc * STEP;
    }
  }
  const out = { D, A, at: (t) => { const i = Math.min(n, Math.max(0, Math.round(t / STEP))); return { D: D[i], A: A[i] }; }, rgr: !!r, f };
  if (curveCache.size > 200) curveCache.clear();
  curveCache.set(key, out);
  return out;
}
// T 年內追平要種幾棵（期望值）
export function needN(A0, q, sp, variant = 'offset', s = q.s) {
  const c = curve(q, sp, variant).at(q.T);
  const per = c.A * s ** q.T;
  return per > 0 ? Math.ceil(A0 / per - 1e-9) : Infinity;
}
// 換假設後的區間（research/18b 的敏感度做法：直接套式、合併式、存活率 0.97、不算死亡）
export function needRange(A0, q, sp) {
  const vals = [needN(A0, q, sp), needN(A0, q, sp, 'direct'), needN(A0, q, sp, 'pooled'), needN(A0, q, sp, 'offset', Math.max(q.s, 0.97)), needN(A0, q, sp, 'offset', 1)];
  return [Math.min(...vals), Math.max(...vals)];
}
// 一棵換一棵：新苗活著的話幾年長回原樹冠；算死亡率的期望值是否追得上
export function oneToOne(A0, q, sp) {
  const c = curve(q, sp);
  let alive = null, expect = null;
  for (let i = 0; i < c.A.length; i++) {
    const t = i * STEP;
    if (alive == null && c.A[i] >= A0) alive = t;
    if (expect == null && c.A[i] * q.s ** t >= A0) expect = t;
    if (alive != null && expect != null) break;
  }
  return { alive, expect, max: MAXY };
}
// N 棵的期望總樹冠
export const totalAt = (N, q, sp, t) => N * curve(q, sp).at(t).A * q.s ** t;
// 到第 T 年為止的樹蔭缺口累計（平方公尺·年）
export function gapArea(A0, N, q, sp) {
  let sum = 0;
  for (let t = 0; t < q.T; t += STEP) sum += Math.max(0, A0 - totalAt(N, q, sp, t)) * STEP;
  return sum;
}
