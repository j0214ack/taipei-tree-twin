// 民眾許願地圖：許願點（模擬＋真實上傳）依 100 m 方格聚合，和推薦種樹點交叉看「可種」或「需會勘」。
import { SPECIES, GOAL, CELL_M, NEAR_M, getWishes, speciesById } from './shared.js';
import { simWishes } from './sim-wishes.js';

const KX = 100850, KY = 110900;
const TIER = ['寬度待查', '改放移動植栽', '小喬木', '可種喬木']; // 依人行道寬：無資料／<2／2–3.5／>3.5 m
const tierOf = (w) => (w == null ? 0 : w < 2 ? 1 : w <= 3.5 ? 2 : 3);
const WISH_URL = '/treemulation/wish/';
const okBadge = (c) => `<span class="badge" style="background:${c.ok ? '#e3f1df;color:#1b5e2b' : '#ececec;color:#555;border:1px dashed #999'}">${c.ok ? '可種' : '需會勘'}</span>`;
const SRC_OK = /^(data:image\/|https?:|\/)/;

let dataP = null, dataAt = 0, lastData = null;

async function compute(ctx) {
  const [live, plant] = await Promise.all([getWishes('/').catch(() => []), ctx.loadPlant().catch(() => null)]);
  const real = live.filter((w) => Number.isFinite(+w.lat) && Number.isFinite(+w.lng)).map((w) => ({ ...w, lat: +w.lat, lng: +w.lng }));
  const all = [...simWishes(), ...real];

  // 只取許願範圍外擴 100 m 的推薦點，丟進 NEAR_M 小格雜湊
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const w of all) { x0 = Math.min(x0, w.lng); x1 = Math.max(x1, w.lng); y0 = Math.min(y0, w.lat); y1 = Math.max(y1, w.lat); }
  const pad = (m, k) => m / k;
  x0 -= pad(100, KX); x1 += pad(100, KX); y0 -= pad(100, KY); y1 += pad(100, KY);
  const inBox = (lng, lat) => lng >= x0 && lng <= x1 && lat >= y0 && lat <= y1;
  const pts = (plant?.features || []).filter((f) => inBox(f.geometry.coordinates[0], f.geometry.coordinates[1]))
    .map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], tier: tierOf(f.properties.sw_width), road: f.properties.road || '' }));
  const hash = new Map();
  const hk = (lng, lat) => `${Math.floor((lng * KX) / NEAR_M)},${Math.floor((lat * KY) / NEAR_M)}`;
  for (const p of pts) { const k = hk(p.lng, p.lat); (hash.get(k) || hash.set(k, []).get(k)).push(p); }
  const near = (w) => {
    const gx = Math.floor((w.lng * KX) / NEAR_M), gy = Math.floor((w.lat * KY) / NEAR_M), out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const p of hash.get(`${gx + dx},${gy + dy}`) || []) {
      if (Math.hypot((p.lng - w.lng) * KX, (p.lat - w.lat) * KY) <= NEAR_M) out.push(p);
    }
    return out;
  };

  // 100 m 方格聚合
  const cells = new Map();
  for (const w of all) {
    const cx = Math.floor((w.lng * KX) / CELL_M), cy = Math.floor((w.lat * KY) / CELL_M), k = `${cx},${cy}`;
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { k, cx, cy, n: 0, live: 0, photos: 0, sp: {}, tier: -1 }));
    c.n++;
    if (w.src !== 'sim') c.live++;
    if (w.photo) c.photos++;
    c.sp[w.species] = (c.sp[w.species] || 0) + 1;
    for (const p of near(w)) c.tier = Math.max(c.tier, p.tier);
  }

  // 格子命名用：範圍內的樹（先切 bbox 再找最近）
  const trees = ctx.trees.filter((t) => t.place && inBox(t.lng, t.lat));
  const nameOf = (lng, lat) => {
    let best = null, bd = 120;
    for (const p of pts) { if (!p.road) continue; const d = Math.hypot((p.lng - lng) * KX, (p.lat - lat) * KY); if (d < bd) { bd = d; best = p.road; } }
    if (best) return best;
    bd = 120;
    for (const t of trees) { const d = Math.hypot((t.lng - lng) * KX, (t.lat - lat) * KY); if (d < bd) { bd = d; best = t.place; } }
    return best || '未命名路段';
  };

  const list = [...cells.values()].map((c) => {
    const top = Object.entries(c.sp).sort((a, b) => b[1] - a[1])[0][0];
    const lng = ((c.cx + 0.5) * CELL_M) / KX, lat = ((c.cy + 0.5) * CELL_M) / KY;
    const ok = c.tier >= 0;
    return { ...c, lng, lat, top: speciesById(top).name, ok, label: ok ? TIER[c.tier] : '需會勘' };
  }).sort((a, b) => b.n - a.n || b.live - a.live);
  for (const c of list.slice(0, 20)) c.name = nameOf(c.lng, c.lat);
  return { all, real, cells: list, nPlant: pts.length };
}

