// 行人逐時曝曬：捷運站周邊 500 公尺的人行路段，07–19 時每小時「推估走過的人次 × 遮蔭比例 → 曬到太陽的人次」。
// 資料由 wt/ped-flow-sim 產生（research/15-pedestrian-flow-sim.md），複製在 /data/ped-exposure/。
// 載入規則：首屏什麼都不抓；打開圖層或獨立頁才抓 index.json（約 30 KB）；選了站才抓那一站的檔（53–485 KB）。

const ID = 'ped-exposure';
const KEY = 'pedexp';
const BASE = '/data/ped-exposure/';
const SRC = 'pedexp', SRC_ST = 'pedexp-st', SRC_RING = 'pedexp-ring';
const LAYERS = ['pedexp-ring', 'pedexp-line', 'pedexp-st'];
const EMPTY = { type: 'FeatureCollection', features: [] };
// 台北車站一帶：地下街與站內轉乘，模型最可能高估（research/15 驗證第 2 點）
const HIGH = new Set(['台北車站', '台大醫院', '善導寺', '北門', '西門']);
// 色階照 out/web/README.md（0 淺灰，1–25 … 400 以上深褐）
const STEPS = [[0, '#e3e1dc', '0'], [1, '#fbd5c0', '1–25'], [25, '#f5a77f', '25–50'], [50, '#ef8452', '50–100'], [100, '#eb6834', '100–200'], [200, '#b9431a', '200–400'], [400, '#7a2a0e', '400 以上']];
const WARN_LEGEND = '模擬下限，只適合排序；台北車站一帶可能高估';
const WARN_SHORT = '模擬下限×推估遮蔭，只適合排序；台北車站一帶可能高估';

const st = { idx: null, idxP: null, station: null, h: 1, cache: new Map(), gj: null, stP: null, bound: false, rank: 'hour', all: false };
let CTX = null;

const hourLabel = (h) => `${String(7 + h).padStart(2, '0')}:00–${String(8 + h).padStart(2, '0')}:00`;
const n0 = (v) => (Number.isFinite(+v) ? Math.round(+v).toLocaleString('zh-TW') : '—');
const stn = (name) => (String(name).endsWith('站') ? String(name) : `${name}站`); // 台北車站不要變「台北車站站」
const sum = (a) => a.reduce((x, y) => x + y, 0);
const arr = (v) => (typeof v === 'string' ? JSON.parse(v) : v || []);

function remember(ctx) { try { ctx.store.set('pedexp', { station: st.station, h: st.h }); } catch {} }
function recall(ctx) {
  try { const v = ctx.store.get('pedexp', null); if (v) { if (Number.isInteger(v.h) && v.h >= 0 && v.h <= 11) st.h = v.h; if (typeof v.station === 'string') st.station = v.station; } } catch {}
}

function expColor(h) {
  // 用載入時攤平的 e0…e11（MapLibre 查詢時會把陣列屬性變成字串，['at'] 會噴警告）
  const e = ['step', ['coalesce', ['get', 'e' + h], 0], STEPS[0][1]];
  for (const [v, c] of STEPS.slice(1)) e.push(v, c);
  return e;
}

// ---------- 資料 ----------
function loadIndex(ctx) {
  if (!st.idxP) {
    st.idxP = ctx.fetchJSON(BASE + 'index.json').then((d) => {
      if (!d || !Array.isArray(d.areas)) throw new Error('index.json 格式不符');
      st.idx = d;
      if (st.station && !d.areas.some((a) => a.station === st.station)) st.station = null;
      paintStations(ctx); fillSelects(ctx);
      return d;
    }).catch((e) => { st.idxP = null; throw e; });
  }
  return st.idxP;
}
const areaOf = (name) => st.idx && st.idx.areas.find((a) => a.station === name);

