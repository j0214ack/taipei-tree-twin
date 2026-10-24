// 樹蔭公平排行：各里（或各區）缺蔭程度對照兒童（0–12 歲）與長者（65 歲以上）人口。
// 缺蔭用「登錄樹木密度」當代理指標（不是樹冠覆蓋），公式與權重都寫在畫面上、可以拖滑桿。
import { PROXIES, MODES, DEFAULTS, MIN_DENS, CLASSES, settings, saveSettings, loadEquity, compute } from './equity.js';

const LAYERS = ['eq-fill', 'eq-line', 'eq-dline', 'eq-hl', 'eq-dhl'];
const EMPTY = { type: 'FeatureCollection', features: [] };
let mapReady = false, mapLoading = null, popupOn = false;

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString('zh-TW', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '—');

// ---------- 地圖 ----------
async function paintMap(ctx) {
  const m = ctx.map; if (!m || !m.getSource('eq-v')) return;
  const data = await loadEquity(ctx);
  const s = settings(ctx);
  const res = compute(data, s);
  const by = new Map(res.rows.map((r) => [res.level === 'district' ? r.u.d : r.u.c, r]));
  const feats = data.vg.features.map((f) => {
    const p = f.properties;
    const r = by.get(res.level === 'district' ? p.d : p.c);
    return { type: 'Feature', geometry: f.geometry, properties: { c: p.c, d: p.d, v: p.v, s: r ? Math.round(r.score) : -1, r: r ? r.rank : 0 } };
  });
  m.getSource('eq-v').setData({ type: 'FeatureCollection', features: feats });
  if (!mapReady) m.getSource('eq-d').setData(await ctx.fetchJSON('/data/policy/districts-outline.geojson'));
  mapReady = true;
  const lg = document.getElementById('equity-legend');
  if (lg) lg.querySelector('[data-proxy]').textContent = `${res.level === 'district' ? '區級' : '里級'}｜${res.proxy.short}`;
}
export function refreshMap(ctx) { if (mapReady) paintMap(ctx).catch((e) => console.warn('shade-equity', e)); }

function legendHTML(ctx) {
  const bd = (k, t) => `<i class="badge ${k}" style="display:inline-block;font-style:normal;font-size:11px;padding:0 6px">${t}</i>`;
  return `<b>公平優先分 ${bd('real', '真實')}${bd('est', '推估')}</b>
    ${CLASSES.slice().reverse().map(([, c, l]) => `<span><i class="dot" style="background:${c};border-radius:3px"></i>${l} 分</span>`).join('')}
    <span><i class="dot" style="background:#c9c9c9;border-radius:3px"></i>不排名</span>
    <div data-proxy></div>
    <div>高分＝樹少、老幼多｜<a href="#/f/shade-equity">看排行</a></div>`;
}

function highlight(ctx, level, key) {
  const m = ctx.map; if (!m || !m.getLayer('eq-hl')) return;
  m.setFilter('eq-hl', level === 'village' ? ['==', ['get', 'c'], key] : ['==', ['get', 'c'], '__none__']);
  m.setFilter('eq-dhl', level === 'district' ? ['==', ['get', 'd'], key] : ['==', ['get', 'd'], '__none__']);
}

export function showOnMap(ctx, level, unit) {
  if (!ctx.isOn('shade-equity')) ctx.setFeature('shade-equity', true);
  ctx.S.layers.equity = true;
  ctx.refresh();
  if (unit) {
    highlight(ctx, level, level === 'district' ? unit.d : unit.c);
    const b = unit.bbox;
    ctx.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 15.5, duration: 900 });
  } else {
    highlight(ctx, null, null);
    ctx.map.fitBounds([[121.457, 24.96], [121.666, 25.21]], { padding: 30, duration: 900 });
  }
  ctx.S.homeShown = true;
  ctx.go('#/');
}