async function getData(ctx, fresh = false) {
  if (!dataP || fresh || Date.now() - dataAt > 30000) {
    dataAt = Date.now();
    dataP = compute(ctx).then((d) => (lastData = d));
  }
  return dataP;
}

function cellPoly(c) {
  const a = (c.cx * CELL_M) / KX, b = ((c.cx + 1) * CELL_M) / KX, s = (c.cy * CELL_M) / KY, n = ((c.cy + 1) * CELL_M) / KY;
  return [[[a, s], [b, s], [b, n], [a, n], [a, s]]];
}
const gjPoints = (d) => ({ type: 'FeatureCollection', features: d.all.map((w) => ({ type: 'Feature', properties: { src: w.src === 'sim' ? 'sim' : 'live' }, geometry: { type: 'Point', coordinates: [w.lng, w.lat] } })) });
const gjCells = (d) => ({ type: 'FeatureCollection', features: d.cells.map((c) => ({ type: 'Feature', properties: { k: c.k, n: c.n, ok: c.ok ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: cellPoly(c) } })) });

function popupHtml(ctx, c) {
  const e = ctx.esc, done = c.n >= GOAL;
  return `<div style="font:13px/1.5 'Noto Sans TC',sans-serif;min-width:190px">
    <b style="font-size:15px">${c.n} 人許願</b>${c.live ? ` ${ctx.badge('live')}` : ''} ${ctx.badge('sim')}<br>
    最多人選 <b>${e(c.top)}</b>・${c.photos} 張照片<br>
    ${okBadge(c)} ${c.ok ? e(c.label) : ''}
    <div style="margin-top:6px">${ctx.bar(Math.min(c.n, GOAL), GOAL, done ? '#1b7837' : '#5aae61')}</div>
    <small>${done ? '<b style="color:#1b7837">許願成真</b>' : `${c.n}／${GOAL} 人`}</small>
    <div style="margin-top:6px"><a class="btn mini primary" href="${WISH_URL}">去許願</a></div>
  </div>`;
}

let popup = null;
function openPopup(ctx, c) {
  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: '260px' }).setLngLat([c.lng, c.lat]).setHTML(popupHtml(ctx, c)).addTo(ctx.map);
}

const STYLE = `<style>
.f-wish-map .facts{grid-template-columns:1fr 1fr}
.f-wish-map .wm-go{display:flex;gap:8px;align-items:center;margin:10px 0 4px}
.f-wish-map table.track td:last-child{white-space:nowrap}
.f-wish-map .wm-thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.f-wish-map .wm-thumbs img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.f-wish-map .wm-legend{display:flex;gap:10px;align-items:center;font-size:12px;color:var(--ink-3);margin:6px 0;flex-wrap:wrap}
.f-wish-map .wm-legend i{display:inline-block;width:80px;height:8px;border-radius:4px;background:linear-gradient(90deg,#d9f0d3,#a6dba0,#5aae61,#1b7837)}
.f-wish-map .wm-legend em{display:inline-block;width:12px;height:12px;border:2px dashed #888;font-style:normal}
@media(max-width:760px){.f-wish-map .wm-thumbs{grid-template-columns:repeat(3,1fr)}}
</style>`;