async function loadStation(ctx, name) {
  await loadIndex(ctx);
  const a = areaOf(name); if (!a) throw new Error('找不到站：' + name);
  if (st.cache.has(name)) return st.cache.get(name);
  const gj = await ctx.fetchJSON(BASE + encodeURIComponent(a.file)); // 一律用 index.json 的 file 欄位
  for (const f of gj.features || []) { const q = f.properties || {}; (q.e || []).forEach((v, i) => { q['e' + i] = v; }); }
  st.cache.set(name, gj);
  if (st.cache.size > 4) st.cache.delete(st.cache.keys().next().value);
  return gj;
}

function ringOf(a) {
  const [lng, lat] = a.center, r = a.radius_m || 500, pts = [];
  for (let k = 0; k <= 64; k++) {
    const t = (k / 64) * Math.PI * 2;
    pts.push([lng + (r * Math.cos(t)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.sin(t)) / 110574]);
  }
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} };
}
function boundsOf(a) {
  const [lng, lat] = a.center, r = (a.radius_m || 500) * 1.05;
  const dx = r / (111320 * Math.cos((lat * Math.PI) / 180)), dy = r / 110574;
  return [[lng - dx, lat - dy], [lng + dx, lat + dy]];
}

// ---------- 地圖 ----------
function paintStations(ctx) {
  const m = ctx.map; if (!m || !m.getSource(SRC_ST) || !st.idx) return;
  m.getSource(SRC_ST).setData({ type: 'FeatureCollection', features: st.idx.areas.map((a) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: a.center },
    properties: { name: a.station, sel: a.station === st.station ? 1 : 0 },
  })) });
}

function paintHour(ctx) {
  const m = ctx.map;
  if (m && m.getLayer('pedexp-line')) {
    m.setPaintProperty('pedexp-line', 'line-color', expColor(st.h));
    m.setLayoutProperty('pedexp-line', 'line-sort-key', ['coalesce', ['get', 'e' + st.h], 0]);
  }
  document.querySelectorAll('[data-pe-h]').forEach((el) => { if (+el.value !== st.h) el.value = st.h; });
  document.querySelectorAll('[data-pe-hlabel]').forEach((el) => { el.textContent = hourLabel(st.h); });
}

// 選站：只抓這一站的檔；fit＝true 時把地圖移過去
async function showStation(ctx, name, fit) {
  st.station = name; remember(ctx);
  fillSelects(ctx); paintStations(ctx); setStatus('載入中…');
  const p = st.stP = loadStation(ctx, name);
  let gj;
  try { gj = await p; } catch (e) { if (st.stP === p) st.stP = null; console.warn(ID, e); setStatus('載入失敗'); ctx.showToast('行人曝曬資料載入失敗，稍後再試'); return null; }
  if (st.stP !== p) return null; // 中途又換站
  st.gj = gj;
  const m = ctx.map, a = areaOf(name);
  if (m && m.getSource(SRC)) { m.getSource(SRC).setData(gj); m.getSource(SRC_RING).setData({ type: 'FeatureCollection', features: [ringOf(a)] }); }
  setStatus(`${stn(name)}周邊 ${a.radius_m || 500} 公尺，${n0(a.segments)} 段路`);
  if (fit && m) m.fitBounds(boundsOf(a), { padding: fitPadding(m), maxZoom: 16.5, duration: 900 });
  return gj;
}

// 避開左上的圖層卡（手機在上方、桌機在左側），站圈才不會被圖例蓋住
function fitPadding(m) {
  const pad = { top: 40, bottom: 40, left: 40, right: 40 };
  try {
    const mr = m.getContainer().getBoundingClientRect(), card = document.getElementById('layers');
    const cr = card && !card.hidden ? card.getBoundingClientRect() : null;
    if (innerWidth <= 760) { Object.assign(pad, { left: 12, right: 12, bottom: 16, top: 16 }); if (cr && cr.height) pad.top = Math.max(16, Math.min(cr.bottom - mr.top + 8, mr.height - 200)); }
    else if (cr && cr.width) pad.left = Math.max(40, Math.min(cr.right - mr.left + 20, mr.width - 300));
  } catch {}
  return pad;
}

function setStatus(t) { document.querySelectorAll('[data-pe-status]').forEach((el) => { el.textContent = t; }); }