// ---------- 獨立頁 ----------
function controlsHTML(ctx, s) {
  const lv = s.level === 'district' ? 'district' : 'village';
  const pk = lv === 'district' ? s.proxyD : s.proxyV;
  const opts = Object.entries(PROXIES).filter(([, p]) => (lv === 'district' ? p.dist : p.vil))
    .map(([k, p]) => `<option value="${k}" ${k === pk ? 'selected' : ''}>${ctx.esc(p.label)}</option>`).join('');
  const sl = (k, label) => `<label><span>${label}</span><input type="range" min="0" max="100" step="5" data-w="${k}" value="${s.w[k]}" aria-label="${label}權重"><b data-wv="${k}">${s.w[k]}</b></label>`;
  return `<div class="eq-ctl">
    <div class="eq-seg" role="group" aria-label="比較層級">
      <button class="btn mini ${lv === 'village' ? 'primary' : ''}" data-level="village" aria-pressed="${lv === 'village'}">里（456 個）</button>
      <button class="btn mini ${lv === 'district' ? 'primary' : ''}" data-level="district" aria-pressed="${lv === 'district'}">行政區（12 個）</button>
    </div>
    <label class="eq-row"><span>缺蔭指標</span><select data-proxy>${opts}</select></label>
    <label class="eq-row"><span>老幼算法</span><select data-mode>${Object.entries(MODES).map(([k, m]) => `<option value="${k}" ${k === s.mode ? 'selected' : ''}>${ctx.esc(m.label)}</option>`).join('')}</select></label>
    <div class="sliders">${sl('gap', '缺蔭')}${sl('kid', '兒童 0–12 歲')}${sl('old', '長者 65 歲以上')}</div>
    ${lv === 'village' ? `<label class="eq-chk"><input type="checkbox" data-mindens ${s.minDens ? 'checked' : ''}> 排除每 km² 不到 ${MIN_DENS.toLocaleString()} 人的里</label>` : ''}
    <div class="actions"><button class="btn mini" data-reset>重設權重</button><button class="btn mini primary" data-map>看地圖</button></div>
  </div>`;
}

function formulaHTML(ctx, res, s) {
  const W = s.w, sum = W.gap + W.kid + W.old || 1;
  const p = (x) => Math.round((x / sum) * 100);
  return `<details class="eq-formula" open><summary>公式</summary>
    <p><b>優先分</b>＝缺蔭×${p(W.gap)}%＋兒童×${p(W.kid)}%＋長者×${p(W.old)}%（百分位，0–100）</p>
    <ul>
      <li>缺蔭：${ctx.esc(res.proxy.label)}</li>
      <li>老幼：${ctx.esc(MODES[s.mode].label)}</li>
    </ul></details>`;
}

function tableHTML(ctx, res, s, all) {
  const rows = all ? res.rows : res.rows.slice(0, res.level === 'district' ? 12 : 30);
  const mf = MODES[s.mode].fmt;
  const body = rows.map((r) => `<tr data-k="${ctx.esc(res.level === 'district' ? r.u.d : r.u.c)}">
      <td>${r.rank}</td>
      <td><b>${ctx.esc(res.level === 'district' ? r.u.d : r.u.v)}</b>${res.level === 'district' ? '' : `<br><small>${ctx.esc(r.u.d)}</small>`}</td>
      <td>${fmt(r.proxy)}<br><small>${ctx.esc(res.proxy.unit)}</small></td>
      <td>${mf(r.u.k, r.u.p, r.u.a)}<br><small>${r.u.k.toLocaleString()} 人</small></td>
      <td>${mf(r.u.e, r.u.p, r.u.a)}<br><small>${r.u.e.toLocaleString()} 人</small></td>
      <td><b>${Math.round(r.score)}</b>${ctx.bar(r.score, 100, CLASSES[Math.min(4, Math.floor(r.score / 20))][1])}</td>
      <td><button class="btn mini" data-fly="${ctx.esc(res.level === 'district' ? r.u.d : r.u.c)}" aria-label="在地圖上看${ctx.esc(r.u.name || r.u.d)}">地圖</button></td>
    </tr>`).join('');
  const more = res.rows.length > rows.length ? `<button class="btn mini" data-all>顯示全部 ${res.rows.length} 個</button>` : '';
  return `<div class="eq-tablewrap"><table class="track eq-table">
    <thead><tr><th>名次</th><th>${res.level === 'district' ? '行政區' : '里'}</th><th>缺蔭代理</th><th>兒童</th><th>長者</th><th>優先分</th><th></th></tr></thead>
    <tbody>${body}</tbody></table></div>
    <div class="actions">${more}</div>
    ${res.excluded.length ? `<p class="privacy">未排名 ${res.excluded.length} 里：${res.excluded.slice(0, 12).map((u) => ctx.esc(u.name)).join('、')}${res.excluded.length > 12 ? '…' : ''}</p>` : ''}`;
}