export default {
  id: 'wish-map',
  title: '民眾許願',
  oneLiner: '民眾想在哪裡種什麼樹，一格一格看',
  audience: ['public', 'plan', 'gov', 'mayor'], featured: ['public', 'plan'],
  dataStatus: ['sim', 'live'],
  maturity: 'exp',
  ready: true,
  demoValue: '把「我希望這裡有樹」變成 100 公尺方格的人數，和推薦種樹點一對就知道先種哪裡',
  problem: '市民想要樹蔭，但沒有管道說「我希望這裡有一棵樹」；市府排補植時也看不到哪裡最多人想要。',
  howto: '民眾在許願頁選位置和樹種送出；這裡把許願依 100 公尺方格加總，和推薦種樹點比對：附近 30 公尺內有推薦點就標「可種」，沒有就標「需會勘」。',
  limits: '許願資料多數是模擬；本站上傳沒有身分驗證，可能重複。推薦種樹點未現勘，「可種」只代表附近有書面候選點。許願人數不代表該處一定適合種樹。',
  rollout: {
    agencies: '工務局公園處（補植排程）、新工處（人行道與樹穴）、研考會（市民參與與陳情分類）',
    data: '許願點、推薦種樹點、會勘結果回填',
    budget: '情境試算：許願頁與地圖含在平台試辦內；會勘以既有巡查人力排入，滿格才派',
    promo: '樹牌 QR 直接連到許願頁；里辦公處張貼與里民大會推廣',
  },
  sources: [],
  chipDefs: { wish: { label: '民眾許願', dot: '#5aae61' } },
  chips: ['wish'],

  async page(ctx) {
    const e = ctx.esc;
    const d = await getData(ctx, true);
    this._refresh?.(d);
    const okN = d.cells.filter((c) => c.ok).length, top = d.cells.slice(0, 12);
    const thumbs = d.real.filter((w) => typeof w.photo === 'string' && SRC_OK.test(w.photo)).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 8);
    const spCount = {};
    for (const w of d.all) spCount[w.species] = (spCount[w.species] || 0) + 1;
    return `${STYLE}<div class="f-wish-map">
      <div class="facts">
        <div class="fact"><b>${d.all.length}</b><span>總許願數・${ctx.badge('sim')} ${d.all.length - d.real.length}${d.real.length ? `・${ctx.badge('live')} ${d.real.length}` : ''}</span></div>
        <div class="fact"><b>${d.cells.length}</b><span>許願格數</span></div>
        <div class="fact"><b>${okN}</b><span>可種格數 ${ctx.badge('est')}</span></div>
        <div class="fact"><b>${d.cells.length - okN}</b><span>需會勘格數</span></div>
      </div>
      <div class="wm-go"><a class="btn primary" href="${WISH_URL}">去許願</a><button class="btn" data-map>看地圖</button></div>
      <h3 class="h3">熱門格排行</h3>
      <div class="wm-legend">少 <i></i> 多・<em></em> 需會勘・滿 ${GOAL} 人＝許願成真</div>
      <table class="track"><thead><tr><th>地點</th><th>人數</th><th>最多樹種</th><th>照片</th><th></th></tr></thead><tbody>
      ${top.map((c) => `<tr><td>${e(c.name)}<br>${okBadge(c)} <small>${c.ok ? e(c.label) : ''}</small></td>
        <td><b>${c.n}</b>${c.live ? ` ${ctx.badge('live')}` : ''}<br>${ctx.bar(Math.min(c.n, GOAL), GOAL, c.n >= GOAL ? '#1b7837' : '#5aae61')}${c.n >= GOAL ? '<small>許願成真</small>' : ''}</td>
        <td>${e(c.top)}</td><td>${c.photos}</td>
        <td><button class="btn mini" data-fly="${e(c.k)}">看地圖</button></td></tr>`).join('')}
      </tbody></table>
      <h3 class="h3">大家選的樹種 ${ctx.badge('sim')}</h3>
      <ul class="list dist">${SPECIES.map((s) => `<li><span>${e(s.name)}</span><span>${spCount[s.id] || 0} 人</span></li>`).join('')}</ul>
      <h3 class="h3">最新上傳 ${ctx.badge('live')}</h3>
      ${thumbs.length ? `<div class="wm-thumbs">${thumbs.map((w) => `<img src="${e(w.photo)}" alt="${e(speciesById(w.species).name)}" loading="lazy">`).join('')}</div>` : `<p class="privacy">還沒有照片</p>`}
      <p class="privacy">真實上傳 ${d.real.length} 筆 ${ctx.badge('live')}・模擬 ${d.all.length - d.real.length} 筆 ${ctx.badge('sim')}</p>
    </div>`;
  },
  bindPage(root, ctx) {
    const show = (c) => {
      if (!ctx.isOn('wish-map')) ctx.setFeature('wish-map', true);
      ctx.S.layers.wish = true; ctx.refresh();
      ctx.go('#/');
      const m = ctx.map;
      if (c) {
        m.flyTo({ center: [c.lng, c.lat], zoom: 16.5, duration: 900 });
        m.once('moveend', () => openPopup(ctx, c));
      } else m.flyTo({ center: [121.528, 25.03], zoom: 14.3, duration: 900 });
    };
    root.querySelector('[data-map]')?.addEventListener('click', () => show(null));
    root.querySelectorAll('[data-fly]').forEach((b) => b.addEventListener('click', () => show(lastData?.cells.find((c) => c.k === b.dataset.fly))));
  },

  async init(ctx) {
    const m = ctx.map, empty = { type: 'FeatureCollection', features: [] };
    m.addSource('wm-points', { type: 'geojson', data: empty });
    m.addSource('wm-cells', { type: 'geojson', data: empty });
    const before = m.getLayer('sel') ? 'sel' : undefined;
    const hide = { visibility: 'none' };
    m.addLayer({ id: 'wm-heat', type: 'heatmap', source: 'wm-points', maxzoom: 15.5, layout: hide,
      paint: {
        'heatmap-weight': ['match', ['get', 'src'], 'live', 1, 0.6],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 1.3],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 8, 15, 26],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(217,240,211,0)', 0.2, '#d9f0d3', 0.45, '#a6dba0', 0.7, '#5aae61', 1, '#1b7837'],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0.85, 15.5, 0],
      } }, before);
    const fillColor = ['step', ['get', 'n'], '#d9f0d3', 3, '#a6dba0', 6, '#5aae61', GOAL, '#1b7837'];
    m.addLayer({ id: 'wm-cell-fill', type: 'fill', source: 'wm-cells', minzoom: 15, layout: hide,
      paint: { 'fill-color': fillColor, 'fill-opacity': ['case', ['==', ['get', 'ok'], 1], 0.55, 0.35] } }, before);
    m.addLayer({ id: 'wm-cell-ok', type: 'line', source: 'wm-cells', minzoom: 15, filter: ['==', ['get', 'ok'], 1], layout: hide,
      paint: { 'line-color': '#1b7837', 'line-width': 1.2 } }, before);
    m.addLayer({ id: 'wm-cell-check', type: 'line', source: 'wm-cells', minzoom: 15, filter: ['==', ['get', 'ok'], 0], layout: hide,
      paint: { 'line-color': '#7a7a7a', 'line-width': 1.6, 'line-dasharray': [2, 2] } }, before);
    m.addLayer({ id: 'wm-live', type: 'circle', source: 'wm-points', minzoom: 14, filter: ['==', ['get', 'src'], 'live'], layout: hide,
      paint: { 'circle-color': '#d6604d', 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } }, before);

    this._refresh = (d) => { m.getSource('wm-points')?.setData(gjPoints(d)); m.getSource('wm-cells')?.setData(gjCells(d)); };
    // 只有圖層可見時才會點到（隱藏的圖層不會被查到）
    m.on('click', 'wm-cell-fill', (ev) => {
      const k = ev.features?.[0]?.properties?.k, c = lastData?.cells.find((x) => x.k === k);
      if (c) openPopup(ctx, c);
    });
    m.on('mouseenter', 'wm-cell-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'wm-cell-fill', () => { m.getCanvas().style.cursor = ''; });
    // 開機不先算（要讀 5 MB 的推薦種樹點）；圖層打開時 apply() 才算
  },
  apply(ctx, layers, on) {
    const m = ctx.map; if (!m || !m.getLayer('wm-heat')) return;
    const v = on && layers.wish ? 'visible' : 'none';
    for (const id of ['wm-heat', 'wm-cell-fill', 'wm-cell-ok', 'wm-cell-check', 'wm-live']) m.setLayoutProperty(id, 'visibility', v);
    if (v === 'none') popup?.remove();
    else getData(ctx).then((d) => this._refresh?.(d));
  },
};
