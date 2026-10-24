// 工程衝突預警：畫一個工程範圍（地圖點中心＋半徑、真實道路施工案、或模擬示範施工案），列出範圍內的樹。
// 真實樹只列真實欄位；只說「範圍內」，不說會不會被移除。
const WORKS_URL = '/data/policy/road-works.json';
const SRC_TODAY = 'https://data.gov.tw/dataset/145614';
const SRC_RESERVE = 'https://data.gov.tw/dataset/145612';
const SNAP = '2026-10-23 17:05';
const BIG = 60; // 胸徑 ≥ 60 公分視為大樹候選
const KX = 100850, KY = 110900; // 台北附近 1 度經／緯約多少公尺

const st = { mode: 'point', center: null, radius: 150, work: '', wo: '', buf: 3, picking: false };
let works = null, worksP = null, grid = null, gridOf = null, lastArea = null;

// ---------- 幾何 ----------
const px = (lng, lat) => [lng * KX, lat * KY];
function buildGrid(trees) {
  if (grid && gridOf === trees) return grid;
  grid = new Map(); gridOf = trees;
  for (const t of trees) {
    const k = `${Math.floor(t.lng / 0.002)},${Math.floor(t.lat / 0.002)}`;
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(t);
  }
  return grid;
}
function treesInBox(trees, w, s, e, n) {
  const g = buildGrid(trees), out = [];
  for (let x = Math.floor(w / 0.002); x <= Math.floor(e / 0.002); x++)
    for (let y = Math.floor(s / 0.002); y <= Math.floor(n / 0.002); y++)
      for (const t of g.get(`${x},${y}`) || []) if (t.lng >= w && t.lng <= e && t.lat >= s && t.lat <= n) out.push(t);
  return out;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  let k = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  k = Math.max(0, Math.min(1, k));
  return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy);
}
function lineDist(p, line) { let d = Infinity; for (let i = 1; i < line.length; i++) d = Math.min(d, segDist(p, line[i - 1], line[i])); return line.length === 1 ? Math.hypot(p[0] - line[0][0], p[1] - line[0][1]) : d; }
function inRing(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// 把一個施工幾何轉成公尺座標並算外框（只算一次）
function prep(f) {
  if (f._p) return f._p;
  const g = f.geometry, P = (c) => px(c[0], c[1]);
  let polys = [], lines = [], pts = [];
  if (g.type === 'Polygon') polys = [g.coordinates.map((r) => r.map(P))];
  if (g.type === 'MultiPolygon') polys = g.coordinates.map((pl) => pl.map((r) => r.map(P)));
  if (g.type === 'LineString') lines = [g.coordinates.map(P)];
  if (g.type === 'MultiLineString') lines = g.coordinates.map((l) => l.map(P));
  if (g.type === 'Point') pts = [P(g.coordinates)];
  if (g.type === 'MultiPoint') pts = g.coordinates.map(P);
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => { if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); };
  walk(g.coordinates);
  return (f._p = { polys, lines, pts, bbox: [w, s, e, n] });
}
function hit(p, G, buf) {
  for (const pl of G.polys) {
    if (inRing(p, pl[0]) && !pl.slice(1).some((h) => inRing(p, h))) return true;
    if (pl.some((r) => lineDist(p, r) <= buf)) return true;
  }
  for (const l of G.lines) if (lineDist(p, l) <= buf) return true;
  for (const q of G.pts) if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= buf) return true;
  return false;
}
function treesInWork(trees, f, buf) {
  const G = prep(f), [w, s, e, n] = G.bbox, dl = buf / KX + 1e-6, dt = buf / KY + 1e-6;
  return treesInBox(trees, w - dl, s - dt, e + dl, n + dt).filter((t) => hit(px(t.lng, t.lat), G, buf));
}
function treesInCircle(trees, c, r) {
  const dl = r / KX, dt = r / KY, p = px(c[0], c[1]);
  return treesInBox(trees, c[0] - dl, c[1] - dt, c[0] + dl, c[1] + dt).filter((t) => { const q = px(t.lng, t.lat); return Math.hypot(q[0] - p[0], q[1] - p[1]) <= r; });
}
function circlePoly(c, r) {
  const ring = [];
  for (let k = 0; k <= 64; k++) { const a = (k / 64) * Math.PI * 2; ring.push([c[0] + (r * Math.cos(a)) / KX, c[1] + (r * Math.sin(a)) / KY]); }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

// ---------- 資料 ----------
async function loadWorks(ctx) {
  if (works) return works;
  worksP ||= ctx.fetchJSON(WORKS_URL).then((d) => {
    works = d.features.map((f, i) => ({ ...f, properties: { ...f.properties, _k: String(i) } }));
    return works;
  }).catch((e) => { worksP = null; throw e; });
  return worksP;
}
const kindLabel = (p) => (p.source_dataset === 'tomorrow_reservations' ? '明日預約' : '今日施工');
const workTitle = (p) => `${p.location || '（未寫地點）'}`.slice(0, 60);

// 依目前設定算出範圍與範圍內的樹
async function compute(ctx) {
  if (st.mode === 'work' && st.work !== '') {
    const ws = await loadWorks(ctx);
    const f = ws[+st.work]; if (!f) return null;
    const ts = treesInWork(ctx.trees, f, st.buf);
    return { kind: 'real', trees: ts, feature: f, area: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: f.geometry }] } };
  }
  if (st.mode === 'wo' && st.wo) {
    const o = ctx.WORK_ORDERS.find((x) => x.id === st.wo); if (!o) return null;
    const ts = treesInCircle(ctx.trees, o.center, o.radius);
    return { kind: 'sim', trees: ts, order: o, area: { type: 'FeatureCollection', features: [circlePoly(o.center, o.radius)] } };
  }
  if (st.mode === 'point' && st.center) {
    const ts = treesInCircle(ctx.trees, st.center, st.radius);
    return { kind: 'user', trees: ts, area: { type: 'FeatureCollection', features: [circlePoly(st.center, st.radius)] } };
  }
  return null;
}