function optionsHTML(ctx) {
  if (!st.idx) return '<option value="">站清單載入中…</option>';
  const list = st.idx.areas.slice().sort((a, b) => a.station.localeCompare(b.station, 'zh-Hant'));
  return `<option value="">選捷運站</option>${list.map((a) => `<option value="${ctx.esc(a.station)}" ${a.station === st.station ? 'selected' : ''}>${ctx.esc(a.station)}${HIGH.has(a.station) ? '（可能高估）' : ''}</option>`).join('')}`;
}
function fillSelects(ctx) {
  document.querySelectorAll('select[data-pe-station]').forEach((s) => {
    if (s.dataset.filled !== '1' && st.idx) { s.innerHTML = optionsHTML(ctx); s.dataset.filled = '1'; s.disabled = false; }
    s.value = st.station || '';
  });
}

export function showOnMap(ctx, name) {
  if (!ctx.isOn(ID)) ctx.setFeature(ID, true);
  ctx.S.layers[KEY] = true;
  ctx.refresh();
  ctx.S.homeShown = true;
  ctx.go('#/');
  // 等 hashchange 把側欄收起、圖層卡展開後再算邊距
  if (name) setTimeout(() => showStation(ctx, name, true), 120);
}

function legendHTML(ctx) {
  const sw = STEPS.map(([, c, l]) => `<span class="pe-sw"><i style="background:${c}"></i>${ctx.esc(l)}</span>`).join('');
  return `<style>
#pedexp-legend .pe-sel { width: 100%; padding: 5px 6px; border-radius: 8px; border: 1px solid var(--line); background: #fff; font-size: 12px; }
#pedexp-legend .pe-hour { display: grid; grid-template-columns: 6.6em 1fr; gap: 6px; align-items: center; }
#pedexp-legend .pe-hour input { width: 100%; }
#pedexp-legend .pe-scale { display: flex; flex-wrap: wrap; gap: 2px 8px; }
#pedexp-legend .pe-sw { display: inline-flex; gap: 4px; align-items: center; font-size: 11px; }
#pedexp-legend .pe-sw i { width: 16px; height: 5px; border-radius: 2px; display: inline-block; }
#pedexp-legend .pe-warn { display: block; background: #fff6e5; border-radius: 6px; padding: 4px 6px; color: #6b4a00; line-height: 1.45; }
#pedexp-legend .pe-status { color: var(--ink-3); }
#pedexp-legend .badge { display: inline-block; font-size: 10px; padding: 0 5px; vertical-align: 1px; }
#pedexp-legend .pe-meta { display: block; line-height: 1.6; }
@media (max-width: 760px) {
  #pedexp-legend .pe-scale { gap: 1px 6px; }
  #pedexp-legend .pe-sw { font-size: 10px; gap: 3px; }
  #pedexp-legend .pe-sw i { width: 10px; }
}
</style>
    <b>每小時曬到的人次 ${ctx.badge('sim')}</b>
    <select class="pe-sel" data-pe-station aria-label="選捷運站" disabled>${optionsHTML(ctx)}</select>
    <label class="pe-hour"><b data-pe-hlabel>${hourLabel(st.h)}</b><input type="range" min="0" max="11" step="1" value="${st.h}" data-pe-h aria-label="時段（07–18 時）"></label>
    <div class="pe-scale">${sw}</div>
    <span class="pe-status" data-pe-status>點白點或選站</span>
    <span class="pe-warn">${ctx.esc(WARN_LEGEND)}</span>
    <span class="pe-meta">人次 ${ctx.badge('sim')} 遮蔭 ${ctx.badge('est')} 捷運進出站 ${ctx.badge('real')}・© OpenStreetMap・<a href="#/f/ped-exposure">排行</a></span>`;
}

