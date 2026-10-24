// 企業在認養前選一塊區域，即時計算樹籍、缺蔭、人流、費用與碳吸存提案。
import { DONGMEN_BLOCK } from '../dongmen-block/index.js';
import { summarizeCarbon } from './carbon.js';

const ID = 'adopt-proposal';
export const ANNUAL_FEE_PER_TREE = 1200; // 模擬單價：每棵樹每年 NT$1,200。

const AREAS = Object.freeze({
  dongmen: Object.freeze({ label: '東門市場街區', bounds: DONGMEN_BLOCK.bounds }),
  heping: Object.freeze({ label: '和平東路一段', bounds: Object.freeze([121.5245, 25.02575, 121.53265, 25.02755]) }),
});

const SOURCE_URLS = Object.freeze({
  chave: 'https://doi.org/10.1111/gcb.12629',
  wood: 'https://doi.org/10.5061/dryad.234',
  ipcc: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol4.html',
});

const state = { map: null, idx: null, company: 'c1', result: null, draw: false, marker: null, observer: null };
const n0 = (v) => Math.round(v || 0).toLocaleString('zh-TW');
const n1 = (v) => Number(v || 0).toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (v) => `${Math.round(v || 0)}%`;
const centerOf = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const inBounds = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const boundsGeoJSON = (b) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[
  [b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]],
]] } });

function lineHitsBounds(geometry, bounds) {
  const lines = geometry?.type === 'MultiLineString' ? geometry.coordinates : [geometry?.coordinates || []];
  for (const line of lines) {
    for (const point of line) if (inBounds(point, bounds)) return true;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      if (Math.max(a[0], b[0]) >= bounds[0] && Math.min(a[0], b[0]) <= bounds[2]
        && Math.max(a[1], b[1]) >= bounds[1] && Math.min(a[1], b[1]) <= bounds[3]) return true;
    }
  }
  return false;
}

function treeStats(trees) {
  const species = new Map();
  let dbhSum = 0, dbhCount = 0;
  for (const tree of trees) {
    species.set(tree.species || '未記錄', (species.get(tree.species || '未記錄') || 0) + 1);
    const d = Number(tree.dbh);
    if (Number.isFinite(d) && d > 0 && d <= 300) { dbhSum += d; dbhCount++; }
  }
  return {
    count: trees.length,
    topSpecies: [...species].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant')).slice(0, 5),
    avgDbh: dbhCount ? dbhSum / dbhCount : 0,
    dbhCount,
  };
}

function nearestArea(index, bounds) {
  const [lng, lat] = centerOf(bounds);
  return index.areas.reduce((best, area) => {
    const dx = (area.center[0] - lng) * 101000;
    const dy = (area.center[1] - lat) * 111000;
    const distance = Math.hypot(dx, dy);
    return !best || distance < best.distance ? { ...area, distance } : best;
  }, null);
}

function pedestrianStats(features, hours) {
  const shadeWeighted = new Array(hours.length).fill(0);
  const lengths = new Array(hours.length).fill(0);
  const pass = new Array(hours.length).fill(0);
  const exposure = new Array(hours.length).fill(0);
  // 路段人次不能相加（同一人會走過很多段），改取最繁忙路段與路段中位數
  const segDaily = [];
  for (const feature of features) {
    const q = feature.properties || {};
    const len = Number(q.len) || 0;
    for (let h = 0; h < hours.length; h++) {
      const s = Number(q.s?.[h]);
      if (Number.isFinite(s) && len > 0) { shadeWeighted[h] += s * len; lengths[h] += len; }
      pass[h] += Number(q.p?.[h]) || 0;
      exposure[h] += Number(q.e?.[h]) || 0;
    }
    segDaily.push((q.p || []).reduce((a, b) => a + (Number(b) || 0), 0));
  }
  segDaily.sort((a, b) => a - b);
  const shade = shadeWeighted.map((v, i) => lengths[i] ? v / lengths[i] : 0);
  const averageShade = shade.length ? shade.reduce((a, b) => a + b, 0) / shade.length : 0;
  let hottest = 0;
  for (let i = 1; i < exposure.length; i++) if (exposure[i] > exposure[hottest]) hottest = i;
  return {
    segments: features.length,
    averageShade,
    hottestHour: hours[hottest] ?? 7,
    busiestDaily: segDaily.length ? segDaily[segDaily.length - 1] : 0,
    medianDaily: segDaily.length ? segDaily[Math.floor(segDaily.length / 2)] : 0,
  };
}