function drawArea(ctx, res) {
  const m = ctx.map; if (!m || !m.getSource('ca-area')) return;
  lastArea = res ? res.area : null;
  m.getSource('ca-area').setData(res ? res.area : { type: 'FeatureCollection', features: [] });
  const big = res ? res.trees.filter((t) => t.dbh >= BIG) : [];
  m.getSource('ca-big').setData({ type: 'FeatureCollection', features: big.map((t) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [t.lng, t.lat] } })) });
}

function bounds(fc) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => { if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); };
  for (const f of fc.features) walk(f.geometry.coordinates);
  return [[w, s], [e, n]];
}

// ---------- 畫面 ----------
const STYLE = `<style>
.f-conflict-alert .ca-modes{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px}
.f-conflict-alert .ca-modes .btn.on{background:#eef4ee;border-color:var(--forest);color:var(--forest);font-weight:700}
.f-conflict-alert .ca-box{background:var(--paper);border-radius:12px;padding:12px;margin:8px 0}
.f-conflict-alert select{width:100%;padding:8px;border-radius:10px;border:1px solid var(--line);background:#fff;font-size:13px}
.f-conflict-alert .ca-scroll{max-height:340px;overflow:auto}
.f-conflict-alert .ca-meta{font-size:13px;color:var(--ink-2);margin:6px 0}
.f-conflict-alert .ca-meta b{color:var(--ink)}
</style>`;