function bindControls(ctx, root) {
  if (!root || root.dataset.peBound === '1') return;
  root.dataset.peBound = '1';
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches && t.matches('[data-pe-h]')) { st.h = Math.max(0, Math.min(11, +t.value || 0)); remember(CTX || ctx); paintHour(CTX || ctx); onHourChange(); }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches && t.matches('select[data-pe-station]') && t.value) {
      const c = CTX || ctx;
      const onMap = !!(c.isOn(ID) && c.S.layers[KEY]) && !t.closest('.f-ped-exposure');
      showStation(c, t.value, onMap).then(() => onStationChange());
    }
  });
}

// 獨立頁開著時，換時段／換站要重畫頁面內容（由 bindPage 註冊）
let pageRender = null;
function onHourChange() { if (pageRender) pageRender(); }
function onStationChange() { if (pageRender) pageRender(); }

function popupHTML(ctx, q) {
  const h = st.h, p = arr(q.p)[h], s = arr(q.s)[h], t = arr(q.t)[h], e = arr(q.e)[h];
  return `<div style="font-size:13px;line-height:1.55;max-width:240px">
    <b>${ctx.esc(q.n || '（無路名路段）')}</b>（約 ${n0(q.len)} 公尺）<br>
    ${hourLabel(h)}：走過 <b>${n0(p)}</b> 人次・遮蔭 ${n0(s)}%・樹影 ${n0(t)}%・曬到 <b>${n0(e)}</b> 人次 ${ctx.badge('sim')}</div>`;
}

// ---------- 獨立頁 ----------
const STYLE = `<style>
.f-ped-exposure .pe-ctl { background: var(--paper); border-radius: 12px; padding: 12px; margin: 12px 0; display: grid; gap: 10px; }
.f-ped-exposure .pe-row { display: grid; gap: 4px; font-size: 13px; color: var(--ink-2); }
.f-ped-exposure .pe-row select { padding: 8px; border-radius: 10px; border: 1px solid var(--line); background: #fff; font-size: 14px; max-width: 100%; }
.f-ped-exposure .pe-hour { display: grid; grid-template-columns: 7.5em 1fr; gap: 8px; align-items: center; font-size: 13px; }
.f-ped-exposure .pe-hour input { width: 100%; }
.f-ped-exposure .pe-note { font-size: 12px; color: var(--ink-3); display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
.f-ped-exposure .pe-hours { display: grid; grid-template-columns: repeat(12, 1fr); gap: 3px; align-items: end; height: 88px; margin: 10px 0 2px; }
.f-ped-exposure .pe-hours button { border: 0; padding: 0; background: #f0c8b2; border-radius: 3px 3px 0 0; cursor: pointer; min-height: 2px; }
.f-ped-exposure .pe-hours button.on { background: #b9431a; }
.f-ped-exposure .pe-hlab { display: grid; grid-template-columns: repeat(12, 1fr); gap: 3px; font-size: 10px; color: var(--ink-3); text-align: center; }
.f-ped-exposure .pe-seg { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 8px; }
.f-ped-exposure .pe-rank { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
.f-ped-exposure .pe-rank li { display: grid; grid-template-columns: 2em 1fr auto; gap: 4px 8px; align-items: center; padding: 6px 8px; border-radius: 10px; background: #fff; border: 1px solid var(--line); font-size: 13px; }
.f-ped-exposure .pe-rank li.on { border-color: var(--forest); background: #eef4ee; }
.f-ped-exposure .pe-rank .pe-n { color: var(--ink-3); text-align: right; }
.f-ped-exposure .pe-rank .pe-v { grid-column: 2; font-size: 12px; color: var(--ink-2); }
.f-ped-exposure .pe-rank .pe-v .bar { display: block; max-width: 180px; }
.f-ped-exposure .pe-rank .pe-act { grid-column: 3; grid-row: 1 / span 2; display: flex; gap: 4px; }
.f-ped-exposure .pe-tag { font-size: 11px; color: #8a4b00; background: #fff1d6; border-radius: 6px; padding: 0 5px; margin-left: 4px; white-space: nowrap; }
.f-ped-exposure .pe-roads { margin: 6px 0 0; padding-left: 1.3em; font-size: 13px; }
.f-ped-exposure .pe-roads li { margin: 3px 0; }
.f-ped-exposure details.pe-more { font-size: 13px; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; margin: 10px 0; }
.f-ped-exposure details.pe-more summary { cursor: pointer; font-weight: 700; color: var(--forest); }
.f-ped-exposure details.pe-more ol, .f-ped-exposure details.pe-more ul { padding-left: 1.3em; margin: 6px 0 0; }
.f-ped-exposure details.pe-more li { margin: 4px 0; }
.f-ped-exposure .facts .fact b { font-size: 18px; line-height: 1.3; }
</style>`;

