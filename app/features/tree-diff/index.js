// 行道樹歷年版本比對：只載入差異點、統計與壓縮過的出現紀錄。
let DATA = null;
let HISTORY = null;
let activePeriod = '2024-2026'; // 預設看最近一期
let diffMap = null;

const STYLE = `<style>
#panel:has(.f-tree-diff){left:16px;width:auto}
.f-tree-diff{--gone:#c7473d;--new:#23815b;--reid:#8067a6;max-width:1080px;margin:0 auto}
.f-tree-diff .td-switch{display:flex;gap:6px;margin:4px 0 14px;position:sticky;top:-20px;z-index:3;background:var(--card);padding:10px 0}
.f-tree-diff .td-switch button{flex:1;border:1px solid var(--line);background:#fff;border-radius:999px;padding:9px;font:inherit;font-weight:700;cursor:pointer}
.f-tree-diff .td-switch button.on{background:var(--forest);color:#fff;border-color:var(--forest)}
.f-tree-diff .td-badges{display:flex;gap:6px;align-items:center;margin-bottom:8px}
.f-tree-diff .td-badge{display:inline-block;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:700;background:#e8f4ec;color:#24573d}
.f-tree-diff .td-badge.maybe{background:#fff0e3;color:#8a4917}
.f-tree-diff .td-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0 18px}
.f-tree-diff .td-fact{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff}
.f-tree-diff .td-fact b{display:block;font-size:28px;font-family:"Noto Serif TC",serif;line-height:1.1}
.f-tree-diff .td-fact span{font-size:12px;color:var(--ink-3)}
.f-tree-diff .td-fact.gone b{color:var(--gone)}.f-tree-diff .td-fact.new b{color:var(--new)}
.f-tree-diff .td-section{margin:20px 0}.f-tree-diff .td-section h3{margin:0 0 9px;font-size:16px}
.f-tree-diff .td-bars{display:grid;gap:7px}.f-tree-diff .td-bar{display:grid;grid-template-columns:54px 1fr 46px;gap:8px;align-items:center;font-size:12px}
.f-tree-diff .td-track{height:17px;display:flex;background:var(--paper);border-radius:5px;overflow:hidden}
.f-tree-diff .td-track i{height:100%}.f-tree-diff .td-track .gone{background:var(--gone)}.f-tree-diff .td-track .new{background:var(--new)}
.f-tree-diff .td-num{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink-2)}
.f-tree-diff .td-vizgrid{display:grid;grid-template-columns:minmax(360px,.9fr) minmax(480px,1.35fr);gap:20px;align-items:start}
.f-tree-diff .td-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--ink-2);margin:6px 0}
.f-tree-diff .td-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px}
.f-tree-diff .td-map{height:360px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#e8ece7}
.f-tree-diff .td-toggle{font-size:13px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:7px}
.f-tree-diff .td-species{display:grid;grid-template-columns:1fr 1fr;gap:14px}.f-tree-diff .td-species ol{margin:4px 0;padding-left:22px;font-size:13px}.f-tree-diff .td-species li{padding:3px 0}.f-tree-diff .td-species b{float:right}
.f-tree-diff .td-source{font-size:12px;color:var(--ink-3);line-height:1.5}
.td-history{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:14px}.td-history b{font-variant-numeric:tabular-nums}.td-history .yes{color:#207852}.td-history .no{color:#a33b35}
.td-popup{font:13px/1.45 "Noto Sans TC",sans-serif;min-width:180px}.td-popup b{font-size:15px}.td-popup button{border:0;background:#1f3d2b;color:#fff;border-radius:999px;padding:7px 11px;margin-top:7px;cursor:pointer}
@media(max-width:900px){.f-tree-diff .td-vizgrid{grid-template-columns:1fr}}
@media(max-width:760px){#panel:has(.f-tree-diff){top:var(--top-h);left:0;bottom:calc(52px + env(safe-area-inset-bottom));height:auto;border-radius:0}.f-tree-diff .td-map{height:280px}.f-tree-diff .td-fact{padding:10px 8px}.f-tree-diff .td-fact b{font-size:22px}.f-tree-diff .td-species{grid-template-columns:1fr}.f-tree-diff .td-switch{top:-26px}}
</style>`;

