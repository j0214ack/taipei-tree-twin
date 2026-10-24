// 民意熱點：本站民眾回報（真的有人送出）＋模擬的「市民提名樹」，依 150 公尺方格做叢集熱度。
// 模擬提名只放在三個示範施工案周邊，內容都是正面理由（市民在乎這棵樹），畫面一律標模擬。
import { seeded } from '../../js/sim.js';

const KX = 100850, KY = 110900;
const CELL = 0.0015; // 約 150 公尺
const REASONS = ['夏天這段路唯一的樹蔭', '看著它長大的老樹', '常有鳥來築巢', '開花季很多人來拍照', '孩子上下學的路上', '店門口的招牌樹'];
const W_LIVE = 3; // 一則本站回報的熱度權重（提名一次＝1）

let noms = null, nomsOf = null, liveP = null, liveAt = 0;

// 模擬提名：示範施工案中心 1.6 倍半徑內，約 6% 的樹（大樹機率較高）
function nominations(ctx) {
  if (noms && nomsOf === ctx.trees) return noms;
  nomsOf = ctx.trees; noms = new Map();
  for (const o of ctx.WORK_ORDERS) {
    const R = o.radius * 1.6, dl = R / KX, dt = R / KY;
    for (const t of ctx.trees) {
      if (Math.abs(t.lng - o.center[0]) > dl || Math.abs(t.lat - o.center[1]) > dt) continue;
      const d = Math.hypot((t.lng - o.center[0]) * KX, (t.lat - o.center[1]) * KY);
      if (d > R) continue;
      const r = seeded('nom' + t.id);
      const p = 0.035 + Math.min(0.12, (t.dbh || 0) / 600);
      if (r() > p) continue;
      noms.set(t.id, { tree: t, count: 1 + Math.floor(r() ** 2 * 40), reason: REASONS[Math.floor(r() * REASONS.length)] });
    }
  }
  return noms;
}

async function liveReports(ctx) {
  if (!liveP || Date.now() - liveAt > 30000) {
    liveAt = Date.now();
    liveP = ctx.getAllEvents().then((ev) => ev.filter((e) => e.role === 'citizen')).catch(() => []);
  }
  return liveP;
}

function points(ctx, live) {
  const feats = [];
  for (const n of nominations(ctx).values()) feats.push({ type: 'Feature', properties: { w: n.count, src: 'sim' }, geometry: { type: 'Point', coordinates: [n.tree.lng, n.tree.lat] } });
  for (const e of live) {
    const t = ctx.treeFromId(e.treeId); if (!t || t.lng == null) continue;
    feats.push({ type: 'Feature', properties: { w: W_LIVE * 10, src: 'live' }, geometry: { type: 'Point', coordinates: [t.lng, t.lat] } });
  }
  return { type: 'FeatureCollection', features: feats };
}

function inOrder(o, t) { return Math.hypot((t.lng - o.center[0]) * KX, (t.lat - o.center[1]) * KY) <= o.radius; }

function clusters(ctx, live) {
  const cells = new Map();
  const cell = (t) => {
    const k = `${Math.floor(t.lng / CELL)},${Math.floor(t.lat / CELL)}`;
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { k, sim: 0, simTrees: 0, live: 0, places: new Map(), dist: t.dist, lng: 0, lat: 0, n: 0 }));
    c.lng += t.lng; c.lat += t.lat; c.n++;
    if (t.place) c.places.set(t.place, (c.places.get(t.place) || 0) + 1);
    return c;
  };
  for (const n of nominations(ctx).values()) { const c = cell(n.tree); c.sim += n.count; c.simTrees++; }
  for (const e of live) { const t = ctx.treeFromId(e.treeId); if (!t || t.lng == null) continue; cell(t).live++; }
  return [...cells.values()].map((c) => {
    const lng = c.lng / c.n, lat = c.lat / c.n;
    const place = [...c.places.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const wo = ctx.WORK_ORDERS.find((o) => inOrder(o, { lng, lat }));
    return { ...c, lng, lat, place, wo, heat: c.sim + c.live * W_LIVE };
  }).sort((a, b) => b.heat - a.heat);
}

const STYLE = `<style>
.f-opinion-hotspot table.track td:last-child{white-space:nowrap}
.f-opinion-hotspot .oh-legend{display:flex;gap:10px;align-items:center;font-size:12px;color:var(--ink-3);margin:6px 0}
.f-opinion-hotspot .oh-legend i{display:inline-block;width:80px;height:8px;border-radius:4px;background:linear-gradient(90deg,#fde0ef,#f1b6da,#de77ae,#c51b7d,#8e0152)}
</style>`;