function rankRows() {
  const h = st.h;
  const val = (a) => (st.rank === 'hour' ? a.exp_person_min[h] : st.rank === 'day' ? sum(a.exp_person_min) : (a.sun_share_0719 ?? 0) * 100);
  return st.idx.areas.map((a) => ({ a, v: val(a) })).sort((x, y) => y.v - x.v);
}

function rankHTML(ctx) {
  const rows = rankRows(), max = rows[0] ? rows[0].v || 1 : 1;
  const shown = st.all ? rows : rows.slice(0, 15);
  const unit = st.rank === 'share' ? '%' : ' 人·分鐘';
  const items = shown.map((r, i) => `<li class="${r.a.station === st.station ? 'on' : ''}">
      <span class="pe-n">${i + 1}</span>
      <span><b>${ctx.esc(r.a.station)}</b>${HIGH.has(r.a.station) ? '<span class="pe-tag">可能高估</span>' : ''}</span>
      <span class="pe-act"><button class="btn mini" data-pe-pick="${ctx.esc(r.a.station)}" aria-label="看${ctx.esc(r.a.station)}的逐時">看</button><button class="btn mini primary" data-pe-fly="${ctx.esc(r.a.station)}" aria-label="在地圖上看${ctx.esc(r.a.station)}">地圖</button></span>
      <span class="pe-v">${n0(r.v)}${ctx.esc(i === 0 ? unit : st.rank === 'share' ? '%' : '')}${ctx.bar(r.v, max, '#eb6834')}</span>
    </li>`).join('');
  return `<ol class="pe-rank">${items}</ol>
    ${rows.length > shown.length ? `<div class="actions"><button class="btn mini" data-pe-all>顯示全部 ${rows.length} 站</button></div>` : ''}`;
}

function roadsOf(gj, h) {
  const by = new Map();
  for (const f of gj.features) {
    const q = f.properties, e = (q.e || [])[h] || 0; if (!e) continue;
    const k = q.n || '（無路名路段）';
    const r = by.get(k) || { n: k, pm: 0, peak: 0 };
    r.pm += (e * (q.len || 0)) / 1.2 / 60; // 曬到的人·分鐘＝人次×段長÷步速 1.2 m/s
    r.peak = Math.max(r.peak, e);
    by.set(k, r);
  }
  return [...by.values()].sort((a, b) => b.pm - a.pm).slice(0, 5);
}