async function calculate(ctx, bounds, label) {
  const root = document.querySelector('.f-adopt-proposal');
  root?.classList.add('loading');
  const trees = ctx.trees.filter((tree) => inBounds([tree.lng, tree.lat], bounds));
  const index = state.idx || await ctx.fetchJSON('/data/ped-exposure/index.json');
  state.idx = index;
  const station = nearestArea(index, bounds);
  const geojson = await ctx.fetchJSON(`/data/ped-exposure/${encodeURIComponent(station.file)}`);
  const features = (geojson.features || []).filter((feature) => lineHitsBounds(feature.geometry, bounds));
  const result = {
    label, bounds: [...bounds], trees,
    tree: treeStats(trees),
    carbon: summarizeCarbon(trees),
    pedestrian: pedestrianStats(features, index.hours || []),
    pedestrianFeatures: features,
    station,
    company: ctx.COMPANIES.find((company) => company.id === state.company) || ctx.COMPANIES[0],
  };
  state.result = result;
  syncMap();
  renderResult(root, ctx, result);
  root?.classList.remove('loading');
  return result;
}

function badge(kind, text) { return `<span class="badge ${kind}">${text}</span>`; }

function proposalHTML(ctx, r) {
  const e = ctx.esc;
  const annualFee = r.tree.count * ANNUAL_FEE_PER_TREE;
  const p = r.pedestrian;
  const species = r.tree.topSpecies.length
    ? r.tree.topSpecies.map(([name, count]) => `<li><b>${e(name)}</b><span>${n0(count)} 棵</span></li>`).join('')
    : '<li><b>區內沒有登錄樹木</b></li>';
  return `<article class="ap-proposal" data-proposal>
    <header class="ap-proposal-head">
      <div><span class="ap-kicker">企業認養效益試算</span><h3>${e(r.label)}</h3><p>${e(r.company.name)}</p></div>
      <img src="${r.company.logo}" alt="${e(r.company.name)} logo">
    </header>
    <div class="ap-print-map"><img data-print-map alt="${e(r.label)}區域地圖"><span>${e(r.label)}</span></div>
    <div class="ap-grid">
      <section class="ap-card ap-trees"><h4>認養範圍 ${badge('real', '真實')}</h4>
        <div class="ap-big"><b>${n0(r.tree.count)}</b><span>棵登錄樹木</span></div>
        <div class="ap-mini"><span>平均胸徑</span><b>${n1(r.tree.avgDbh)} cm</b></div>
        <ol class="ap-species">${species}</ol>
      </section>
      ${p.segments ? `<section class="ap-card"><h4>缺蔭程度 ${badge('est', '推估')}</h4>
        <div class="ap-big"><b>${pct(100 - p.averageShade)}</b><span>平均缺蔭</span></div>
        <div class="ap-pair"><span><b>${pct(p.averageShade)}</b>平均遮蔭</span><span><b>${p.hottestHour}:00–${p.hottestHour + 1}:00</b>最曬時段</span></div>
        <small>對應${e(r.station.station)}站・${n0(p.segments)} 段</small>
      </section>
      <section class="ap-card"><h4>樹蔭受益人次 ${badge('sim', '模擬')} ${badge('est', '推估')}</h4>
        <div class="ap-big"><b>${n0(p.busiestDaily)}</b><span>最熱鬧路段人次／日</span></div>
        <div class="ap-pair"><span><b>${n0(p.medianDaily)}</b>一般路段人次／日</span><span><b>07–19</b>時段</span></div>
      </section>` : `<section class="ap-card"><h4>缺蔭與人流 ${badge('est', '推估')}</h4><p><span class="badge kind">此區無人流資料</span></p></section>`}
      <section class="ap-card"><h4>碳儲存與年吸存 ${badge('est', '推估')}</h4>
        <div class="ap-pair ap-carbon"><span><b>${n1(r.carbon.storedTCo2e)}</b>已儲存（公噸 CO2e）</span><span><b>${n1(r.carbon.annualTCo2e)}</b>每年吸存（公噸 CO2e）</span></div>
        <p>估算值，不是減量額度，不能算公司減排。</p>
        <small>Chave 2014 異速式＋IPCC 係數<br>納入 ${n0(r.carbon.used)}・略過 ${n0(r.carbon.skippedTotal)}・密度預設 ${n0(r.carbon.defaultDensity)}</small>
      </section>
      <section class="ap-card"><h4>年費 ${badge('sim', '模擬')}</h4>
        <div class="ap-big"><b>NT$${n0(annualFee)}</b><span>每年</span></div>
        <small>每棵樹每年 NT$${n0(ANNUAL_FEE_PER_TREE)}</small>
      </section>
      <section class="ap-card"><h4>曝光位置</h4><ul class="ap-bullets"><li>地圖企業 logo</li><li>每棵樹頁贊助標示</li><li>遊戲獎品贊助</li></ul></section>
      <section class="ap-card ap-disclosure"><h4>報告書可揭露項目</h4>
        <ul class="ap-bullets"><li>GRI 101-2-a-v 額外保育行動</li><li>TNFD A24</li><li>GRI 413</li></ul>
        <p>認養後每年提供：<a href="#/f/esg-report?c=${r.company.id}">Excel 素材包＋PDF 摘要</a></p>
      </section>
    </div>
    <p class="ap-rule">自願保育行動，不能算減排，也不是碳權。</p>
    <footer>平台產出・推估與模擬資料</footer>
  </article>`;
}