function summaryHTML(ctx, res, data) {
  const n = res.level === 'district' ? 3 : 20;
  const top = res.rows.slice(0, n);
  const kids = top.reduce((a, r) => a + r.u.k, 0), olds = top.reduce((a, r) => a + r.u.e, 0);
  const allK = data.districts.reduce((a, d) => a + d.k, 0), allE = data.districts.reduce((a, d) => a + d.e, 0);
  return `<div class="facts">
    <div class="fact"><b>${ctx.esc(top.slice(0, 3).map((r) => (res.level === 'district' ? r.u.d : r.u.v)).join('、'))}</b><span>前三名</span></div>
    <div class="fact"><b>${kids.toLocaleString()}</b><span>前 ${n} 名兒童（全市 ${(kids / allK * 100).toFixed(0)}%）</span></div>
    <div class="fact"><b>${olds.toLocaleString()}</b><span>前 ${n} 名長者（全市 ${(olds / allE * 100).toFixed(0)}%）</span></div>
  </div>`;
}

const STYLE = `<style>
.f-shade-equity .eq-ctl { background: var(--paper); border-radius: 12px; padding: 12px; margin: 12px 0; display: grid; gap: 10px; }
.f-shade-equity .eq-seg { display: flex; gap: 6px; flex-wrap: wrap; }
.f-shade-equity .eq-row { display: grid; gap: 4px; font-size: 13px; color: var(--ink-2); }
.f-shade-equity .eq-row select { padding: 7px 8px; border-radius: 10px; border: 1px solid var(--line); background: #fff; font-size: 13px; max-width: 100%; }
.f-shade-equity .eq-chk { font-size: 12px; color: var(--ink-2); display: flex; gap: 6px; align-items: flex-start; }
.f-shade-equity .sliders label { grid-template-columns: 7.5em 1fr 28px; }
.f-shade-equity .eq-formula { font-size: 13px; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin: 10px 0; }
.f-shade-equity .eq-formula summary { cursor: pointer; font-weight: 700; color: var(--forest); }
.f-shade-equity .eq-formula ul { padding-left: 1.2em; margin: 6px 0 0; }
.f-shade-equity .eq-formula li { margin: 3px 0; }
.f-shade-equity .eq-tablewrap { overflow-x: auto; margin: 0 -4px; }
.f-shade-equity .eq-table td, .f-shade-equity .eq-table th { padding-left: 3px; padding-right: 3px; }
.f-shade-equity .eq-table .bar { display: block; width: 52px; }
.f-shade-equity .facts .fact b { font-size: 16px; line-height: 1.3; }
.f-shade-equity .eq-note { font-size: 12px; color: var(--ink-3); }
</style>`;

async function page(ctx) {
  const data = await loadEquity(ctx);
  return `${STYLE}<div class="f-shade-equity">
    <p class="eq-note">${ctx.badge('real')}${ctx.badge('est')} 來源：民政局人口（${ctx.esc(data.period)}）、公園處樹籍</p>
    <div data-ctl></div>
    <div data-sum></div>
    <div data-formula></div>
    <h3 class="h3" data-title></h3>
    <div data-table></div>
  </div>`;
}