function controls(ctx, ws) {
  const e = ctx.esc;
  const sorted = ws ? ws.map((f) => [f, f._n ?? 0]).sort((a, b) => b[1] - a[1]) : [];
  return `<div class="ca-modes" role="tablist">
      <button class="btn mini ${st.mode === 'point' ? 'on' : ''}" data-mode="point">點地圖</button>
      <button class="btn mini ${st.mode === 'work' ? 'on' : ''}" data-mode="work">真實施工案</button>
      ${ctx.WORK_ORDERS.length ? `<button class="btn mini ${st.mode === 'wo' ? 'on' : ''}" data-mode="wo">模擬施工案</button>` : ''}
    </div>
    ${st.mode === 'point' ? `<div class="ca-box">
      <div class="actions" style="margin:0 0 8px"><button class="btn primary" data-pick>去地圖點中心</button></div>
      <div class="sliders"><label>半徑（公尺） <input type="range" min="30" max="500" step="10" value="${st.radius}" data-radius><span data-rv>${st.radius}</span></label></div>
      <p class="privacy">${st.center ? `中心：${st.center[1].toFixed(5)}, ${st.center[0].toFixed(5)}` : '尚未選中心'}</p>
    </div>` : ''}
    ${st.mode === 'work' ? `<div class="ca-box">
      <p class="ca-meta">${ctx.badge('real')} 來源：工務局施工資訊（${SNAP} 快照）｜${ws ? ws.length : '…'} 案</p>
      <select data-work aria-label="選道路施工案"><option value="">選施工案</option>${sorted.map(([f, n]) => `<option value="${e(f.properties._k)}" ${st.work === f.properties._k ? 'selected' : ''}>${n} 棵｜${e(kindLabel(f.properties))}｜${e(f.properties.district || '')}｜${e(workTitle(f.properties))}</option>`).join('')}</select>
      <div class="sliders" style="margin-top:8px"><label>外擴（公尺） <input type="range" min="0" max="30" step="1" value="${st.buf}" data-buf><span data-bv>${st.buf}</span></label></div>
    </div>` : ''}
    ${st.mode === 'wo' ? `<div class="ca-box">
      <p class="ca-meta">${ctx.badge('sim')}（虛構）</p>
      <select data-wo aria-label="選示範施工案"><option value="">選模擬施工案</option>${ctx.WORK_ORDERS.map((o) => `<option value="${e(o.id)}" ${st.wo === o.id ? 'selected' : ''}>${e(o.id)}｜${e(o.name)}</option>`).join('')}</select>
    </div>` : ''}`;
}