function renderResult(root, ctx, result) {
  const box = root?.querySelector('[data-ap-result]');
  if (!box) return;
  box.innerHTML = proposalHTML(ctx, result);
  captureMap();
}

// 小地圖狀態同步：區域框、區內樹點、視野、logo。地圖 load 與試算完成誰先到都會呼叫，
// 只看自己加的 source 在不在（map.loaded() 在圖磚載入中會是 false，不能拿來擋）。
function fitArea(map, bounds) {
  map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 24, duration: 0, maxZoom: 17 });
}

function syncMap() {
  const map = state.map, result = state.result;
  if (!map || !result) return;
  let area, trees;
  try { area = map.getSource('ap-area'); trees = map.getSource('ap-trees'); } catch { return; }
  if (!area || !trees) return; // 還沒 load，load handler 會再叫一次
  area.setData(boundsGeoJSON(result.bounds));
  trees.setData({ type: 'FeatureCollection', features: result.trees.map((tree) => ({
    type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [tree.lng, tree.lat] },
  })) });
  map.resize();
  fitArea(map, result.bounds);
  state.marker?.remove();
  const logo = document.createElement('img');
  logo.className = 'ap-map-logo'; logo.src = result.company.logo; logo.alt = '';
  state.marker = new maplibregl.Marker({ element: logo }).setLngLat(centerOf(result.bounds)).addTo(map);
  map.once('idle', captureMap);
  setTimeout(captureMap, 1200);
}