function bindPage(root, ctx) {
  let all = false;
  const render = async () => {
    const s = settings(ctx);
    const data = await loadEquity(ctx);
    const res = compute(data, s);
    root.querySelector('[data-ctl]').innerHTML = controlsHTML(ctx, s);
    root.querySelector('[data-sum]').innerHTML = summaryHTML(ctx, res, data);
    root.querySelector('[data-formula]').innerHTML = formulaHTML(ctx, res, s);
    root.querySelector('[data-title]').textContent = `排行：${res.level === 'district' ? '12 區' : `${res.rows.length} 里`}`;
    root.querySelector('[data-table]').innerHTML = tableHTML(ctx, res, s, all);
    root._res = res;
  };
  const update = (fn) => { const s = settings(ctx); fn(s); saveSettings(ctx, s); render().then(() => refreshMap(ctx)); };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.level) { all = false; update((s) => { s.level = b.dataset.level; }); }
    else if (b.hasAttribute('data-reset')) update((s) => { s.w = { ...DEFAULTS.w }; });
    else if (b.hasAttribute('data-all')) { all = true; render(); }
    else if (b.hasAttribute('data-map')) showOnMap(ctx, null, null);
    else if (b.dataset.fly) {
      const res = root._res; if (!res) return;
      const r = res.rows.find((x) => (res.level === 'district' ? x.u.d : x.u.c) === b.dataset.fly);
      if (r) showOnMap(ctx, res.level, r.u);
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-proxy]')) update((s) => { if (s.level === 'district') s.proxyD = t.value; else s.proxyV = t.value; });
    else if (t.matches('[data-mode]')) update((s) => { s.mode = t.value; });
    else if (t.matches('[data-mindens]')) update((s) => { s.minDens = t.checked; });
    else if (t.matches('[data-w]')) update((s) => { s.w[t.dataset.w] = +t.value; });
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-w]')) { const v = root.querySelector(`[data-wv="${t.dataset.w}"]`); if (v) v.textContent = t.value; }
  });
  render().catch((e) => { console.error(e); root.innerHTML = '<p class="privacy">載入失敗</p>'; });
}