export default {
  id: 'opinion-hotspot',
  title: '民意熱點',
  oneLiner: '市民在乎的樹熱度圖',
  audience: ['gov', 'mayor'],
  dataStatus: ['live', 'sim'],
  maturity: 'exp',
  ready: true,
  demoValue: '工程公告前就知道範圍內有幾棵市民提名的樹，先開說明會而不是等抗議',
  problem: '市民對某棵樹的在乎，通常要等到樹被移走、上了新聞才被看見；市府在工程設計時看不到這些訊號。',
  howto: '打開「民意熱點」圖層看熱度；這頁列出熱度最高的地方，以及示範施工案範圍內有幾棵市民提名樹。點一列可以飛到那裡。',
  limits: '「市民提名樹」是模擬資料，只放在三個示範施工案周邊；本站回報是真的有人送出，但示範站沒有身分驗證、可能重複。熱度只代表回報與提名多寡，不代表陳情或爭議；沒有接 1999 陳情資料。',
  rollout: {
    agencies: '工務局公園處、研考會（1999 陳情分類）、各區公所與里辦公處',
    data: '1999 陳情案件的地點與分類（去個資）、市民提名紀錄、本站回報',
    budget: '情境試算：提名功能含在平台試辦內；1999 資料串接需資訊局與研考會人力',
    promo: '樹牌 QR 讓市民提名「我在乎的樹」；工程設計審查時一併看熱點',
  },
  sources: [],
  chipDefs: { opinion: { label: '民意熱點', dot: '#c51b7d' } },
  chips: ['opinion'],

  async page(ctx) {
    const e = ctx.esc;
    const live = await liveReports(ctx);
    this._refresh?.(ctx, live);
    const N = nominations(ctx);
    const top = clusters(ctx, live).slice(0, 12);
    const warn = ctx.WORK_ORDERS.map((o) => {
      const nt = [...N.values()].filter((n) => inOrder(o, n.tree));
      const lv = live.filter((x) => { const t = ctx.treeFromId(x.treeId); return t && t.lng != null && inOrder(o, t); });
      return { o, nt, lv };
    }).filter((w) => w.nt.length || w.lv.length);
    return `${STYLE}<div class="f-opinion-hotspot">
      <p class="privacy">提名 ${N.size} 棵 ${ctx.badge('sim')}・回報 ${live.length} 則 ${ctx.badge('live')}・熱度＝提名＋回報×${W_LIVE}</p>
      ${warn.map((w) => `<div class="alert warn"><p><b>⚠ ${e(w.o.name)}</b>：${w.nt.length} 棵提名樹 ${ctx.badge('sim')}${w.lv.length ? `、${w.lv.length} 則回報 ${ctx.badge('live')}` : ''}，開工前先溝通</p>
        <p><button class="btn mini" data-fly="${w.o.center[0]},${w.o.center[1]},15.5">飛到這裡</button> <button class="btn mini" data-ca="${e(w.o.id)}">工程衝突預警</button></p></div>`).join('')}
      <h3 class="h3">熱點排行</h3>
      <div class="oh-legend">低 <i></i> 高</div>
      <table class="track"><thead><tr><th>地點</th><th>提名 ${ctx.badge('sim')}</th><th>回報 ${ctx.badge('live')}</th><th></th></tr></thead><tbody>
      ${top.map((c) => `<tr data-fly="${c.lng},${c.lat},16.5"><td>${e(c.place || '（未命名路段）')}<br><small>${e(c.dist || '')}${c.wo ? `｜施工案內` : ''}</small></td><td>${c.simTrees} 棵／${c.sim} 次</td><td>${c.live} 則</td><td><button class="btn mini">看地圖</button></td></tr>`).join('')}
      </tbody></table>
      <h3 class="h3">提名最多的樹 ${ctx.badge('sim')}</h3>
      <ul class="list dist">${[...N.values()].sort((a, b) => b.count - a.count).slice(0, 8).map((n) => `<li><a href="#/tree/${encodeURIComponent(n.tree.id)}">${e(n.tree.species)} ${e(n.tree.id)}</a><span>${e(n.tree.place || '')}｜${n.count} 次｜「${e(n.reason)}」</span></li>`).join('')}</ul>
    </div>`;
  },
  bindPage(root, ctx) {
    root.querySelectorAll('[data-fly]').forEach((el) => el.addEventListener('click', () => {
      const [lng, lat, z] = el.dataset.fly.split(',').map(Number);
      ctx.S.layers.opinion = true; ctx.refresh();
      ctx.go('#/');
      ctx.map.flyTo({ center: [lng, lat], zoom: z, duration: 900 });
    }));
    root.querySelectorAll('[data-ca]').forEach((b) => b.addEventListener('click', () => ctx.go('#/f/conflict-alert')));
  },

  async onTree(ctx, tree) {
    const n = nominations(ctx).get(tree.id);
    const live = (await liveReports(ctx)).filter((e) => e.treeId === tree.id);
    if (!n && !live.length) return '';
    return `${n ? `<p>市民提名 <b>${n.count}</b> 次 ${ctx.badge('sim')}：「${ctx.esc(n.reason)}」</p>` : ''}
      ${live.length ? `<p>本站回報 <b>${live.length}</b> 則 ${ctx.badge('live')}</p>` : ''}`;
  },

  async init(ctx) {
    const m = ctx.map;
    m.addSource('oh-points', { type: 'geojson', data: points(ctx, []) });
    const before = m.getLayer('sel') ? 'sel' : undefined;
    m.addLayer({ id: 'oh-heat', type: 'heatmap', source: 'oh-points', maxzoom: 16, layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'w'], 1, 0.15, 30, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 1.4],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 28],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(253,224,239,0)', 0.2, '#fde0ef', 0.4, '#f1b6da', 0.6, '#de77ae', 0.8, '#c51b7d', 1, '#8e0152'],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.85, 16, 0.2],
      } }, before);
    m.addLayer({ id: 'oh-pts', type: 'circle', source: 'oh-points', minzoom: 14, layout: { visibility: 'none' },
      paint: {
        'circle-color': ['match', ['get', 'src'], 'live', '#8a6400', '#c51b7d'],
        'circle-radius': ['interpolate', ['linear'], ['get', 'w'], 1, 4, 40, 10],
        'circle-opacity': 0.75, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
      } }, before);
    this._refresh = (c, live) => m.getSource('oh-points')?.setData(points(c, live));
    liveReports(ctx).then((live) => this._refresh(ctx, live));
  },
  apply(ctx, layers, on) {
    const m = ctx.map; if (!m || !m.getLayer('oh-heat')) return;
    const v = on && layers.opinion ? 'visible' : 'none';
    m.setLayoutProperty('oh-heat', 'visibility', v);
    m.setLayoutProperty('oh-pts', 'visibility', v);
  },
};