function captureMap() {
  const img = document.querySelector('[data-print-map]');
  const result = state.result;
  if (!img || !result) return;
  try {
    // 列印版用同一批區域資料重畫成靜態小地圖；不受 WebGL 列印時清空 drawing buffer 影響。
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 360;
    const g = canvas.getContext('2d');
    const [w, s, e, n] = result.bounds;
    const xy = ([lng, lat]) => [30 + ((lng - w) / Math.max(1e-9, e - w)) * 1140, 330 - ((lat - s) / Math.max(1e-9, n - s)) * 300];
    g.fillStyle = '#f0f1ed'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = '#d8dcd5'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const feature of result.pedestrianFeatures || []) {
      const lines = feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [feature.geometry?.coordinates || []];
      for (const line of lines) {
        g.beginPath();
        line.forEach((point, index) => { const [x, y] = xy(point); index ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(47,122,69,.83)';
    for (const tree of result.trees) { const [x, y] = xy([tree.lng, tree.lat]); g.beginPath(); g.arc(x, y, 4.2, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#b85b16'; g.lineWidth = 6; g.setLineDash([16, 10]); g.strokeRect(16, 16, 1168, 328); g.setLineDash([]);
    const [cx, cy] = xy(centerOf(result.bounds));
    g.fillStyle = result.company.color || '#e07a1f'; g.beginPath(); g.arc(cx, cy, 25, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#1f3d2b'; g.font = '700 18px sans-serif'; g.fillText('N', 1142, 42);
    g.beginPath(); g.moveTo(1150, 50); g.lineTo(1141, 72); g.lineTo(1159, 72); g.closePath(); g.fill();
    const url = canvas.toDataURL('image/png');
    if (url && url.length > 100) { img.src = url; img.classList.add('ready'); }
  } catch (error) { console.warn(ID, 'map snapshot', error); }
}

function setDrawMode(root, ctx, on) {
  state.draw = on;
  root.querySelector('[data-ap-draw-tip]').hidden = !on;
  root.querySelector('[data-ap-custom]')?.classList.toggle('on', on);
  if (on) ctx.showToast('在小地圖上拖曳畫矩形');
}

function bindDrawing(root, ctx, map) {
  const canvas = map.getCanvas();
  let start = null;
  const eventPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  canvas.addEventListener('mousedown', (event) => {
    if (!state.draw || event.button !== 0) return;
    event.preventDefault(); start = eventPoint(event); map.dragPan.disable();
  });
  window.addEventListener('mousemove', (event) => {
    if (!start || !state.draw) return;
    const now = eventPoint(event), a = map.unproject(start), b = map.unproject(now);
    map.getSource('ap-area')?.setData(boundsGeoJSON([Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)]));
  });
  window.addEventListener('mouseup', (event) => {
    if (!start || !state.draw) return;
    const end = eventPoint(event), distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const a = map.unproject(start), b = map.unproject(end); start = null; map.dragPan.enable();
    if (distance < 20) { syncMap(); return ctx.showToast('請拖出一個矩形'); }
    const bounds = [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
    setDrawMode(root, ctx, false);
    calculate(ctx, bounds, '自選區域').catch(() => ctx.showToast('這個區域暫時算不出來'));
  });
}

function initMap(root, ctx) {
  try { state.map?.remove(); } catch {}
  const container = root.querySelector('[data-ap-map]');
  const map = new maplibregl.Map({
    container,
    center: centerOf(AREAS.dongmen.bounds), zoom: 15.5,
    preserveDrawingBuffer: true,
    attributionControl: { compact: true },
    style: 'https://tiles.openfreemap.org/styles/positron',
  });
  state.map = map;
  // 容器建立時可能還沒排版（面板剛打開），尺寸一變就重算，避免地圖空白
  // 尺寸變了（面板展開、寬螢幕 CSS zoom）就重算並重新框住整個區域
  const refit = () => {
    map.resize();
    if (state.map !== map || !state.result || state.draw) return;
    try { if (map.getSource('ap-area')) fitArea(map, state.result.bounds); } catch {}
  };
  try { new ResizeObserver(refit).observe(container); } catch {}
  setTimeout(refit, 400);
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.on('load', () => {
    if (state.map !== map) return;
    const startBounds = state.result?.bounds || AREAS.dongmen.bounds;
    if (!map.getSource('ap-area')) map.addSource('ap-area', { type: 'geojson', data: boundsGeoJSON(startBounds) });
    if (!map.getSource('ap-trees')) map.addSource('ap-trees', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // 圖層加在整個底圖最上面（不指定 beforeId），框線外加白色襯底，任何底圖都看得清楚
    map.addLayer({ id: 'ap-area-fill', type: 'fill', source: 'ap-area', paint: { 'fill-color': '#e07a1f', 'fill-opacity': 0.14 } });
    map.addLayer({ id: 'ap-area-casing', type: 'line', source: 'ap-area', layout: { 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.85 } });
    map.addLayer({ id: 'ap-area-line', type: 'line', source: 'ap-area', layout: { 'line-join': 'round', visibility: 'visible' }, paint: { 'line-color': '#a34e0d', 'line-width': 3, 'line-dasharray': [2, 1] } });
    map.addLayer({ id: 'ap-tree-points', type: 'circle', source: 'ap-trees', layout: { visibility: 'visible' }, paint: { 'circle-radius': 3.5, 'circle-color': '#2f7a45', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1, 'circle-opacity': 0.95 } });
    bindDrawing(root, ctx, map);
    if (state.result) syncMap(); else fitArea(map, startBounds);
  });
}

function printProposal(ctx) {
  if (!state.result) return;
  captureMap();
  const oldTitle = document.title;
  document.title = `認養效益試算_${state.result.label}`;
  const restore = () => { document.title = oldTitle; removeEventListener('afterprint', restore); };
  addEventListener('afterprint', restore);
  setTimeout(() => { window.print(); setTimeout(restore, 1000); }, 80);
}

const STYLE = `<style id="ap-style">
body:has(.f-adopt-proposal) .panel{width:min(780px,calc(100vw - 360px))}
.f-adopt-proposal{--ap-orange:#e07a1f}.ap-tools{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;margin:12px 0}.ap-tools label{display:grid;gap:5px;font-size:12px;color:var(--ink-3)}.ap-tools select{height:38px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:0 10px}.ap-areas{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.ap-areas .btn{padding:7px 11px}.ap-map-wrap{position:relative;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#e8e5dc}.ap-map{height:245px}.ap-draw-tip{position:absolute;z-index:3;left:50%;top:12px;transform:translateX(-50%);background:var(--forest);color:#fff;border-radius:999px;padding:6px 12px;font-size:12px;pointer-events:none}.ap-map-logo{width:40px;height:40px;border:3px solid #fff;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.28)}.ap-result{margin-top:12px}.f-adopt-proposal.loading .ap-result{opacity:.5}.ap-proposal{border:1px solid var(--line);border-radius:16px;background:#fff;padding:16px}.ap-proposal-head{display:flex;justify-content:space-between;gap:12px;align-items:center;border-bottom:2px solid var(--forest);padding-bottom:10px}.ap-proposal-head h3{font-size:25px;color:var(--forest);margin:2px 0}.ap-proposal-head p{margin:0;color:var(--ink-3);font-size:12px}.ap-proposal-head img{width:52px;height:52px;border-radius:14px}.ap-kicker{font-size:11px;letter-spacing:.15em;color:var(--sun);font-weight:700}.ap-print-map{display:none;position:relative;height:115px;overflow:hidden;background:#ece9e0;border-radius:10px;margin:10px 0}.ap-print-map img{width:100%;height:100%;object-fit:cover}.ap-print-map span{position:absolute;left:8px;top:8px;background:rgba(255,255,255,.9);padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700}.ap-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:10px}.ap-card{border:1px solid var(--line);background:#fffdf8;border-radius:12px;padding:11px}.ap-card h4{margin:0 0 7px;font-size:13px;display:flex;align-items:center;gap:4px;flex-wrap:wrap}.ap-big{display:flex;gap:7px;align-items:baseline}.ap-big b{font:900 25px/1 "Noto Serif TC",serif;color:var(--forest)}.ap-big span,.ap-mini,.ap-card small{font-size:11px;color:var(--ink-3)}.ap-mini{display:flex;justify-content:space-between;margin-top:6px}.ap-mini b{color:var(--ink)}.ap-species{list-style:none;padding:0;margin:7px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:11px;counter-reset:item}.ap-species li{display:flex;justify-content:space-between;gap:4px}.ap-species li:nth-child(5){grid-column:1/-1}.ap-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:7px 0}.ap-pair span{display:flex;flex-direction:column;font-size:10px;color:var(--ink-3)}.ap-pair b{font-size:16px;color:var(--ink)}.ap-carbon b{font-size:18px}.ap-card p{font-size:11px;line-height:1.45;margin:7px 0}.ap-bullets{margin:0;padding-left:17px;font-size:12px;line-height:1.65}.ap-disclosure{grid-column:span 2;display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.ap-disclosure h4{grid-column:1/-1}.ap-disclosure p{margin:0;align-self:center}.ap-rule{margin:10px 0 0!important;background:var(--warn-bg);color:#6b3f00;border-radius:9px;padding:7px 10px;font-weight:700;font-size:12px!important}.ap-proposal footer{text-align:right;font-size:10px;color:var(--ink-3);margin-top:8px}.ap-source{font-size:11px;color:var(--ink-3);margin:8px 0}.ap-source a{color:inherit}
@media(max-width:760px){body:has(.f-adopt-proposal) .panel{width:auto}.ap-tools{grid-template-columns:1fr}.ap-tools .btn{width:100%}.ap-map{height:210px}.ap-grid{grid-template-columns:1fr}.ap-disclosure{grid-column:auto;display:block}.ap-proposal{padding:12px}.ap-proposal-head h3{font-size:21px}.ap-big b{font-size:22px}}
@media print{@page{size:A4 portrait;margin:9mm}html,body{width:auto!important;height:auto!important;overflow:visible!important;background:#fff!important}body>*{display:none!important}body .panel,body .panel-body,body #fp-body,body .f-adopt-proposal,body .ap-result,body .ap-proposal{display:block!important;position:static!important;width:auto!important;height:auto!important;max-width:none!important;overflow:visible!important;margin:0!important;box-shadow:none!important;border:0!important;padding:0!important}.panel-close,.panel-handle,.fpage>h2,.fpage>.eyebrow,.fpage>.tree-sub,.fpage>.alert,.fpage>.fraud,.fpage>.actions,.ap-tools,.ap-areas,.ap-map-wrap,.ap-source{display:none!important}.ap-print-map{display:block!important}.ap-proposal-head{padding-bottom:6px}.ap-proposal-head h3{font-size:21px}.ap-proposal-head img{width:42px;height:42px}.ap-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:7px}.ap-card{padding:7px 9px;break-inside:avoid}.ap-card h4{font-size:11px;margin-bottom:4px}.ap-big b{font-size:20px}.ap-pair{margin:4px 0}.ap-pair b{font-size:14px}.ap-carbon b{font-size:16px}.ap-species{margin-top:4px}.ap-bullets{font-size:10.5px;line-height:1.45}.ap-disclosure{grid-column:span 2;display:grid}.ap-rule{margin-top:6px!important}.ap-proposal footer{margin-top:4px}}
</style>`;

function page(ctx) {
  return `${STYLE}<div class="f-adopt-proposal">
    <div class="ap-tools"><label>提案企業<select data-ap-company>${ctx.COMPANIES.map((company) => `<option value="${company.id}" ${company.id === state.company ? 'selected' : ''}>${ctx.esc(company.name)}</option>`).join('')}</select></label><button class="btn primary" data-ap-print>下載 PDF</button></div>
    <div class="ap-areas" role="group" aria-label="選擇認養區域"><button class="btn on" data-ap-area="dongmen">東門市場街區</button><button class="btn" data-ap-area="heping">和平東路一段</button><button class="btn" data-ap-custom>自己畫矩形</button></div>
    <div class="ap-map-wrap"><div class="ap-map" data-ap-map aria-label="認養區域地圖"></div><div class="ap-draw-tip" data-ap-draw-tip hidden>拖曳地圖畫矩形</div></div>
    <div class="ap-result" data-ap-result><p class="privacy">計算中…</p></div>
    <p class="ap-source">方法：<a href="${SOURCE_URLS.chave}" target="_blank" rel="noopener">Chave 2014</a>・<a href="${SOURCE_URLS.wood}" target="_blank" rel="noopener">Zanne 2009</a>・<a href="${SOURCE_URLS.ipcc}" target="_blank" rel="noopener">IPCC 2006</a></p>
  </div>`;
}

function bindPage(root, ctx) {
  const el = root.querySelector('.f-adopt-proposal');
  if (!el) return;
  initMap(el, ctx);
  el.querySelector('[data-ap-company]').addEventListener('change', (event) => {
    state.company = event.target.value;
    if (state.result) calculate(ctx, state.result.bounds, state.result.label).catch(() => ctx.showToast('提案更新失敗'));
  });
  el.querySelectorAll('[data-ap-area]').forEach((button) => button.addEventListener('click', () => {
    el.querySelectorAll('.ap-areas .btn').forEach((item) => item.classList.toggle('on', item === button));
    setDrawMode(el, ctx, false);
    const area = AREAS[button.dataset.apArea];
    calculate(ctx, area.bounds, area.label).catch(() => ctx.showToast('這個區域暫時算不出來'));
  }));
  el.querySelector('[data-ap-custom]').addEventListener('click', (event) => {
    el.querySelectorAll('.ap-areas .btn').forEach((item) => item.classList.toggle('on', item === event.currentTarget));
    setDrawMode(el, ctx, true);
  });
  el.querySelector('[data-ap-print]').addEventListener('click', () => printProposal(ctx));
  calculate(ctx, AREAS.dongmen.bounds, AREAS.dongmen.label).catch((error) => {
    console.error(ID, error); el.querySelector('[data-ap-result]').innerHTML = '<p class="privacy">試算載入失敗。</p>';
  });
}

function injectEntryLinks(ctx) {
  const add = () => {
    if (ctx.ROLE === 'esg') {
      const nav = document.getElementById('nav');
      if (nav && !nav.querySelector('[data-adopt-proposal-link]')) {
        const link = document.createElement('a'); link.href = '#/f/adopt-proposal'; link.dataset.adoptProposalLink = ''; link.textContent = '認養試算';
        nav.prepend(link);
      }
    }
    const report = document.querySelector('.f-esgr');
    if (report && !report.querySelector('[data-adopt-proposal-link]')) {
      const row = document.createElement('div'); row.className = 'actions'; row.dataset.adoptProposalLink = '';
      row.innerHTML = '<a class="btn sun" href="#/f/adopt-proposal">先試算認養效益</a>';
      report.prepend(row);
    }
  };
  state.observer?.disconnect();
  state.observer = new MutationObserver(add);
  state.observer.observe(document.body, { childList: true, subtree: true });
  add();
}

export default {
  id: ID,
  title: '企業認養效益試算',
  oneLiner: '選一塊區域，當場產出一頁認養提案',
  audience: ['public', 'esg'],
  dataStatus: ['real', 'est', 'sim'],
  maturity: 'exp',
  ready: true,
  demoValue: '企業在認養前就看得到樹木、缺蔭、受益人次、年費與可揭露項目，現場下載一頁提案。',
  problem: '企業認養前看不到範圍與效益，也不知道預算能換來什麼。',
  howto: '選區域，查看試算，下載 PDF。',
  limits: '樹籍為真實資料；遮蔭與碳量為模型推估；人次、企業與單價為模擬。行人資料只含對應捷運站周邊的捷運步行人次。',
  rollout: { agencies: '公園處、研考會', data: '認養範圍、養護單價、逐樹成果', budget: '企業認養費', promo: '企業永續與社區合作' },
  sources: [
    { label: 'Chave et al. 2014 泛熱帶異速式', url: SOURCE_URLS.chave, date: '2014' },
    { label: 'Zanne et al. 2009 Global Wood Density Database', url: SOURCE_URLS.wood, date: '2009' },
    { label: 'IPCC 2006 Guidelines, Volume 4', url: SOURCE_URLS.ipcc, date: '2006' },
  ],
  page,
  bindPage,
  init(ctx) { injectEntryLinks(ctx); },
};