function detailHTML(ctx) {
  const a = st.station && areaOf(st.station);
  if (!a) return '<p class="privacy">先選一個站</p>';
  const em = a.exp_person_min, mx = Math.max(...em, 1);
  const bars = em.map((v, i) => `<button class="${i === st.h ? 'on' : ''}" style="height:${Math.max(2, Math.round((v / mx) * 100))}%" data-pe-sethour="${i}" aria-label="${hourLabel(i)} 曬到 ${n0(v)} 人·分鐘" title="${hourLabel(i)}：${n0(v)} 人·分鐘"></button>`).join('');
  const labs = em.map((_, i) => `<span>${7 + i}</span>`).join('');
  const gj = st.cache.get(a.station);
  const roads = gj ? roadsOf(gj, st.h) : null;
  return `<h3 class="h3">${ctx.esc(stn(a.station))}周邊 ${n0(a.radius_m || 500)} 公尺${HIGH.has(a.station) ? '<span class="pe-tag">可能高估</span>' : ''}</h3>
    <div class="facts">
      <div class="fact"><b>${Number.isFinite(a.peak_hour) ? `${a.peak_hour} 時` : '—'}</b><span>最曬時段</span></div>
      <div class="fact"><b>${a.sun_share_0719 != null ? Math.round(a.sun_share_0719 * 100) + '%' : '—'}</b><span>07–19 曬路比例</span></div>
      <div class="fact"><b>${n0(em[st.h])}</b><span>${hourLabel(st.h)} 曬到人·分鐘</span></div>
    </div>
    <div class="pe-hours" role="group" aria-label="各時段曬到的人·分鐘（點一下換時段）">${bars}</div>
    <div class="pe-hlab">${labs}</div>
    <b style="font-size:13px">${hourLabel(st.h)} 最曬的路名</b>
    ${roads ? (roads.length ? `<ol class="pe-roads">${roads.map((r) => `<li><b>${ctx.esc(r.n)}</b>：${n0(r.pm)} 人·分鐘・最曬段 ${n0(r.peak)} 人次／時</li>`).join('')}</ol>` : '<p class="privacy">此時段無曬到路段</p>') : '<p class="privacy">載入中…</p>'}
    <div class="actions"><button class="btn primary" data-pe-fly="${ctx.esc(a.station)}">地圖看${ctx.esc(stn(a.station))}</button></div>`;
}

async function page(ctx) {
  CTX = ctx; recall(ctx);
  const idx = await loadIndex(ctx);
  return `${STYLE}<div class="f-ped-exposure">
    <div class="alert warn"><p>${ctx.esc(WARN_SHORT)}</p></div>
    <p class="pe-note">${ctx.badge('real')} 進出站 ${ctx.badge('sim')} 人次 ${ctx.badge('est')} 遮蔭</p>
    <div class="pe-ctl">
      <label class="pe-row"><span>捷運站・${n0(idx.areas.length)} 站</span><select data-pe-station>${optionsHTML(ctx)}</select></label>
      <label class="pe-hour"><b data-pe-hlabel>${hourLabel(st.h)}</b><input type="range" min="0" max="11" step="1" value="${st.h}" data-pe-h aria-label="時段（07–18 時）"></label>
    </div>
    <div data-pe-detail></div>
    <h3 class="h3">最曬排行</h3>
    <div class="pe-seg" role="group" aria-label="排行依據">
      <button class="btn mini" data-pe-rank="hour">這一小時</button>
      <button class="btn mini" data-pe-rank="day">07–19 合計</button>
      <button class="btn mini" data-pe-rank="share">曬路比例</button>
    </div>
    <p class="privacy" data-pe-rankhint></p>
    <div data-pe-ranklist></div>
    <p class="privacy">來源：捷運 OD、公園處樹籍、© OpenStreetMap（${ctx.esc(idx.generated || '')}）</p>
  </div>`;
}

function bindPage(root, ctx) {
  CTX = ctx;
  const el = root.querySelector('.f-ped-exposure'); if (!el) return;
  bindControls(ctx, el);
  const render = () => {
    if (!el.isConnected) { pageRender = null; return; }
    const d = el.querySelector('[data-pe-detail]'); if (d) d.innerHTML = detailHTML(ctx);
    el.querySelectorAll('[data-pe-rank]').forEach((b) => { const on = b.dataset.peRank === st.rank; b.classList.toggle('primary', on); b.setAttribute('aria-pressed', on); });
    const hint = el.querySelector('[data-pe-rankhint]');
    if (hint) hint.textContent = st.rank === 'share' ? '不看人數' : '大站自然排前';
    const rl = el.querySelector('[data-pe-ranklist]'); if (rl) rl.innerHTML = rankHTML(ctx);
    fillSelects(ctx);
  };
  pageRender = render;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.peRank) { st.rank = b.dataset.peRank; render(); }
    else if (b.hasAttribute('data-pe-all')) { st.all = true; render(); }
    else if (b.dataset.peSethour != null) { st.h = +b.dataset.peSethour; remember(ctx); paintHour(ctx); render(); }
    else if (b.dataset.pePick) { showStation(ctx, b.dataset.pePick, false).then(render); render(); el.querySelector('[data-pe-detail]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (b.dataset.peFly) showOnMap(ctx, b.dataset.peFly);
  });
  render();
  if (st.station) showStation(ctx, st.station, false).then(render);
}