async function results(ctx, res) {
  const e = ctx.esc;
  if (!res) return '<p class="privacy">尚未選範圍</p>';
  const ev = await ctx.getAllEvents().catch(() => []);
  const reported = new Set(ev.filter((x) => x.role === 'citizen').map((x) => x.treeId));
  const T = res.trees;
  const street = T.filter((t) => t.kind === 0).length, park = T.length - street;
  const big = T.filter((t) => t.dbh >= BIG).sort((a, b) => b.dbh - a.dbh);
  const rep = T.filter((t) => reported.has(t.id));
  const p = res.feature?.properties;
  let head = '';
  if (res.kind === 'real') head = `<div class="ca-box"><p class="ca-meta">${ctx.badge('real')} <b>${e(kindLabel(p))}</b>｜${e(p.report_type || '')}｜${e(p.district || '')}區</p>
    <p class="ca-meta">地點：${e(p.location || '')}</p>
    <p class="ca-meta">申請機關：${e(applicantLabel(p.applicant))}｜目的：${e(p.purpose || p.report_type || '—')}</p>
    <p class="ca-meta">期間：${e(p.work_date || `${p.start_date || '?'} ～ ${p.end_date || '?'}`)}${p.long_term_site === '是' ? '｜長期工區' : ''}</p>
    <p class="ca-meta">案號：${e(p.case_no || '')}｜<a href="${p.source_dataset === 'tomorrow_reservations' ? SRC_RESERVE : SRC_TODAY}" target="_blank" rel="noopener">來源</a></p></div>`;
  if (res.kind === 'sim') {
    const c = { keep: 0, move: 0, remove: 0 };
    for (const t of T) { const w = ctx.workOrderFor(t); if (w && w.order.id === res.order.id) c[w.status]++; }
    head = `<div class="ca-box"><p class="ca-meta">${ctx.badge('sim')} <b>${e(res.order.name)}</b>｜預定開工 ${e(res.order.start)}</p>
      <p class="ca-meta">處置：保留 ${c.keep}｜移植 ${c.move}｜可移除 ${c.remove}</p></div>`;
  }
  if (res.kind === 'user') head = `<p class="ca-meta">半徑 ${st.radius} 公尺｜樹籍 ${ctx.badge('real')}</p>`;
  const row = (t) => `<tr data-id="${e(t.id)}"><td>${e(t.species)}<br><small>${e(t.id)}</small></td><td>${e(t.dbh ?? '—')}</td><td>${e(t.height ?? '—')}</td><td>${e(t.place || t.dist || '')}<br><small>${t.kind === 1 ? '公園樹' : '行道樹'}</small></td><td><small>${e(t.survey || '空白')}</small></td></tr>`;
  const table = (list) => `<div class="ca-scroll"><table class="track"><thead><tr><th>樹種／編號</th><th>胸徑 cm</th><th>樹高 m</th><th>地點</th><th>調查日</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`;
  return `${head}
    <div class="facts">
      <div class="fact"><b>${T.length.toLocaleString()}</b><span>範圍內樹木（行道 ${street}／公園 ${park}）</span></div>
      <div class="fact"><b>${big.length}</b><span>大樹候選（胸徑 ≥ ${BIG} cm）</span></div>
      <div class="fact"><b>${rep.length}</b><span>民眾回報過</span></div>
    </div>
    <div class="alert ok"><p><b>建議順序</b>：避開 → 移植 → 移除</p></div>
    <p class="privacy">範圍內 ≠ 會移樹</p>
    <h3 class="h3">大樹候選 ${big.length} 棵 ${ctx.badge('real')}</h3>
    ${big.length ? table(big.slice(0, 60)) + (big.length > 60 ? `<p class="privacy">僅列前 60 棵</p>` : '') : '<p class="privacy">無</p>'}
    <h3 class="h3">民眾回報 ${rep.length} 棵 ${ctx.badge('live')}</h3>
    ${rep.length ? table(rep) : '<p class="privacy">無</p>'}
    <div class="actions"><button class="btn" data-show>地圖上看範圍</button></div>`;
}

async function renderInto(root, ctx) {
  let ws = null;
  try { ws = await loadWorks(ctx); if (ws[0] && ws[0]._n == null) for (const f of ws) f._n = treesInWork(ctx.trees, f, 3).length; } catch (e) { console.warn('conflict-alert works', e); }
  let res = null;
  try { res = await compute(ctx); } catch (e) { console.warn('conflict-alert', e); }
  drawArea(ctx, res);
  root.querySelector('[data-ca-controls]').innerHTML = controls(ctx, ws) + (st.mode === 'work' && !ws ? '<p class="privacy">施工資料載入失敗</p>' : '');
  root.querySelector('[data-ca-results]').innerHTML = await results(ctx, res);
  bind(root, ctx, res);
}

function bind(root, ctx, res) {
  const rerender = () => renderInto(root, ctx);
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.mode; rerender(); }));
  root.querySelector('[data-pick]')?.addEventListener('click', () => {
    st.picking = true;
    ctx.S.layers.conflict = true; ctx.refresh();
    ctx.go('#/');
    ctx.showToast('點地圖選中心', 5000);
  });
  const rg = root.querySelector('[data-radius]');
  rg?.addEventListener('input', () => { root.querySelector('[data-rv]').textContent = rg.value; });
  rg?.addEventListener('change', () => { st.radius = +rg.value; rerender(); });
  const bf = root.querySelector('[data-buf]');
  bf?.addEventListener('input', () => { root.querySelector('[data-bv]').textContent = bf.value; });
  bf?.addEventListener('change', () => { st.buf = +bf.value; rerender(); });
  root.querySelector('[data-work]')?.addEventListener('change', (ev) => { st.work = ev.target.value; rerender(); });
  root.querySelector('[data-wo]')?.addEventListener('change', (ev) => { st.wo = ev.target.value; rerender(); });
  root.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => ctx.go(`#/tree/${tr.dataset.id}`)));
  root.querySelector('[data-show]')?.addEventListener('click', () => {
    ctx.S.layers.conflict = true; ctx.refresh();
    if (res) ctx.map.fitBounds(bounds(res.area), { padding: 60, maxZoom: 17, duration: 800 });
    ctx.go('#/');
  });
}