// ---------- manifest ----------
export default {
  id: 'shade-equity',
  title: '樹蔭公平排行',
  oneLiner: '哪裡最缺樹、老幼最多',
  audience: ['mayor', 'gov', 'plan'],
  dataStatus: ['real', 'est'],
  maturity: 'stable',
  ready: true,
  demoValue: '補樹的錢先給誰：456 個里一張排行，權重拖給議會看',
  problem: '補種常照「哪裡有空位」排，沒有看誰最需要樹蔭；兒童、長者對高溫最敏感，但樹蔭分配從沒跟他們住在哪裡對照過。',
  howto: '選比較層級（里或區）與缺蔭代理指標，拖三個權重滑桿，排行即時重排；按「在地圖上看面量圖」或任一列的「地圖」，地圖會開「樹蔭公平」圖層並飛到該處。點地圖上的里看名次。',
  limits: '缺蔭是「登錄樹木密度」代理指標，不是樹冠覆蓋或實際遮蔭；只含公園處登錄的行道樹與公園樹（不含校園、私有地、植物園、山區林地）；行道樹多在里界道路上、只算進一側的里，小里會偏低；人口是戶籍人口、只有年齡沒有所得；每公里人行道樹數只有區級；百分位是相對排名；里界經簡化，只適合面量圖。',
  rollout: {
    agencies: '研考會（定公平指標與權重）、公園處（補植排序）、民政局（人口）、都發局（航照樹冠）',
    data: '分里樹冠覆蓋率（航照或光達）、分里夏季地表溫度、分里經濟弱勢指標、人行道分里長度',
    budget: '情境試算：指標維護約 0.5 人月／年；樹冠圖若委外判釋約數十萬元（未詢價）',
    promo: '每年公布一次里級排行與權重，請議會與里長公開討論權重；補植預算依排行分配並公開',
  },
  sources: [
    { label: '臺北市各里人口數按年齡分（民政局，用 2026 年 9 月）', url: 'https://data.taipei/dataset/detail?id=a6394e3f-3514-4542-87bd-de4310a40db3', date: '2026-10-23 下載' },
    { label: '村里界圖 TWD97 經緯度（內政部國土測繪中心，VILLAGE_NLSC_1150817）', url: 'https://data.gov.tw/dataset/7438', date: '2026-10-23 下載' },
    { label: '臺北市行道樹及公園樹木分布圖（公園處）', url: 'https://data.gov.tw/dataset/128274', date: '2026-10-13 下載' },
    { label: '臺北市人行道範圍圖（每公里人行道樹數的分母）', url: 'https://data.taipei/dataset/detail?id=715d3a83-8445-4496-b6bf-b0900538b7e7', date: '2026-10-13 下載' },
    { label: '授權：政府資料開放授權條款第 1 版', url: 'https://data.gov.tw/license', date: '' },
  ],
  chipDefs: { equity: { label: '樹蔭公平', dot: '#e34a33' } },
  chips: ['equity'],
  page,
  bindPage,
  async init(ctx) {
    const m = ctx.map; if (!m || m.getSource('eq-v')) return;
    m.addSource('eq-v', { type: 'geojson', data: EMPTY });
    m.addSource('eq-d', { type: 'geojson', data: EMPTY });
    const before = m.getLayer('wo-fill') ? 'wo-fill' : m.getLayer('trees-park') ? 'trees-park' : undefined;
    const color = ['step', ['get', 's'], '#c9c9c9', 0, CLASSES[0][1], 20, CLASSES[1][1], 40, CLASSES[2][1], 60, CLASSES[3][1], 80, CLASSES[4][1]];
    m.addLayer({ id: 'eq-fill', type: 'fill', source: 'eq-v', layout: { visibility: 'none' },
      paint: { 'fill-color': color, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.62, 15, 0.38, 17, 0.2] } }, before);
    m.addLayer({ id: 'eq-line', type: 'line', source: 'eq-v', minzoom: 12, layout: { visibility: 'none' }, paint: { 'line-color': '#7a3b2e', 'line-width': 0.5, 'line-opacity': 0.5 } }, before);
    m.addLayer({ id: 'eq-dline', type: 'line', source: 'eq-d', layout: { visibility: 'none' }, paint: { 'line-color': '#3b2a24', 'line-width': 1.4, 'line-opacity': 0.7 } }, before);
    m.addLayer({ id: 'eq-hl', type: 'line', source: 'eq-v', filter: ['==', ['get', 'c'], '__none__'], layout: { visibility: 'none' }, paint: { 'line-color': '#1f3d2b', 'line-width': 3.5 } }, before);
    m.addLayer({ id: 'eq-dhl', type: 'line', source: 'eq-d', filter: ['==', ['get', 'd'], '__none__'], layout: { visibility: 'none' }, paint: { 'line-color': '#1f3d2b', 'line-width': 3.5 } }, before);
    // 圖例放在圖層卡裡（沿用既有圖例樣式）
    const anchor = document.getElementById('plant-legend');
    if (anchor && !document.getElementById('equity-legend')) {
      const lg = document.createElement('div');
      lg.className = 'plant-legend'; lg.id = 'equity-legend'; lg.hidden = true;
      lg.innerHTML = legendHTML(ctx);
      anchor.after(lg);
    }
    if (!popupOn) {
      popupOn = true;
      m.on('click', 'eq-fill', (e) => {
        // 點到樹、推薦點等時讓原本的點擊處理，不跳里的資訊
        const p = e.point;
        const hit = m.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]]).some((f) => /^(trees-|plant$|shade$|planters$|dongmen)/.test(f.layer.id));
        if (hit) return;
        const f = e.features && e.features[0]; if (!f) return;
        const q = f.properties, s = settings(ctx);
        const lvName = s.level === 'district' ? q.d : `${q.d}${q.v}`;
        const html = `<div style="font-size:13px;line-height:1.5"><b>${ctx.esc(lvName)}</b><br>${q.s < 0 ? '不排名' : `優先分 <b>${ctx.esc(q.s)}</b>｜第 ${ctx.esc(q.r)} 名`}<br><a href="#/f/shade-equity">看排行</a></div>`;
        new maplibregl.Popup({ closeButton: true, maxWidth: '240px' }).setLngLat(e.lngLat).setHTML(html).addTo(m);
      });
    }
  },
  apply(ctx, layers, on) {
    const m = ctx.map; if (!m || !m.getLayer('eq-fill')) return;
    const vis = !!(on && layers.equity);
    for (const id of LAYERS) m.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none');
    const lg = document.getElementById('equity-legend'); if (lg) lg.hidden = !vis;
    if (vis && !mapReady && !mapLoading) {
      mapLoading = paintMap(ctx).catch((e) => { console.warn('shade-equity', e); ctx.showToast('樹蔭公平圖層載入失敗'); }).finally(() => { mapLoading = null; });
    }
  },
};