// ---------- manifest ----------
export default {
  id: ID,
  title: '行人逐時曝曬',
  oneLiner: '捷運站周邊逐時曬人路段',
  audience: ['gov', 'plan', 'mayor'],
  dataStatus: ['sim', 'est'],
  maturity: 'exp',
  ready: true,
  demoValue: '拖一下時間滑桿就看到：平日早上 8 點是最曬的一小時，哪幾條路該先加樹或遮蔭',
  problem: '「樹蔭×人流」只能說哪一站缺樹蔭，說不出是哪條路、哪個時段最多人在曬；補樹與遮陽棚的位置還是憑感覺。',
  howto: '在獨立頁選一個捷運站（或從排行按「看」），拖 07–18 時的滑桿看各時段最曬的路名；按「地圖」會打開「行人曝曬」圖層並移到該站，線越深＝那一小時經過而且曬到太陽的人越多，點路段看人次與遮蔭。地圖上的白點也可以直接點來換站。每次只載入選到的那一站。',
  limits: '捷運相關步行的模擬下限 × 推估遮蔭：只算搭捷運的人，公車族、住戶、午餐人潮都沒算；路線是最短路模擬，沒有實際軌跡；遮蔭由樹冠推估與 OpenStreetMap 建物影（約三分之二建物缺樓層、假設 5 層）算出，騎樓、雨遮、高架橋下沒算；8 月平日、太陽取 8 月中。適合排序，不適合當絕對值；台北車站一帶（台北車站、台大醫院、善導寺、北門、西門）因地下街與站內轉乘最可能高估。',
  rollout: {
    agencies: '交通局（人流與號誌）、公園處與新工處（補樹、人行道）、都發局（騎樓與建物高度）、捷運公司（出口別人數）',
    data: '捷運出口別逐時人數、騎樓與雨遮圖資、3D 建物高度、交工處路口行人計數逐年對照；挑 3–5 段現場數人與拍遮蔭照片驗證',
    budget: '情境試算：模型重跑與維護約 1 人月；現場驗證每段約 2 人日；3D 建物與騎樓圖資授權費用未詢價',
    promo: '每年夏季前公布最曬的前 20 段，跟里長與商圈討論先種樹、加遮陽棚或縮短號誌等候；結果放公開地圖',
  },
  sources: [
    { label: '臺北捷運每日分時各站 OD 流量統計資料（2026 年 8 月，臺北大眾捷運公司）', url: 'https://data.gov.tw/dataset/128506', date: '2026-10-23 下載' },
    { label: '臺北捷運車站出入口座標（2026-08-04 版）', url: 'https://data.taipei/dataset/detail?id=cfa4778c-62c1-497b-b704-756231de348b', date: '2026-10-23 下載' },
    { label: '臺北捷運 114 年旅客滿意度調查摘要（出站步行比例）', url: 'https://www-ws.gov.taipei/001/Upload/405/relfile/18288/7605/abe92418-418b-4391-b997-f04230f2acb7.pdf', date: '2026-01-15' },
    { label: '臺北市行道樹及公園樹木分布圖（公園處）', url: 'https://data.gov.tw/dataset/128274', date: '2026-10-13 下載' },
    { label: '臺北市人行道範圍圖（新工處）', url: 'https://data.taipei/dataset/detail?id=715d3a83-8445-4496-b6bf-b0900538b7e7', date: '2026-10-13 下載' },
    { label: '步行路網與建物：© OpenStreetMap contributors（ODbL 1.0，Geofabrik 台灣檔）', url: 'https://www.openstreetmap.org/copyright', date: '2026-10-21 版' },
    { label: '驗證對照：臺北市交通流量及特性調查（交工處，路口行人計數）', url: 'https://data.gov.tw/dataset/128230', date: '2026-10-23 下載' },
    { label: '授權：政府資料開放授權條款第 1 版', url: 'https://data.gov.tw/license', date: '' },
  ],
  chipDefs: { [KEY]: { label: '行人曝曬', dot: '#eb6834' } },
  chips: [KEY],
  page,
  bindPage,
  async init(ctx) {
    CTX = ctx; recall(ctx);
    const m = ctx.map; if (!m || m.getSource(SRC)) return;
    m.addSource(SRC, { type: 'geojson', data: EMPTY });
    m.addSource(SRC_RING, { type: 'geojson', data: EMPTY });
    m.addSource(SRC_ST, { type: 'geojson', data: EMPTY });
    m.addLayer({ id: 'pedexp-ring', type: 'line', source: SRC_RING, layout: { visibility: 'none' },
      paint: { 'line-color': '#1f3d2b', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } });
    m.addLayer({ id: 'pedexp-line', type: 'line', source: SRC, layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['coalesce', ['get', 'e' + st.h], 0] },
      paint: { 'line-color': expColor(st.h), 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 15, 3, 17, 6, 19, 10], 'line-opacity': 0.92 } });
    m.addLayer({ id: 'pedexp-st', type: 'circle', source: SRC_ST, layout: { visibility: 'none' },
      paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 7, 5], 'circle-color': '#ffffff', 'circle-stroke-color': ['case', ['==', ['get', 'sel'], 1], '#1f3d2b', '#b9431a'], 'circle-stroke-width': ['case', ['==', ['get', 'sel'], 1], 3, 2] } });
    const anchor = document.getElementById('plant-legend');
    if (anchor && !document.getElementById('pedexp-legend')) {
      const lg = document.createElement('div');
      lg.className = 'plant-legend'; lg.id = 'pedexp-legend'; lg.hidden = true;
      lg.innerHTML = legendHTML(ctx);
      anchor.after(lg);
      bindControls(ctx, lg);
    }
    if (!st.bound) {
      st.bound = true;
      m.on('click', 'pedexp-st', (e) => {
        const f = e.features && e.features[0]; if (!f) return;
        showStation(CTX || ctx, f.properties.name, true).then(() => onStationChange());
        (CTX || ctx).showToast(`已切到${stn(f.properties.name)}`);
      });
      m.on('click', 'pedexp-line', (e) => {
        const c = CTX || ctx, p = e.point;
        // 點到樹、推薦點、站點時讓原本的點擊處理
        const hit = m.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]]).some((f) => /^(trees-|plant$|shade$|planters$|dongmen|pedexp-st$)/.test(f.layer.id));
        if (hit) return;
        const f = e.features && e.features[0]; if (!f) return;
        try { new maplibregl.Popup({ closeButton: true, maxWidth: '260px' }).setLngLat(e.lngLat).setHTML(popupHTML(c, f.properties)).addTo(m); } catch (err) { console.warn(ID, err); }
      });
      for (const id of ['pedexp-st', 'pedexp-line']) {
        m.on('mouseenter', id, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', id, () => { m.getCanvas().style.cursor = ''; });
      }
    }
  },
  apply(ctx, layers, on) {
    CTX = ctx;
    const m = ctx.map; if (!m || !m.getLayer('pedexp-line')) return;
    const vis = !!(on && layers[KEY]);
    for (const id of LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none');
    const lg = document.getElementById('pedexp-legend'); if (lg) lg.hidden = !vis;
    if (!vis) return;
    // 打開圖層才抓 index.json；之前選過的站才抓那一站的檔
    if (!st.idx) {
      loadIndex(ctx).then(() => { if (st.station && !st.gj) showStation(ctx, st.station, false); })
        .catch((e) => { console.warn(ID, e); ctx.showToast('行人曝曬站清單載入失敗'); });
    } else if (st.station && !st.gj && !st.stP) showStation(ctx, st.station, false);
  },
};