const fmt = (n) => Number(n).toLocaleString('zh-TW');
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function load(ctx) {
  if (!DATA) DATA = await ctx.fetchJSON('/data/tree-diff.json');
  if (!HISTORY) {
    HISTORY = new Map();
    for (const [mask, ids] of Object.entries(DATA.history)) for (const id of ids) HISTORY.set(id, +mask);
  }
  return DATA;
}
const period = () => DATA.periods.find((p) => p.id === activePeriod) || DATA.periods[0];
const years = (mask) => ['2022', '2024', '2026'].map((year, i) => `<span><b>${year}</b> <i class="${mask & (1 << i) ? 'yes' : 'no'}">${mask & (1 << i) ? '✓' : '–'}</i></span>`).join('');
function speciesList(items) { return `<ol>${items.map((x) => `<li>${e(x.name)}<b>${fmt(x.count)}</b></li>`).join('')}</ol>`; }

function pageHtml() {
  const p = period(), s = p.summary, max = Math.max(...p.districts.map((x) => x.disappeared + x.appeared));
  return `${STYLE}<div class="f-tree-diff">
    <div class="td-badges"><span class="td-badge">真實資料比對</span><span class="td-badge maybe">疑似</span></div>
    <div class="td-switch" role="group" aria-label="比對期間">${DATA.periods.map((x) => `<button data-period="${x.id}" class="${x.id === p.id ? 'on' : ''}">${x.from} → ${x.to}</button>`).join('')}</div>
    <div class="td-facts">
      <div class="td-fact gone"><b>−${fmt(s.disappeared)}</b><span>資料中消失</span></div>
      <div class="td-fact new"><b>+${fmt(s.appeared)}</b><span>新出現</span></div>
      <div class="td-fact"><b>${s.net >= 0 ? '+' : ''}${fmt(s.net)}</b><span>淨變化</span></div>
    </div>
    <section class="td-section"><h3>空間比對</h3><div class="td-facts">
      <div class="td-fact gone"><b>${fmt(s.suspectedRemoved)}</b><span>疑似移除</span></div>
      <div class="td-fact new"><b>${fmt(s.suspectedNew)}</b><span>疑似新植</span></div>
      <div class="td-fact"><b>${fmt(s.suspectedRenumbered)}</b><span>疑似重新編號</span></div>
    </div></section>
    <div class="td-vizgrid"><section class="td-section"><h3>各行政區</h3>
      <div class="td-legend"><span><i style="background:var(--gone)"></i>資料中消失</span><span><i style="background:var(--new)"></i>新出現</span></div>
      <div class="td-bars">${p.districts.map((x) => `<div class="td-bar"><span>${e(x.name.replace(/區$/, ''))}</span><span class="td-track"><i class="gone" style="width:${x.disappeared / max * 100}%"></i><i class="new" style="width:${x.appeared / max * 100}%"></i></span><span class="td-num">${x.net >= 0 ? '+' : ''}${fmt(x.net)}</span></div>`).join('')}</div>
    </section>
    <section class="td-section"><h3>差異點</h3>
      <div class="td-toggle"><label><input type="checkbox" data-layer="suspected-removed" checked> 疑似移除</label><label><input type="checkbox" data-layer="suspected-new" checked> 疑似新植</label><label><input type="checkbox" data-layer="suspected-renumbered"> 疑似重新編號</label></div>
      <div class="td-map" data-map aria-label="行道樹差異點地圖"></div>
    </section></div>
    <section class="td-section td-species"><div><h3>消失樹種前 10</h3>${speciesList(p.species.disappeared)}</div><div><h3>新增樹種前 10</h3>${speciesList(p.species.appeared)}</div></section>
    <p class="td-source">${e(DATA.sourceLine)}</p>
  </div>`;
}