const EMPTY = { type: 'FeatureCollection', features: [] };

export default {
  id: 'conflict-alert',
  title: '工程衝突預警',
  oneLiner: '施工範圍內有哪些大樹',
  audience: ['gov', 'mayor'],
  dataStatus: ['real', 'sim', 'live'],
  maturity: 'exp',
  ready: true,
  demoValue: '拿工務局今天真實的施工範圍一套，就看到範圍內有幾棵大樹',
  problem: '東門茄苳這類事件，問題常在施工前沒人把「工程範圍」和「樹籍」對在一起；等到現場才發現，大樹已經來不及保留。',
  howto: '選「地圖點一下」設中心和半徑，或選一個真實道路施工案、示範施工案；下面會列出範圍內樹木數、胸徑 60 公分以上的大樹候選、民眾回報過的樹。打開「工程範圍」圖層可在地圖上看範圍。',
  limits: '道路施工資料是 2026-10-23 17:05 的一次快照，只有已核准、正在施工或明天預約的案件，沒有設計階段的工程；範圍是許可範圍，不是實際開挖點；挖掘案沒有寬度，外擴公尺數是本站自訂。樹木資料不含校園與私有地。示範施工案與其逐樹處置都是模擬。「範圍內」不代表會移樹。',
  rollout: {
    agencies: '工務局（新工處道管中心、公園處）、各工程主辦機關',
    data: '請工務局把「預定施工路段」連同路段幾何開成開放資料；挖掘許可申請表加「範圍內樹籍編號」欄位',
    budget: '情境試算：用既有開放資料與本站程式，主要是串接與維運人力',
    promo: '寫進工程設計審查與挖掘許可流程；里長收到施工通報時一併附範圍內樹木清單',
  },
  sources: [
    { label: '臺北市 今日施工資訊（工務局，政府資料開放授權條款第 1 版）', url: SRC_TODAY, date: '2026-10-23 17:05 快照' },
    { label: '臺北市明日道路施工預約資訊（工務局，政府資料開放授權條款第 1 版）', url: SRC_RESERVE, date: '2026-10-23 17:05 快照' },
    { label: '臺北市行道樹及公園樹木分布圖', url: 'https://data.gov.tw/dataset/128274', date: '2026-10-13 下載' },
  ],
  chipDefs: { conflict: { label: '工程範圍', dot: '#7a5bb5' } },
  chips: ['conflict'],

  async page(ctx) {
    return `${STYLE}<div class="f-conflict-alert"><div data-ca-controls>載入中…</div><div data-ca-results></div></div>`;
  },
  bindPage(root, ctx) { renderInto(root, ctx); },

  async onTree(ctx, tree) {
    if (tree.lng == null) return '';
    let ws = [];
    try { ws = await loadWorks(ctx); } catch { return ''; }
    const p = px(tree.lng, tree.lat), near = [];
    for (const f of ws) {
      const G = prep(f), [w, s, e, n] = G.bbox, pad = 20 / KX;
      if (tree.lng < w - pad || tree.lng > e + pad || tree.lat < s - pad || tree.lat > n + pad) continue;
      if (hit(p, G, 10)) near.push(f.properties);
    }
    const wo = ctx.workOrderFor(tree);
    if (!near.length && !wo) return '';
    const e = ctx.esc;
    return `${near.length ? `<p class="privacy">10 公尺內有 ${near.length} 件施工許可 ${ctx.badge('real')}（≠ 會移樹）</p>
      <ul class="list dist">${near.slice(0, 5).map((q) => `<li><span>${e(kindLabel(q))}｜${e(applicantLabel(q.applicant))}｜${e(workTitle(q))}</span></li>`).join('')}</ul>` : ''}
      ${wo ? `<p class="privacy">在「${e(wo.order.name)}」範圍內 ${ctx.badge('sim')}</p>` : ''}
      <div class="actions"><button class="btn mini" data-ca-go>看工程衝突</button></div>`;
  },
  bindTree(root, ctx, tree) {
    root?.querySelector('[data-ca-go]')?.addEventListener('click', () => {
      const wo = ctx.workOrderFor(tree);
      if (wo) { st.mode = 'wo'; st.wo = wo.order.id; } else { st.mode = 'point'; st.center = [tree.lng, tree.lat]; }
      ctx.go('#/f/conflict-alert');
    });
  },

  async init(ctx) {
    const m = ctx.map;
    m.addSource('ca-works', { type: 'geojson', data: EMPTY });
    m.addSource('ca-area', { type: 'geojson', data: EMPTY });
    m.addSource('ca-big', { type: 'geojson', data: EMPTY });
    const before = m.getLayer('trees-park') ? 'trees-park' : undefined;
    const hide = { visibility: 'none' };
    m.addLayer({ id: 'ca-works-fill', type: 'fill', source: 'ca-works', filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false], layout: hide, paint: { 'fill-color': '#7a5bb5', 'fill-opacity': 0.12 } }, before);
    m.addLayer({ id: 'ca-works-line', type: 'line', source: 'ca-works', layout: hide, paint: { 'line-color': '#7a5bb5', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 17, 3], 'line-opacity': 0.8 } }, before);
    m.addLayer({ id: 'ca-works-pt', type: 'circle', source: 'ca-works', filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false], layout: hide, paint: { 'circle-color': '#7a5bb5', 'circle-radius': 4, 'circle-opacity': 0.7 } }, before);
    m.addLayer({ id: 'ca-area-fill', type: 'fill', source: 'ca-area', layout: hide, paint: { 'fill-color': '#e07a1f', 'fill-opacity': 0.12 } }, before);
    m.addLayer({ id: 'ca-area-line', type: 'line', source: 'ca-area', layout: hide, paint: { 'line-color': '#e07a1f', 'line-width': 3 } });
    m.addLayer({ id: 'ca-big', type: 'circle', source: 'ca-big', layout: hide, paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 17, 11], 'circle-stroke-color': '#c2362b', 'circle-stroke-width': 2.5 } });
    loadWorks(ctx).then((ws) => m.getSource('ca-works')?.setData({ type: 'FeatureCollection', features: ws })).catch((e) => console.warn('conflict-alert works', e));
    // 選工程中心：只在按了「到地圖上點工程中心」之後的下一次點擊生效
    m.on('click', (ev) => {
      if (!st.picking) return;
      st.picking = false; st.mode = 'point'; st.center = [ev.lngLat.lng, ev.lngLat.lat];
      ctx.S.__caPickAt = Date.now();
      setTimeout(() => ctx.go('#/f/conflict-alert'), 0);
    });
  },
  apply(ctx, layers, on) {
    const m = ctx.map; if (!m || !m.getLayer('ca-area-line')) return;
    const v = on && layers.conflict ? 'visible' : 'none';
    for (const id of ['ca-works-fill', 'ca-works-line', 'ca-works-pt', 'ca-area-fill', 'ca-area-line', 'ca-big']) m.setLayoutProperty(id, 'visibility', v);
    if (!on) st.picking = false;
  },
};