function geojson(p) {
  return { type: 'FeatureCollection', features: p.points.map((x, i) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [x.lng, x.lat] }, properties: x })) };
}
function bind(root, ctx) {
  root.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { activePeriod = b.dataset.period; try { diffMap?.remove(); } catch {} diffMap = null; root.innerHTML = pageHtml(); bind(root, ctx); }));
  const p = period(), holder = root.querySelector('[data-map]');
  try { diffMap?.remove(); } catch {} diffMap = null;
  diffMap = new maplibregl.Map({ container: holder, center: [121.54, 25.06], zoom: 10.7,
    style: 'https://tiles.openfreemap.org/styles/positron' }); // 不用 OSM 官方圖磚（tile policy）
  diffMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  diffMap.on('load', () => {
    diffMap.addSource('diff', { type: 'geojson', data: geojson(p) });
    for (const [type, color] of [['suspected-removed', '#c7473d'], ['suspected-new', '#23815b'], ['suspected-renumbered', '#8067a6']]) {
      diffMap.addLayer({ id: type, type: 'circle', source: 'diff', filter: ['==', ['get', 'type'], type], layout: { visibility: type === 'suspected-renumbered' ? 'none' : 'visible' }, paint: { 'circle-color': color, 'circle-opacity': .72, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 7], 'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, .3, 16, 1] } });
      diffMap.on('mouseenter', type, () => { diffMap.getCanvas().style.cursor = 'pointer'; });
      diffMap.on('mouseleave', type, () => { diffMap.getCanvas().style.cursor = ''; });
      diffMap.on('click', type, (ev) => {
        const x = ev.features[0].properties;
        const label = type === 'suspected-removed' ? '疑似移除' : type === 'suspected-new' ? '疑似新植' : '疑似重新編號';
        const versions = type === 'suspected-new' ? `${p.from} 無・${p.to} 有` : `${p.from} 有・${p.to} 無`;
        const canOpen = ctx.treeFromId(x.id);
        const html = `<div class="td-popup"><b>${ctx.esc(x.species)}</b><br>${ctx.esc(x.id)}<br>胸徑 ${x.dbh || '—'} 公分<br>${label}<br>${versions}${x.newId ? `<br>新編號 ${ctx.esc(x.newId)}` : ''}${canOpen ? `<br><button data-tree="${ctx.esc(x.id)}">開這棵樹</button>` : ''}</div>`;
        const pop = new maplibregl.Popup().setLngLat(ev.features[0].geometry.coordinates).setHTML(html).addTo(diffMap);
        pop.getElement().querySelector('[data-tree]')?.addEventListener('click', () => ctx.go(`#/tree/${x.id}`));
      });
    }
  });
  root.querySelectorAll('[data-layer]').forEach((c) => c.addEventListener('change', () => { if (diffMap?.getLayer(c.dataset.layer)) diffMap.setLayoutProperty(c.dataset.layer, 'visibility', c.checked ? 'visible' : 'none'); }));
}

export default {
  id: 'tree-diff', title: '台北行道樹逐年增減', oneLiner: '看哪些行道樹消失、哪些新出現',
  audience: ['public', 'gov', 'plan', 'mayor'], dataStatus: ['real'], maturity: 'stable', ready: true, featured: ['public', 'plan'],
  demoValue: '直接比較 2022、2024、2026 三期官方樹籍，地圖查看疑似移除、疑似新植與重新編號。',
  problem: '官方未公開逐樹異動原因，民眾無法直接看一個路段的樹是增加還是減少。',
  howto: '切換期間，看全市與行政區統計；在地圖開關差異類型，點一棵看編號與出現版本。',
  limits: '資料中消失不等於移除，新出現也不等於新植；重新編號、普查補登與資料清理都會造成差異。',
  rollout: { agencies: '公園處、資訊局', data: '逐樹異動原因與日期', budget: '情境試算：既有平台加欄位與版本保存', promo: '公開版本差異與異動原因' },
  sources: [{ label: '臺北市行道樹及公園樹木分布圖', url: 'https://data.gov.tw/dataset/128274', date: '2022、2024、2026 版本' }],
  async page(ctx) {
    await load(ctx);
    // 既有單棵樹頁的「消失」時間軸以 2024→2026 為情境；只補入 2024 曾存在的舊樹，避免替 2022-only 樹顯示錯誤年份。
    for (const p of DATA.periods) for (const x of p.points) if (x.type !== 'suspected-new' && (HISTORY.get(x.id) & 2) && !ctx.S.byId.has(x.id)) {
      ctx.S.byId.set(x.id, { id: x.id, species: x.species, dbh: x.dbh, height: null, survey: '', dist: x.dist, place: x.region, remark: '', kind: 0, lng: x.lng, lat: x.lat, gone: true, goneNote: '這個樹籍編號在較新的版本中消失；原因未公開。' });
    }
    return pageHtml();
  },
  bindPage: bind,
  async onTree(ctx, tree) {
    await load(ctx); const mask = HISTORY.get(tree.id);
    if (!mask) return '';
    return `<div class="td-history"><span class="td-badge">真實資料比對</span>${years(mask)}</div>`;
  },
};
