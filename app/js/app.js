// 台北樹木數位孿生：地圖、單棵樹詳細頁、民眾回報、廠商施工查核。
import {
  timeline, inDemoZone, DONGMEN, FUMIN, STATUS, VENDORS, WORK_ORDERS, workOrderFor, COMPANIES, ADOPTIONS, adoptionFor,
  POINTS, SIM_USERS, REWARDS, randomNick, staleDays, photoPoints, NEWS,
} from './sim.js';
import { ROLES, CHIPS, NAV, PURPOSES, roleFromPath } from './roles.js';
import { FEATURES, PRESETS } from '../features/index.js';
import { DEFAULT_W, LEVELS, factors, score, rankLevels, daysSince } from './review.js';
import { MATCH_RADIUS_M, CANDIDATE_RADIUS_M, distM, readExifGps, browserLocation, nearbyTrees } from './photo-verify.js';
import { estimateTreeCarbon } from '../features/adopt-proposal/carbon.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('tt.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tt.' + k, JSON.stringify(v)); } catch {} },
};

let ROLE = roleFromPath(location.pathname);
let R = ROLES[ROLE];
const S = {
  data: null, trees: [], byId: new Map(), map: null, selected: null,
  layers: {},
  species: '', vendor: ROLE === 'vendor' ? store.get('vendor', null) : null, plant: null, tab: R.tab || 'life', w: store.get('weights', DEFAULT_W),
  nick: store.get('nick', null) || (() => { const n = randomNick(); store.set('nick', n); return n; })(),
};

// ---------- 功能開關（登錄表在 app/features/index.js）----------
const FEAT = new Map(FEATURES.map((f) => [f.id, f]));
for (const f of FEATURES) Object.assign(CHIPS, f.chipDefs || {});
const OWNER = { chip: new Map(), nav: new Map(), tab: new Map(), part: new Map() };
for (const f of FEATURES) {
  for (const k of f.chips || []) OWNER.chip.set(k, f.id);
  for (const k of f.nav || []) OWNER.nav.set(k, f.id);
  for (const k of f.treeTabs || []) OWNER.tab.set(k, f.id);
  for (const k of f.parts || []) OWNER.part.set(k, f.id);
}
const params = () => new URLSearchParams(location.search);
function computeFeatures() {
  const q = params(), core = FEATURES.filter((f) => f.core).map((f) => f.id);
  if (q.has('f')) return new Set([...core, ...q.get('f').split(',').filter((id) => FEAT.has(id))]);
  if (q.has('preset') && q.get('preset') in PRESETS) {
    const p = PRESETS[q.get('preset')];
    return new Set(p ? [...core, ...p] : FEATURES.filter((f) => f.ready).map((f) => f.id));
  }
  return new Set(FEATURES.filter((f) => f.core || (f.ready && forRole(f.audience))).map((f) => f.id));
}
const isOn = (id) => S.feat.has(id);
// 角色涵蓋的 audience（市府＝主管機關＋規劃＋首長）
const forRole = (list) => !!list?.some((a) => (R.aud || [ROLE]).includes(a));
const ownedOn = (kind, k) => { const o = OWNER[kind].get(k); return !o || isOn(o); };
// 功能模組的 init（加圖層、預先載資料）只在功能開著時才跑，關著的不拖慢開機
S.inited = new Set();
async function ensureInit() {
  let n = 0;
  for (const f of FEATURES) {
    if (!f.init || !isOn(f.id) || S.inited.has(f.id)) continue;
    S.inited.add(f.id);
    try { await f.init(ctx()); } catch (e) { console.warn(f.id, e); }
    n++; await new Promise((r) => setTimeout(r));
  }
  if (n && S.booted) applyFilters();
}
function setFeature(id, on) {
  if (on) S.feat.add(id); else S.feat.delete(id);
  const f = FEAT.get(id);
  for (const k of f.chips || []) S.layers[k] = on && (f.chips.length === 1 || S.layers[k]);
  if (on && S.booted) ensureInit();
  const q = params(); q.delete('preset');
  q.set('f', [...S.feat].filter((x) => !FEAT.get(x).core).join(','));
  history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
  renderRoleChrome(); applyFilters();
}
function defaultLayers() {
  S.purpose = R.focus && ownedOn('chip', PURPOSES[R.focus].layer) ? R.focus : null;
  const on = ['street', 'park', S.purpose && PURPOSES[S.purpose].layer];
  return Object.fromEntries(Object.keys(CHIPS).map((k) => [k, on.includes(k)]));
}
// 這些功能需要專心算、專心讀，只放獨立頁（/f/<id>），不疊在主地圖、不塞進側欄（research/21 原則 2）
const STANDALONE = new Set(['canopy-debt', 'canopy-ledger', 'mayor-dash', 'shade-equity', 'commitments', 'opinion-hotspot', 'jurisdiction', 'open-fields', 'conflict-alert', 'vendor-record', 'ped-exposure']);
// 單棵樹頁只留一行摘要＋連到獨立頁
const TREE_TEASER = {
  'canopy-debt': '如果失去這棵樹，要補種幾棵、幾年才追得回樹蔭',
  'conflict-alert': '這棵樹附近有施工範圍',
  jurisdiction: '這棵樹與周邊歸哪個單位管',
  'opinion-hotspot': '有市民提名或回報過這棵樹',
  'vendor-record': '這棵樹所在施工案的廠商紀錄',
};

// 公園處列為不再新植的樹種（https://pkl.gov.taipei/cp.aspx?n=7400D752A0FBE09F）
// 原件 7 類：榕樹（不在此圖層，避免蓋滿全市）、橡膠樹、菩提樹、盾柱木、木棉、刺桐類、黑板樹；仁愛路四段安全島菩提樹缺株仍補菩提（例外）
const NONEW = /^(黑板樹|木棉|橡膠樹|印度橡膠樹|菩提樹|盾柱木)$|刺桐/;
const isNoNew = (t) => NONEW.test(t.species) && !(t.species === '菩提樹' && t.place.startsWith('仁愛路四段'));

// ---------- data ----------
// 樹木資料分塊載入（data/trees/index.json＋格網分塊，見 scripts/build-tree-chunks.mjs）：
// 首屏只載預設視野那幾塊，地圖先畫出來；其餘在背景小批載完，全部到齊（S.ready）才算統計、開功能。
const yieldNow = () => new Promise((r) => setTimeout(r));
async function addRows(rows) {
  const d = S.data;
  for (let j = 0; j < rows.length; j++) {
    if (j && j % 700 === 0) await yieldNow(); // 每批不超過約 50ms，手機上不卡
    const r = rows[j], i = S.trees.length;
    const t = {
      i, id: r[0], lng: r[1], lat: r[2], species: d.species[r[3]], s: r[3], dbh: r[4], height: r[5], survey: r[6],
      dist: d.dists[r[7]], place: d.places[r[8]], remark: d.remarks[r[9]], kind: r[10],
    };
    t.rv = score(t, S.w);
    t.ph = staleDays(t.id);
    S.trees.push(t);
    S.byId.set(t.id, t);
    const ad = adoptionFor(t);
    const wo = workOrderFor(t);
    S.feats.push({
      type: 'Feature', id: i,
      geometry: { type: 'Point', coordinates: [t.lng, t.lat] },
      properties: { i, s: t.s, k: t.kind, d: t.dbh || 8, ph: t.ph, nn: isNoNew(t) ? 1 : 0, a: ad ? COMPANIES.indexOf(ad.company) : -1, w: wo ? ['keep', 'move', 'remove'].indexOf(wo.status) + 1 : 0, v: wo ? wo.order.vendor : '', rl: 0 },
    });
  }
}
const chunkJSON = async (c) => (await fetch(`/data/trees/${c.f}?v=${S.data.v}`)).json();
async function loadTreesFirst(bounds) {
  const idx = await (await fetch('/data/trees/index.json')).json();
  S.data = idx; S.feats = [];
  const [w, s, e, n] = bounds;
  const inView = (c) => !(c.bbox[2] < w || c.bbox[0] > e || c.bbox[3] < s || c.bbox[1] > n);
  const cx = (w + e) / 2, cy = (s + n) / 2;
  const dist = (c) => Math.hypot((c.bbox[0] + c.bbox[2]) / 2 - cx, (c.bbox[1] + c.bbox[3]) / 2 - cy);
  const first = [];
  let sum = 0;
  for (const c of idx.chunks.filter(inView).sort((a, b) => dist(a) - dist(b))) { first.push(c); sum += c.n; } // 畫面內的全部先載（分批載會讓畫面一直變、反而更慢）
  S.chunkRest = idx.chunks.filter((c) => !first.includes(c)).sort((a, b) => dist(a) - dist(b));
  for (const d of await Promise.all(first.map(chunkJSON))) await addRows(d.rows);
  S.gj = { type: 'FeatureCollection', features: S.feats };
  return S.gj;
}
async function loadTreesRest() {
  const q = S.chunkRest || [], src = S.map.getSource('trees');
  for (let k = 0; k < q.length; k += 3) {
    const ds = await Promise.all(q.slice(k, k + 3).map(chunkJSON));
    for (const d of ds) {
      const from = S.feats.length;
      await addRows(d.rows);
      src.updateData({ add: S.feats.slice(from) });
      await yieldNow();
    }
  }
  S.byId.set(DONGMEN.id, DONGMEN);
  await yieldNow();
  S.reviewOrder = rankLevels(S.trees);
  for (const f of S.feats) f.properties.rl = S.trees[f.properties.i].rl;
  S.rlPushed = false; // 複查優先序的顏色要等「複查」圖層打開才整包送進地圖（見 applyFilters）
  S.ready = true;
  S.readyResolve?.();
}
S.readyP = new Promise((r) => { S.readyResolve = r; });
S.bootP = new Promise((r) => { S.bootResolve = r; });

function treeFromId(id) { return S.byId.get(id) || null; }

// 歷年影像示範樹（國土測繪中心正射影像裁切）；不在現行資料裡的樹也建一筆「已從資料消失」
async function loadImagery() {
  try {
    const d = await (await fetch('/data/imagery.json')).json();
    S.imageryMeta = d;
    S.imagery = new Map(d.trees.map((t) => [t.id, t]));
    for (const it of d.trees) {
      let t = S.byId.get(it.id);
      if (it.id === DONGMEN.imagery) { S.byId.set(it.id, DONGMEN); t = DONGMEN; }
      if (!t) {
        t = { id: it.id, species: it.species, dbh: it.dbh, height: it.height, survey: '', dist: '中正區', place: it.label.replace(/（.*）/, ''), remark: '', kind: 0, lng: it.lng, lat: it.lat, gone: true, imagery: it.id, goneNote: it.evidence };
        S.byId.set(it.id, t);
      } else t.imagery = it.id;
      const el = document.createElement('button');
      el.className = 'img-marker'; el.innerHTML = '📷 歷年影像'; el.title = it.label;
      el.addEventListener('click', (e) => { e.stopPropagation(); S.tab = 'aerial'; go(`#/tree/${t.id}`); });
      new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -8] }).setLngLat([it.lng, it.lat]).addTo(S.map);
    }
  } catch (e) { console.warn('imagery', e); }
}

// ---------- API ----------
// 沒有後端（例如純靜態部署）時，回報改存在這支手機的瀏覽器裡
let API_OK = null;
const localEvents = () => store.get('events', []);
async function fetchEvents(q) {
  if (API_OK !== false) {
    try {
      const r = await fetch('/api/events' + q);
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) { API_OK = true; return r.json(); }
    } catch {}
    API_OK = false;
  }
  return null;
}
async function getEvents(treeId) {
  const remote = await fetchEvents(`?tree=${encodeURIComponent(treeId)}`);
  return [...(remote || []), ...localEvents().filter((e) => e.treeId === treeId)];
}
async function getAllEvents() {
  return [...((await fetchEvents('')) || []), ...localEvents()];
}
async function postEvent(ev) {
  if (API_OK !== false) {
    let r = null;
    try { r = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ev) }); } catch {}
    const isJson = r && (r.headers.get('content-type') || '').includes('json');
    if (r && r.ok && isJson) { API_OK = true; return r.json(); }
    if (r && isJson) throw new Error((await r.json().catch(() => ({}))).error || '上傳失敗');
    if (API_OK === true) throw new Error('連不上伺服器，請稍後再試');
    API_OK = false;
  }
  // 沒有後端（純靜態部署）：存在這支手機的瀏覽器裡
  const saved = { ...ev, id: 'local-' + Date.now(), at: new Date().toISOString(), local: true };
  const list = [...localEvents(), saved].slice(-30);
  try { localStorage.setItem('tt.events', JSON.stringify(list)); } catch {
    saved.photo = null; list[list.length - 1] = saved;
    try { localStorage.setItem('tt.events', JSON.stringify(list)); } catch { throw new Error('這支手機的瀏覽器不能存資料，回報沒有存下來'); }
    showToast('瀏覽器空間不足，照片沒存下來，只存了文字回報');
  }
  return saved;
}

// 照片在瀏覽器裡重新繪製成 JPEG：會丟掉 EXIF（含 GPS 定位、相機型號、拍攝時間）。
async function cleanPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const max = 1280, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  // 目標約 300 KB 以內
  let q = 0.8, url = c.toDataURL('image/jpeg', q);
  while (url.length > 420000 && q > 0.45) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
  return url;
}

// ---------- map ----------
const BASE = 'https://tiles.openfreemap.org/styles/positron';
// 底圖抓不到時退回 OpenStreetMap 標準圖磚（demo 用量很小）
const FALLBACK = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.85 } }],
};

async function pickStyle() {
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(BASE, { signal: ctl.signal }); clearTimeout(tm);
    if (r.ok) {
      const st = await r.json();
      for (const l of st.layers || []) if (l.type === 'symbol' && l.layout?.['text-field']) l.layout['text-field'] = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name']];
      S.zhStyle = true;
      return st;
    }
  } catch {}
  return FALLBACK;
}

function initMap(style) {
  const map = new maplibregl.Map({
    container: 'map', style, center: [121.5435, 25.0560], zoom: 12.2, minZoom: 10.5, maxZoom: 19,
    attributionControl: { compact: true }, hash: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');
  S.map = map;
  return map;
}

function localizeLabels(map) {
  for (const l of map.getStyle().layers) {
    if (l.type === 'symbol' && map.getLayoutProperty(l.id, 'text-field')) {
      map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name']]);
    }
  }
}

const RADIUS = ['interpolate', ['linear'], ['zoom'], 10, 0.6, 13, 1.6, 15, 3, 17, ['+', 3, ['/', ['get', 'd'], 9]], 19, ['+', 5, ['/', ['get', 'd'], 5]]];

function addLayers(map, gj) {
  map.addSource('trees', { type: 'geojson', data: gj, buffer: 16, tolerance: 0 });
  const stroke = ['interpolate', ['linear'], ['zoom'], 14, 0, 16, 1];
  map.addLayer({ id: 'trees-park', type: 'circle', source: 'trees', filter: ['==', ['get', 'k'], 1], paint: { 'circle-color': '#8fae3a', 'circle-radius': RADIUS, 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': stroke } });
  map.addLayer({ id: 'trees-street', type: 'circle', source: 'trees', filter: ['==', ['get', 'k'], 0], paint: { 'circle-color': '#2f7a45', 'circle-radius': RADIUS, 'circle-opacity': 0.9, 'circle-stroke-color': '#fff', 'circle-stroke-width': stroke } });
  map.addLayer({ id: 'review-heat', type: 'heatmap', source: 'trees', maxzoom: 13.5, layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['match', ['get', 'rl'], 4, 1, 3, 0.4, 2, 0.08, 1, 0.015, 0],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.25, 13, 0.7],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 13, 14],
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(242,193,78,0)', 0.3, '#f2c14e', 0.6, '#e8862b', 0.85, '#c2362b', 1, '#6e0d0d'],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.9, 13.5, 0],
    } });
  map.addLayer({ id: 'trees-review', type: 'circle', source: 'trees', layout: { visibility: 'none', 'circle-sort-key': ['get', 'rl'] },
    paint: {
      'circle-color': ['match', ['get', 'rl'], 4, LEVELS[4].color, 3, LEVELS[3].color, 2, LEVELS[2].color, 1, LEVELS[1].color, LEVELS[0].color],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'rl'], 4, 3, 0.6], 13, ['match', ['get', 'rl'], 4, 5, 3, 2.5, 1.6], 15, 3, 17, ['+', 3, ['/', ['get', 'd'], 9]], 19, ['+', 5, ['/', ['get', 'd'], 5]]],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, ['match', ['get', 'rl'], 4, 1, 0], 13, ['match', ['get', 'rl'], 0, 0.5, 0.95], 16, ['match', ['get', 'rl'], 0, 0.7, 1]],
      'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, 1],
    } });
  map.addLayer({ id: 'trees-nonew', type: 'circle', source: 'trees', filter: ['==', ['get', 'nn'], 1], layout: { visibility: 'none' },
    paint: { 'circle-color': '#4a5a50', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2.5, 17, ['+', 3, ['/', ['get', 'd'], 9]]], 'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 1] } });
  map.addLayer({ id: 'trees-stale', type: 'circle', source: 'trees', layout: { visibility: 'none' },
    paint: {
      'circle-color': ['case', ['<', ['get', 'ph'], 0], '#c2362b', ['>', ['get', 'ph'], 365], '#e07a1f', ['>', ['get', 'ph'], 90], '#f2c14e', '#b8c4bb'],
      'circle-radius': RADIUS, 'circle-stroke-color': '#fff', 'circle-stroke-width': stroke,
    } });
  map.addLayer({ id: 'trees-adopt', type: 'circle', source: 'trees', filter: ['>=', ['get', 'a'], 0], layout: { visibility: 'none' },
    paint: { 'circle-color': ['match', ['get', 'a'], 0, COMPANIES[0].color, 1, COMPANIES[1].color, COMPANIES[2].color], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 13, 3, 15, 5, 17, ['+', 5, ['/', ['get', 'd'], 9]], 19, ['+', 7, ['/', ['get', 'd'], 5]]], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'trees-wo', type: 'circle', source: 'trees', filter: ['==', ['get', 'v'], '__none__'],
    paint: { 'circle-color': ['match', ['get', 'w'], 1, '#c2362b', 2, '#e08a00', '#3b6e8f'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7, 18, 12], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });

  map.addSource('wo-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: WORK_ORDERS.map((o) => circlePoly(o.center, o.radius, { id: o.id, vendor: o.vendor, name: o.name })) } });
  map.addLayer({ id: 'wo-fill', type: 'fill', source: 'wo-areas', filter: ['==', ['get', 'vendor'], '__none__'], paint: { 'fill-color': '#e07a1f', 'fill-opacity': 0.08 } }, 'trees-park');
  map.addLayer({ id: 'wo-line', type: 'line', source: 'wo-areas', paint: { 'line-color': '#7a5bb5', 'line-width': 2, 'line-dasharray': [2, 2] } });
  for (const o of WORK_ORDERS) {
    const el = document.createElement('div'); el.className = 'zone-label'; el.textContent = '示範區（模擬施工案）';
    new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([o.center[0], o.center[1] + o.radius / 111000]).addTo(map);
  }

  map.addSource('plant', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // 依人行道寬度三分流（公園處行道樹樹種選擇原則）；鄰近樹穴都對不到樹的點淡化（疑資料缺漏）
  const tier = ['case', ['!', ['has', 'sw_width']], 0, ['<', ['coalesce', ['get', 'sw_width'], 0], 2], 1, ['<=', ['get', 'sw_width'], 3.5], 2, 3];
  map.addLayer({ id: 'plant', type: 'circle', source: 'plant', layout: { visibility: 'none', 'circle-sort-key': ['get', 'score'] },
    paint: {
      'circle-color': ['match', tier, 1, '#8a5a9e', 2, '#f2a541', 3, '#e07a1f', '#bbb'],
      'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1.5],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 15, 4.5, 18, 10],
      'circle-opacity': ['match', ['get', 'ctx'], ['all_empty', 'isolated'], 0.35, 0.95],
      'circle-stroke-opacity': ['match', ['get', 'ctx'], ['all_empty', 'isolated'], 0.35, 1],
    } });

  map.addSource('shade', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'shade', type: 'circle', source: 'shade', layout: { visibility: 'none', 'circle-sort-key': ['get', 'gap_score'] },
    paint: {
      'circle-color': ['interpolate', ['linear'], ['get', 'gap_score'], 0, '#fddbc7', 40, '#ef8a62', 70, '#b2182b'],
      'circle-opacity': 0.55, 'circle-stroke-color': '#7f0000', 'circle-stroke-width': 1,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['*', 0.04, ['sqrt', ['get', 'daily']]], 15, ['*', 0.16, ['sqrt', ['get', 'daily']]]],
    } });

  map.addSource('planters', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('planter-trail', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'planter-trail', type: 'line', source: 'planter-trail', paint: { 'line-color': '#8a5a9e', 'line-width': 2, 'line-dasharray': [1, 1.5] } });
  map.addLayer({ id: 'planters', type: 'circle', source: 'planters', layout: { visibility: 'none' },
    paint: { 'circle-color': '#8a5a9e', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 7, 18, 11], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });

  map.addSource('dongmen', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [DONGMEN.lng, DONGMEN.lat] }, properties: {} } });
  map.addLayer({ id: 'dongmen-halo', type: 'circle', source: 'dongmen', paint: { 'circle-color': '#c2362b', 'circle-opacity': 0.18, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 8, 17, 26] } });
  map.addLayer({ id: 'dongmen', type: 'circle', source: 'dongmen', paint: { 'circle-color': '#c2362b', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 17, 9], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });

  map.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'sel', type: 'circle', source: 'sel', paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 9, 18, 22], 'circle-stroke-color': '#e07a1f', 'circle-stroke-width': 3 } });

  // 整區認養：在區域中心放企業 logo
  for (const a of ADOPTIONS.filter((x) => x.type === 'zone')) {
    const pts = S.trees.filter((t) => { const ad = adoptionFor(t); return ad && ad.label === a.label; });
    if (!pts.length) continue;
    const c = [pts.reduce((s, t) => s + t.lng, 0) / pts.length, pts.reduce((s, t) => s + t.lat, 0) / pts.length];
    const co = COMPANIES.find((x) => x.id === a.company);
    const el = document.createElement('img');
    el.src = co.logo; el.className = 'adopt-marker'; el.alt = co.name; el.title = `${co.name}認養：${a.label}`;
    el.addEventListener('click', (e) => { e.stopPropagation(); showToast(`${co.name}認養「${a.label}」共 ${pts.length} 棵（模擬）`); });
    a._marker = new maplibregl.Marker({ element: el }).setLngLat(c);
    a._count = pts.length;
  }

  const clickable = ['shade', 'planters', 'dongmen', 'trees-wo', 'trees-adopt', 'trees-stale', 'trees-review', 'trees-street', 'trees-park', 'plant'];
  map.on('click', (e) => {
    const p = e.point, pad = matchMedia('(pointer: coarse)').matches ? 14 : 6;
    const live = clickable.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    const fs = map.queryRenderedFeatures([[p.x - pad, p.y - pad], [p.x + pad, p.y + pad]], { layers: live });
    if (!fs.length) return;
    if (map.getLayer('dm-diff-pts') && map.getLayoutProperty('dm-diff-pts', 'visibility') !== 'none' && map.queryRenderedFeatures([[p.x - pad, p.y - pad], [p.x + pad, p.y + pad]], { layers: ['dm-diff-pts'] }).length) return; // 時光機的變化點只開說明框
    // 取離點擊最近的那一棵
    let best = fs[0], bd = Infinity;
    for (const f of fs) {
      const q = map.project(f.geometry.coordinates);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (f.layer.id === 'dongmen' ? -400 : 0);
      if (d < bd) { bd = d; best = f; }
    }
    if (best.layer.id === 'dongmen') return go(`#/tree/${DONGMEN.id}`);
    if (best.layer.id === 'plant') return go(`#/plant/${best.properties.id}`);
    if (best.layer.id === 'planters') return go(`#/planter/${best.properties.id}`);
    if (best.layer.id === 'shade') return go(`#/station/${encodeURIComponent(best.properties.name)}`);
    go(`#/tree/${S.trees[best.properties.i].id}`);
  });
  for (const id of clickable) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}

function circlePoly(center, r, props) {
  const pts = [];
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    pts.push([center[0] + (r * Math.cos(a)) / 101000, center[1] + (r * Math.sin(a)) / 111000]);
  }
  return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [pts] } };
}

function applyFilters() {
  const m = S.map; if (!m?.getLayer('trees-street')) return;
  const sp = S.species === '' ? true : ['==', ['get', 's'], +S.species];
  m.setFilter('trees-street', ['all', ['==', ['get', 'k'], 0], sp]);
  m.setFilter('trees-park', ['all', ['==', ['get', 'k'], 1], sp]);
  // 複查優先序開著時，它自己畫全部的樹（不符條件的變灰、不消失），所以把一般樹點圖層關掉
  const rv = !!S.layers.review;
  if (rv && S.ready && !S.rlPushed) { S.rlPushed = true; m.getSource('trees').setData(S.gj); }
  m.setLayoutProperty('trees-street', 'visibility', S.layers.street && !rv ? 'visible' : 'none');
  m.setLayoutProperty('trees-park', 'visibility', S.layers.park && !rv ? 'visible' : 'none');
  m.setLayoutProperty('trees-review', 'visibility', rv ? 'visible' : 'none');
  m.setLayoutProperty('review-heat', 'visibility', rv ? 'visible' : 'none');
  m.setFilter('trees-review', ['all', S.species === '' ? true : ['==', ['get', 's'], +S.species], ['any', ['all', ['==', ['get', 'k'], 0], S.layers.street], ['all', ['==', ['get', 'k'], 1], S.layers.park]]]);
  $('#review-legend').hidden = !rv;
  m.setLayoutProperty('trees-adopt', 'visibility', S.layers.adopt ? 'visible' : 'none');
  m.setLayoutProperty('trees-stale', 'visibility', S.layers.stale ? 'visible' : 'none');
  m.setLayoutProperty('trees-nonew', 'visibility', S.layers.nonew ? 'visible' : 'none');
  $('#nonew-legend').hidden = !S.layers.nonew;
  m.setFilter('trees-stale', ['all', S.species === '' ? true : ['==', ['get', 's'], +S.species], ['any', ['all', ['==', ['get', 'k'], 0], S.layers.street], ['all', ['==', ['get', 'k'], 1], S.layers.park]]]);
  $('#stale-legend').hidden = !S.layers.stale;
  m.setLayoutProperty('plant', 'visibility', S.layers.plant ? 'visible' : 'none');
  m.setLayoutProperty('planters', 'visibility', S.layers.planter ? 'visible' : 'none');
  m.setLayoutProperty('shade', 'visibility', S.layers.shade ? 'visible' : 'none');
  $('#shade-legend').hidden = !S.layers.shade;
  if (S.layers.shade) loadShade();
  if (S.layers.planter) loadPlanters();
  $('#plant-legend').hidden = !S.layers.plant;
  for (const a of ADOPTIONS) { if (a._marker) { if (S.layers.adopt) a._marker.addTo(m); else a._marker.remove(); } }
  const v = S.vendor?.id || '__none__';
  const sup = !!S.vendor?.supervisor;
  m.setFilter('trees-wo', sup ? ['!=', ['get', 'v'], ''] : ['==', ['get', 'v'], v]);
  m.setFilter('wo-fill', sup ? true : ['==', ['get', 'vendor'], v]);
  if (S.layers.plant && !S.plant) loadPlant();
  for (const f of FEATURES) if (f.apply) try { f.apply(ctx(), S.layers, isOn(f.id) && (!STANDALONE.has(f.id) || S.page === f.id)); } catch (e) { console.warn(f.id, e); }
  updateWatermark();
  updateFilterBar();
}

function recomputeReview() {
  for (const t of S.trees) t.rv = score(t, S.w);
  S.reviewOrder = rankLevels(S.trees);
  for (const f of S.gj.features) f.properties.rl = S.trees[f.properties.i].rl;
  S.map.getSource('trees').setData(S.gj);
}

// 只要畫面上有模擬資料，地圖底部就固定顯示一條說明（政治紅線：截圖流出也看得出哪些是模擬）
// 已套用條件標籤列：點 × 取消
function updateFilterBar() {
  const bar = $('#filterbar'), tags = [];
  if (S.species !== '') tags.push(['species', `樹種：${S.data.species[+S.species]}`]);
  if (!S.layers.street && S.layers.park) tags.push(['street', '只看公園樹']);
  if (S.layers.street && !S.layers.park) tags.push(['park', '只看行道樹']);
  bar.hidden = !tags.length;
  bar.innerHTML = tags.map(([k, l]) => `<button data-clear="${k}">${esc(l)} ×</button>`).join('');
  bar.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.clear;
    if (k === 'species') S.species = ''; else S.layers[k] = true;
    syncChips(); applyFilters();
  }));
}

function updateWatermark() {
  const sim = [];
  if (S.layers.stale) sim.push('多久沒人拍天數');
  if (S.layers.planter) sim.push('移動植栽');
  if (S.layers.adopt) sim.push('企業認養（虛構企業）');
  if (ROLE === 'vendor') sim.push('廠商帳號');
  const est = [];
  if (S.layers.plant) est.push('推薦種樹點');
  if (S.layers.shade) est.push('樹蔭×人流');
  $('#watermark').hidden = !sim.length && !est.length;
  $('#watermark').innerHTML = [sim.length ? `<span class="badge sim">模擬</span> ${sim.join('、')}` : '', est.length ? `<span class="badge est">推估</span> ${est.join('、')}` : ''].filter(Boolean).join('　') + '　<a href="#/about">說明</a>';
}

async function loadPlant() {
  if (S.plant && S.plant !== 'loading') return S.plant;
  if (S.plantP) return S.plantP;
  S.plant = 'loading';
  S.plantP = (async () => {
    try {
      const r = await fetch('/data/planting-candidates.json');
      if (!r.ok) throw new Error();
      const gj = await r.json();
      S.plant = gj;
      S.plantById = new Map(gj.features.map((f) => [String(f.properties.id), f]));
      S.map.getSource('plant').setData(gj);
      return gj;
    } catch { S.plant = null; S.plantP = null; showToast('推薦種樹點資料載入失敗，稍後再試'); return null; }
  })();
  return S.plantP;
}

async function loadShade() {
  if (S.shade) return S.shade;
  S.shade = await (await fetch('/data/shade-flow.json')).json();
  S.map.getSource('shade').setData(S.shade);
  return S.shade;
}

async function renderStation(name) {
  usePurpose('shade');
  const gj = await loadShade();
  const f = gj.features.find((x) => x.properties.name === name);
  if (!f) { showToast('找不到這個站'); return go('#/'); }
  const p = f.properties, [lng, lat] = f.geometry.coordinates;
  select({ lng, lat }); flyTo({ lng, lat }, 15.5);
  openPanel(`
    <div class="eyebrow"><span class="badge est">推估</span>捷運站周邊 300 公尺</div>
    <h2 class="tree-title" style="font-size:26px">${esc(p.name)}站</h2>
    <div class="tree-sub">「人多但沒樹蔭」第 ${p.rank} 名（台北市 ${gj.features.length} 站）</div>
    <div class="facts">
      <div class="fact"><b>${p.gap_score}</b><span>缺蔭指數／100</span></div>
      <div class="fact"><b>${p.canopy_pct}%</b><span>樹冠覆蓋（推估）</span></div>
      <div class="fact"><b>${(p.daily / 10000).toFixed(1)} 萬</b><span>日均進出站</span></div>
      <div class="fact wide"><span>周邊登錄樹木</span><b>${p.trees_300m.toLocaleString()} 棵</b></div>
    </div>
    <p class="src"><span class="badge real">真實</span> 人流：捷運 2026-08 分時 OD・尖峰早 ${p.peak_am.toLocaleString()}／晚 ${p.peak_pm.toLocaleString()}</p>
    <p class="src"><span class="badge est">推估</span> 樹冠：胸徑、樹高粗估</p>
    <div class="actions"><button class="btn primary" id="st-plant">看附近的推薦種樹點</button></div>`);
  $('#st-plant').onclick = () => { usePurpose('plant'); S.map.flyTo({ center: [lng, lat], zoom: 16 }); if (innerWidth <= 760) panel.classList.add('peek'); };
}

async function loadPlanters() {
  if (S.planters) return S.planters;
  S.planters = await (await fetch('/data/sim-planters.json')).json();
  S.map.getSource('planters').setData({ type: 'FeatureCollection', features: S.planters.map((x) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lng, x.lat] }, properties: { id: x.id } })) });
  return S.planters;
}

async function renderPlanter(id) {
  usePurpose('planter');
  const x = (await loadPlanters()).find((p) => p.id === id);
  if (!x) { showToast('找不到這個植栽'); return go('#/'); }
  select(x); flyTo(x, 17);
  S.map.getSource('planter-trail').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: x.history.map((h) => [h.lng, h.lat]) }, properties: {} });
  const co = COMPANIES.find((c) => c.id === x.company);
  openPanel(`
    <div class="eyebrow"><span class="badge sim">模擬</span>${esc(x.id)}</div>
    <h2 class="tree-title" style="font-size:24px">${esc(x.kind)}</h2>
    <div class="tree-sub">${esc(x.dist)}　${esc(x.road)}</div>
    <div class="alert warn"><h3>這裡種不了樹，先放可移動的綠</h3><p>人行道寬約 ${x.sw_width} 公尺，不到 2 公尺。依<a href="${PLANT_RULE_SRC}" target="_blank" rel="noopener">公園處原則</a>不補種喬木，改用移動植栽或棚架爬藤。它不能取代大樹的樹蔭，但能讓這段路不是全曬。</p></div>
    ${co ? `<div class="adopt-card"><img src="${co.logo}" alt=""><div><b>${esc(co.name)}</b> 認養維護<small>澆水、換盆、移動都由認養企業負責 <span class="badge sim">模擬</span></small></div></div>` : ''}
    <h3 style="margin:18px 0 8px;font-size:17px">位置歷史（可移動）</h3>
    ${tlHtml(x.history.map((h) => ({ date: h.date, kind: 'notice', title: h.note, body: `${h.lng.toFixed(5)}, ${h.lat.toFixed(5)}`, tag: 'sim' })))}
    <p class="src">位置：推薦種樹點（真實）・其餘 <span class="badge sim">模擬</span></p>`);
}

const PLANT_RULE_SRC = 'https://pkl.gov.taipei/cp.aspx?n=3B57F65C422316A5';
const NO_NEW_SRC = 'https://pkl.gov.taipei/cp.aspx?n=7400D752A0FBE09F';
function plantAdvice(w) {
  if (w == null) return { tier: 0, title: '人行道寬度不明', body: '這個樹穴附近 10 公尺內對不到人行道資料，需要現勘量寬度。', tone: 'kind' };
  if (w < 2) return { tier: 1, title: '不建議補種喬木 → 改放移動植栽或棚架爬藤', body: `人行道寬約 ${w} 公尺，不到 2 公尺。公園處原則：缺株不補、請道路單位封閉植穴。可改用可移動的大型植栽盆或棚架爬藤補一點綠蔭；只剩牆面可用時才考慮垂直綠化。`, tone: 'sim' };
  if (w <= 3.5) return { tier: 2, title: '可補種小喬木或喬木', body: `人行道寬約 ${w} 公尺（2–3.5 公尺）。`, tone: 'est' };
  return { tier: 3, title: '可補種喬木或大喬木', body: `人行道寬約 ${w} 公尺，超過 3.5 公尺，空間足夠種會長大的遮蔭樹。`, tone: 'real' };
}
const CTX_LABEL = {
  row_gap: '一排樹中間缺一棵（15 公尺內的鄰穴有樹），最可信',
  mixed: '附近 50 公尺內有樹穴有樹',
  all_empty: '附近 50 公尺內的樹穴全都對不到樹：可能整段沒種，也可能是這段樹木資料沒登錄（疑資料缺漏）',
  isolated: '附近 50 公尺內沒有其他樹穴，無法對照',
};

async function renderPlant(id) {
  usePurpose('plant');
  await loadPlant();
  const f = S.plantById?.get(String(id));
  if (!f) { showToast('找不到這個推薦點'); return go('#/'); }
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  select({ lng, lat }); flyTo({ lng, lat });
  const adv = plantAdvice(p.sw_width);
  openPanel(`
    <div class="eyebrow"><span class="badge est">推估・未現勘</span>樹穴 #${esc(p.id)}</div>
    <h2 class="tree-title" style="font-size:26px">推薦種樹點</h2>
    <div class="tree-sub">${esc(p.dist || '')}　${esc(p.road || '')}</div>
    <div class="facts">
      <div class="fact"><b>${esc(p.score)}</b><span>推薦分數／100</span></div>
      <div class="fact"><b>${p.sw_width ?? '—'}</b><span>人行道寬（公尺）</span></div>
      <div class="fact"><b>${esc(p.nearest_tree_m)}</b><span>最近的樹（公尺）</span></div>
    </div>
    <div class="alert ${adv.tier === 1 ? 'warn' : 'ok'}"><h3>${esc(adv.title)}</h3><p>${esc(adv.body)}</p>
      <p class="privacy">依據：<a href="${PLANT_RULE_SRC}" target="_blank" rel="noopener">公園處樹種選擇原則</a></p></div>
    ${adv.tier >= 2 ? `<p class="src">排除<a href="${NO_NEW_SRC}" target="_blank" rel="noopener">不再新植</a>樹種</p>` : ''}
    <h3 style="margin:18px 0 6px;font-size:17px">為什麼這裡被選中</h3>
    <ul class="list">
      <li>${esc(p.reasons || '')}</li>
      <li>${esc(CTX_LABEL[p.ctx] || '')}</li>
      <li>${p.status === 'uncertain' ? '最近的樹在 1.5–3 公尺內，可能其實有樹（不確定）' : '樹穴範圍內與 3 公尺內都沒有登錄樹木，最可能是空穴'}</li>
    </ul>
    <p class="src">來源：新工處樹穴、公園處樹籍、人行道圖・需現勘</p>
    <div class="actions"><button class="btn primary" id="plant-report">📷 我路過看過：回報現況</button></div>`);
  $('#plant-report').onclick = () => {
    const t = { id: `HOLE-${p.id}`, demo: false, lng, lat };
    S.tab = 'report';
    let box = $('#tab-body');
    if (!box) { box = document.createElement('div'); box.id = 'tab-body'; body.append(box); }
    renderReport(t, box); box.scrollIntoView({ behavior: 'smooth' });
  };
}

function select(tree) {
  S.selected = tree;
  const src = S.map?.getSource('sel');
  if (src) src.setData(tree ? { type: 'Feature', geometry: { type: 'Point', coordinates: [tree.lng, tree.lat] }, properties: {} } : { type: 'FeatureCollection', features: [] });
}

// 大螢幕（視訊分享畫面）時浮層整體放大，地圖留白跟著放大
const uiZ = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
function flyTo(tree, zoom = 17.5) {
  const m = S.map; if (!m) return;
  const mobile = innerWidth <= 760;
  m.flyTo({ center: [tree.lng, tree.lat], zoom: Math.max(m.getZoom(), zoom), padding: mobile ? { bottom: innerHeight * 0.45 } : { right: 440 * uiZ(), left: 300 * uiZ() }, duration: 900 });
}

// ---------- panel ----------
const panel = $('#panel'), body = $('#panel-body');
function openPanel(html) {
  body.innerHTML = html; panel.hidden = false; panel.classList.remove('peek', 'story-mode'); body.scrollTop = 0;
  $('#layers').classList.add('compact');
}
function closePanel() { panel.hidden = true; select(null); S.map?.getSource('planter-trail')?.setData({ type: 'FeatureCollection', features: [] }); $('#layers').classList.remove('compact'); }
$('#panel-close').onclick = () => go('#/');
$('#panel-handle').onclick = () => panel.classList.toggle('peek');

function showToast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(showToast._t); showToast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function modal(html, cls = '') {
  const m = $('#modal'), c = $('#modal-card');
  c.className = 'modal-card ' + cls; c.innerHTML = html; m.hidden = false;
  return { el: c, close: () => { m.hidden = true; } };
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.currentTarget.hidden = true; });

const KIND_LABEL = { citizen: '民眾回報', vendor: '廠商回報', alarm: '異常通報' };
const TAG = { real: ['real', '真實'], sim: ['sim', '模擬'], est: ['est', '推估'], live: ['live', '本站回報'] };
const fmtDate = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function liveToTl(e) {
  const kind = e.kind === 'alarm' ? 'alarm' : e.role;
  const who = e.role === 'vendor' ? e.vendor : e.nickname;
  const title = e.role === 'vendor' ? `${e.kind === 'precheck' ? '施工前查核完成' : e.kind === 'alarm' ? '⚠ 異常：施工結果與核定處置不符' : e.kind === 'review' ? '監造複核' : '施工後回報'}${e.result ? `：${e.result}` : ''}` : `民眾回報：${e.result || '照片'}`;
  return { date: fmtDate(e.at), kind, title, body: `${who ? esc(who) + '　' : ''}${esc(e.note || '')}`, photo: e.photo, tag: 'live' };
}

function tlHtml(items) {
  return `<ol class="tl">${items.slice().reverse().map((x) => `
    <li class="k-${x.kind}">
      <div class="when">${esc(x.date)} <span class="badge ${TAG[x.tag][0]}">${TAG[x.tag][1]}</span></div>
      <div class="what">${esc(x.title)}</div>
      <div class="how">${x.tag === 'live' ? x.body : esc(x.body)}${x.src ? ` <a href="${esc(x.src)}" target="_blank" rel="noopener">來源</a>` : ''}</div>
      ${x.photo ? `<img src="${esc(x.photo)}" alt="回報照片" loading="lazy">` : ''}
    </li>`).join('')}</ol>`;
}

async function renderTree(id) {
  const t = treeFromId(id);
  if (!t) { showToast('找不到這棵樹：' + id); return go('#/'); }
  select(t); flyTo(t);
  const wo = workOrderFor(t);
  const ad = adoptionFor(t);
  const follows = store.get('follows', []);
  const followed = follows.includes(t.id);
  const kindLabel = t.gone ? '已消失' : t.demo ? '示範案例' : t.kind ? '公園樹' : '行道樹';
  const statusAlert = (big) => {
    if (t.gone) return `<div class="alert removed"><h3>這棵樹已從開放資料消失</h3><p>${esc(t.goneNote || '')}</p></div>`;
    if (t.demo) return `<div class="alert removed"><h3>已移除（原核定移植）</h3><p>2026 年 5 月施工時誤砍</p></div>`;
    if (!wo) return '';
    const st = STATUS[wo.status];
    return `<div class="alert ${st.tone}">
      <div class="eyebrow">${esc(wo.order.name)} <span class="badge sim">模擬</span></div>
      <h3>${big ? `<span class="big">${st.label}</span>` : `施工範圍內：${st.label}`}</h3>
      <p><b>${esc(st.warn)}</b></p>
      ${wo.permit ? `<p>核准文號：${esc(wo.permit)}</p>` : ''}${wo.moveTo ? `<p>${esc(wo.moveTo)}</p>` : ''}
      <p>預定施工 ${esc(wo.order.start)}　${esc(wo.order.supervisor)}</p></div>`;
  };
  openPanel(`
    <div class="eyebrow"><span class="badge kind">${kindLabel}</span>${t.demo ? `${esc(t.imagery || t.id)} <span class="badge est">推定</span>` : esc(t.id)}</div>
    ${t.demo ? '<p class="src">出現紀錄：2022 ✓・2024 ✓・2026 ✗ <span class="badge real">真實資料比對</span></p>' : t.gone ? '<p class="src">出現紀錄：2024-11 ✓・2026-10 ✗ <span class="badge real">真實資料比對</span></p>' : ''}
    <h2 class="tree-title">${esc(t.species)}</h2>
    <div class="tree-sub">${esc(t.dist)}　${esc(t.place)}${t.remark ? '　' + esc(t.remark) : ''}</div>
    <div class="actions">
      ${t.demo ? '' : `<button class="btn ${followed ? 'on' : ''}" id="follow">${followed ? '★ 已關心' : '☆ 關心這棵樹'}</button>`}
      <button class="btn primary" id="go-report">📷 上傳照片／回報</button>
      ${t.demo || t.gone ? '' : `<a class="btn" id="go-collect" href="/treemulation/collect.html?tree=${encodeURIComponent(t.id)}">🌳 開啟模樹收集</a>`}
      <button class="btn" id="share">分享</button>
    </div>
    ${inDemoZone(t) && !S.vendor ? '<div class="sim-note"><span class="badge sim">模擬</span> 示範區</div>' : ''}
    ${S.vendor ? '' : statusAlert(false)}
    ${t.place === FUMIN.park ? `<div class="alert warn"><div class="eyebrow">公園整建中 <span class="badge real">真實</span></div><h3>富民生態公園：移除從約 12 株改到 6 株</h3><p>這棵在不在名單：未判定。<a href="${FUMIN.src}" target="_blank" rel="noopener">公告</a></p></div>` : ''}
    ${S.vendor && !t.demo ? `<div id="vendor-flow"></div>` : ''}
    ${ROLE === 'vendor' && !S.vendor ? '<div class="alert warn"><h3>請先登入</h3><p><div class="actions"><button class="btn primary" id="need-login">廠商登入（模擬）</button></div></div>' : ''}
    ${ad && ownedOn('part', 'adopt-card') ? `<div class="adopt-card"><img src="${ad.company.logo}" alt=""><div><b>${esc(ad.company.name)}</b> 認養<small>${ad.type === 'zone' ? esc(ad.label) : '單棵'}・${esc(ad.since)} 起 <span class="badge sim">模擬</span></small>${NEWS[ad.company.id] ? `<a class="adopt-news" href="#/news/${ad.company.id}">📰 ${esc(NEWS[ad.company.id].title)}<small>示意新聞 ›</small></a>` : ''}${isOn('esg-report') ? `<a class="adopt-news" href="#/f/esg-report?c=${ad.company.id}">📄 可寫進永續報告書<small>報告書素材 ›</small></a>` : ''}</div></div>` : ''}
    ${t.demo ? '' : `
    <div class="facts">
      <div class="fact"><b>${t.dbh ?? '—'}</b><span>胸徑（公分）</span></div>
      <div class="fact"><b>${t.height ?? '—'}</b><span>樹高（公尺）</span></div>
      <div class="fact"><b>${t.survey ? t.survey.slice(0, 7) : '—'}</b><span>調查年月</span></div>
      <div class="fact wide"><span>${t.kind ? '公園' : '路段'}</span><b>${esc(t.place || '未登錄')}${t.remark ? '・' + esc(t.remark) : ''}</b></div>
    </div>
    <p class="src"><span class="badge real">真實</span> 來源：公園處樹籍（${t.gone ? '2024-11-21 存檔' : '2026-10-13'}）</p>
    ${carbonLine(t)}`}
    <div class="tabs" role="tablist">
      ${ROLE === 'gov' && !t.demo && !t.gone && ownedOn('tab', 'risk') ? `<button data-tab="risk" class="${S.tab === 'risk' ? 'on' : ''}">檢查與風險</button>` : ''}
      <button data-tab="life" class="${S.tab === 'life' ? 'on' : ''}">前世今生</button>
      <button data-tab="report" class="${S.tab === 'report' ? 'on' : ''}">照片與回報</button>
      ${ownedOn('tab', 'aerial') ? `<button data-tab="aerial" class="${S.tab === 'aerial' ? 'on' : ''}">歷年影像${t.imagery ? ' 📷' : ''}</button>` : ''}
    </div>
    <div id="tab-body"></div>
    <div id="feature-sections"></div>`);
  renderTreeSections(t);

  $('#follow')?.addEventListener('click', () => {
    const f = store.get('follows', []);
    store.set('follows', f.includes(t.id) ? f.filter((x) => x !== t.id) : [...f, t.id]);
    showToast(f.includes(t.id) ? '已取消關心' : '已加入「我的樹」');
    renderTree(t.id);
  });
  $('#go-report').onclick = () => { S.tab = 'report'; renderTab(t); $('#tab-body').scrollIntoView({ behavior: 'smooth' }); };
  $('#need-login')?.addEventListener('click', vendorLogin);
  $('#share').onclick = async () => {
    const url = location.href;
    try { if (navigator.share) await navigator.share({ title: `${t.species}｜「樹」位孿生`, url }); else { await navigator.clipboard.writeText(url); showToast('已複製連結'); } } catch {}
  };
  body.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.tab; renderTab(t); }));
  if (S.vendor && !t.demo) renderVendorFlow(t, wo, statusAlert);
  renderTab(t);
}

async function renderTab(t) {
  body.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  const box = $('#tab-body');
  if (S.tab === 'risk' && (ROLE !== 'gov' || t.demo || t.gone || !ownedOn('tab', 'risk'))) S.tab = 'life';
  if (S.tab === 'aerial' && !ownedOn('tab', 'aerial')) S.tab = 'life';
  if (S.tab === 'risk') {
    const f = factors(t), d = daysSince(t.survey);
    box.innerHTML = `
      <div class="alert ${t.rl >= 3 ? 'danger' : t.rl >= 1 ? 'warn' : 'ok'}"><h3>複查優先：${esc((LEVELS[t.rl] || LEVELS[0]).label)}</h3><p>${t.rv}／100 <span class="badge est">推估</span> 非病況診斷</p></div>
      <ul class="list">
        <li><span>久未調查</span><b>${f.old ? `是（${t.survey ? t.survey : '日期空白或異常'}）` : `否（${d} 天前）`}</b></li>
        <li><span>大胸徑（≥ 80 公分）</span><b>${t.dbh} 公分${f.big ? '・是' : ''}</b></li>
        <li><span>褐根病常見寄主（榕樹）</span><b>${f.host ? '是' : '否'}</b></li>
      </ul>
      <p class="src"><span class="badge real">真實</span> 來源：公園處樹籍欄位</p>
      <div class="actions"><button class="btn primary" id="assign-one">${store.get('track', {})[t.id] ? '已指派複核' : '指派監造複核（模擬）'}</button></div>`;
    $('#assign-one').onclick = () => { const tr = store.get('track', {}); tr[t.id] = '已指派・監造複核（模擬）'; store.set('track', tr); showToast('已指派監造複核（模擬）'); renderTab(t); };
  } else if (S.tab === 'life') {
    const base = t.demo ? t.timeline : t.gone ? [
      { date: '2024-11-21', kind: 'survey', title: '網路存檔的樹籍資料還有這棵', body: `胸徑 ${t.dbh} 公分、樹高 ${t.height} 公尺。`, tag: 'real' },
      { date: '2026-10-13', kind: 'removed', title: '官方最新資料已沒有這個編號', body: '消失原因（移除、合併編號或資料修正）查不到。', tag: 'real' },
    ] : timeline(t);
    const fuminNote = t.place === FUMIN.park ? '「公園：」開頭的是富民生態公園整建的真實事件（公園層級，不是這棵樹專屬）。' : '';
    box.innerHTML = `${t.demo ? '<div class="sim-note">樹位為推定</div>' : ''}${tlHtml(base)}`;
    const live = (await getEvents(t.id)).map(liveToTl);
    if (S.selected !== t || S.tab !== 'life') return;
    if (live.length) box.innerHTML = `${t.demo ? '<div class="sim-note">樹位為推定</div>' : ''}${tlHtml([...base, ...live])}`;
  } else if (S.tab === 'report') {
    renderReport(t, box);
  } else {
    renderAerial(t, box);
  }
}

function renderAerial(t, box) {
  const it = t.imagery && S.imagery?.get(t.imagery);
  if (!it) {
    box.innerHTML = `<div class="placeholder"><b>尚無歷年影像</b><p>地圖上「📷」的 5 棵有</p></div>`;
    return;
  }
  const fr = it.frames;
  let k = fr.length - 1;
  box.innerHTML = `
    <div class="aerial">
      <div class="aerial-img"><img id="aimg" src="/${esc(fr[k].src)}" alt="歷年正射影像"><i class="cross" aria-hidden="true"></i><span class="year" id="ayear"></span></div>
      <input type="range" id="aslider" min="0" max="${fr.length - 1}" value="${k}" aria-label="選擇圖層年份">
      <div class="aerial-years">${fr.map((f, i) => `<button data-k="${i}">${esc(f.year)}</button>`).join('')}</div>
      <p class="privacy" id="aobs"></p>
      <p class="src">十字＝樹位・年份為圖層年份</p>
      ${t.demo || t.gone ? `<p class="src">${esc(t.hypothesis || t.goneNote || '')}</p>` : ''}
      <p class="src">${esc(S.imageryMeta.attribution)}</p>
    </div>`;
  const show = (i) => {
    k = i; $('#aimg').src = '/' + fr[i].src; $('#aslider').value = i;
    $('#ayear').textContent = `圖層年份 ${fr[i].year}`;
    $('#aobs').textContent = fr[i].observed || '';
    box.querySelectorAll('.aerial-years button').forEach((b) => b.classList.toggle('on', +b.dataset.k === i));
  };
  $('#aslider').addEventListener('input', (e) => show(+e.target.value));
  box.querySelectorAll('.aerial-years button').forEach((b) => b.addEventListener('click', () => show(+b.dataset.k)));
  fr.forEach((f) => { const im = new Image(); im.src = '/' + f.src; });
  show(k);
}

// 單棵樹碳估算（胸徑＋樹高→碳儲存，模組在 features/adopt-proposal/carbon.js）。只是估算，不是減量額度
function carbonLine(t) {
  const c = estimateTreeCarbon(t);
  if (!c.ok) return '';
  return `<p class="src"><span class="badge est">推估</span> 碳儲存約 ${Math.round(c.storedKgCo2e).toLocaleString()} kg CO₂e・每年約 +${Math.round(c.annualKgCo2e).toLocaleString()} kg｜估算值，不是減量額度</p>`;
}

function treeStale(t) {
  if (S.photoed?.has(t.id)) return 0;
  if (t.ph != null) return t.ph; // 載入時算好的（見 addRows）
  return t.kind != null && !t.demo && !t.gone && !String(t.id).startsWith('HOLE-') ? staleDays(t.id) : -1;
}

function renderReport(t, box) {
  const days = treeStale(t);
  const pPhoto = photoPoints(days);
  box.innerHTML = `
    <div class="score-box">
      <div class="eyebrow">這次可得 <span class="badge sim">模擬</span></div>
      <ul>
        <li><span>上次有效更新</span><b>${days < 0 ? '從沒人拍過' : days === 0 ? '今天' : `${days} 天前`}</b></li>
        <li><span>照片基本分</span><b>${POINTS.base}</b></li>
        <li><span>${days < 0 ? '從沒人拍過（最高檔）' : '越久沒人拍點數越高'}</span><b>+${pPhoto - POINTS.base}</b></li>
        <li><span>狀況回報</span><b>+${POINTS.report}</b></li>
      </ul>
      <p class="privacy">${MATCH_RADIUS_M} 公尺內才給分・勿進工地或車道</p>
    </div>
    <form class="report" id="report-form">
      <label class="photo-drop" id="drop">
        <input type="file" accept="image/*" capture="environment" id="photo">
        <span id="drop-text">📷 拍照或選一張這棵樹的照片</span>
      </label>
      <div id="verify"></div>
      <p class="notice">⚠ 示範站，上傳照片會公開，請勿拍到人臉與車牌</p>
      <p class="privacy">📍 用拍照位置比對是不是這棵樹</p>
      <div class="field">這棵樹現在怎麼樣？
        <div class="choice">${['看起來健康', '有枯枝', '樹幹傾斜', '疑似病蟲害', '樹穴太小／被水泥封住', '旁邊在施工', '已經不見了'].map((s, i) => `<label><input type="radio" name="status" value="${s}" ${i === 0 ? 'checked' : ''}><span>${s}</span></label>`).join('')}</div>
      </div>
      <label class="field">補充（選填）<textarea name="note" rows="2" maxlength="300" placeholder="例如：枯枝掛在人行道上方"></textarea></label>
      <label class="field">暱稱（勿填真名）<input name="nick" value="${esc(S.nick)}" maxlength="20"></label>
      <button class="btn primary" type="submit" id="submit">送出回報（+${POINTS.report} 點）</button>
    </form>
    <h3 style="margin:22px 0 8px;font-size:17px">這棵樹的照片紀錄</h3>
    <div id="photo-strip"></div>
    <h3 style="margin:22px 0 8px;font-size:17px">大家的回報</h3>
    <div id="reports">載入中…</div>`;
  // 照片與比對結果：{ photo, verify: { method, dist, ok }, pts }
  let up = S.pending?.treeId === t.id ? S.pending : null;
  S.pending = null;
  const setSubmit = () => {
    const pts = (up?.photo && up.verify?.ok ? pPhoto : 0) + POINTS.report;
    $('#submit').textContent = `送出${up?.photo ? '照片與' : ''}回報（+${pts} 點）`;
  };
  const showPreview = () => {
    $('#drop').innerHTML = `<img src="${up.photo}" alt="預覽"><span class="privacy">位置已比對・點此換一張</span>`;
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', id: 'photo' });
    inp.setAttribute('capture', 'environment'); inp.addEventListener('change', onFile); $('#drop').append(inp);
  };
  const showVerify = () => {
    const v = up.verify, el = $('#verify');
    if (v.ok) { el.innerHTML = `<div class="alert ok" style="margin:0"><p>✔ ${v.method === 'exif' ? '照片的拍攝位置' : '你現在的位置'}距離這棵樹約 ${Math.round(v.dist)} 公尺（${MATCH_RADIUS_M} 公尺內），確認是這棵。照片可得 <b>${pPhoto} 點</b>。</p></div>`; return setSubmit(); }
    if (v.method === 'none') { el.innerHTML = `<div class="alert warn" style="margin:0"><p>這張照片沒有拍攝位置，也拿不到你現在的位置，<b>照片照收，但不給點數</b>。</p></div>`; return setSubmit(); }
    const cands = nearbyTrees(S.trees, v.lat, v.lng).slice(0, 6);
    el.innerHTML = `<div class="alert warn" style="margin:0"><p>${v.method === 'exif' ? '照片的拍攝位置' : '你現在的位置'}離這棵樹約 <b>${Math.round(v.dist)} 公尺</b>，超過 ${MATCH_RADIUS_M} 公尺。手機定位常有 5–20 公尺誤差，你拍的是不是附近這幾棵？</p>
      ${cands.length ? `<div class="choice" style="margin-top:8px">${cands.map((c, i) => `<button type="button" class="btn" data-c="${i}">${esc(c.t.species)}・${Math.round(c.d)} m</button>`).join('')}</div>` : `<p>${CANDIDATE_RADIUS_M} 公尺內找不到登錄的樹。</p>`}
      <p style="margin-top:8px"><button type="button" class="btn" id="keep-here">都不是，仍上傳到這棵（不給點數）</button></p></div>`;
    el.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
      const c = cands[+b.dataset.c];
      if (c.t.id === t.id) { up.verify = { ...v, ok: true, dist: c.d }; return showVerify(); }
      S.pending = { ...up, treeId: c.t.id, verify: { ...v, ok: c.d <= MATCH_RADIUS_M, dist: c.d } };
      S.tab = 'report'; go(`#/tree/${c.t.id}`);
    }));
    $('#keep-here').onclick = () => { el.innerHTML = '<p class="privacy">好，照片會上傳到這棵樹，但這次不給點數。</p>'; setSubmit(); };
    setSubmit();
  };
  async function onFile(e) {
    const f = e.target.files[0]; if (!f) return;
    $('#drop-text') && ($('#drop-text').textContent = '處理中…');
    try {
      let loc = await readExifGps(f), method = 'exif';
      if (!loc) { $('#verify').innerHTML = '<p class="privacy">照片沒有拍攝位置，改用你現在的位置比對（瀏覽器會詢問定位權限）…</p>'; loc = await browserLocation(); method = loc ? 'browser' : 'none'; }
      const photo = await cleanPhoto(f);
      const dist = loc ? distM(loc.lat, loc.lng, t.lat, t.lng) : null;
      up = { treeId: t.id, photo, verify: loc ? { method, lat: loc.lat, lng: loc.lng, dist, ok: dist <= MATCH_RADIUS_M } : { method: 'none', ok: false } };
      showPreview(); showVerify();
    } catch { $('#drop-text') && ($('#drop-text').textContent = '這張照片讀不了，換一張試試'); }
  }
  $('#photo').addEventListener('change', onFile);
  if (up) { showPreview(); showVerify(); }
  $('#report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const nick = String(fd.get('nick') || '').trim() || S.nick;
    S.nick = nick; store.set('nick', nick);
    $('#submit').disabled = true;
    const gain = (up?.photo && up.verify?.ok ? pPhoto : 0) + POINTS.report;
    try {
      const saved = await postEvent({ treeId: t.id, role: 'citizen', kind: up?.photo ? 'photo' : 'report', result: fd.get('status'), note: fd.get('note'), nickname: nick, photo: up?.photo || null, pts: gain, verify: up?.verify ? { method: up.verify.method, dist: up.verify.dist == null ? null : Math.round(up.verify.dist), ok: !!up.verify.ok } : null });
      const got = typeof saved.pts === 'number' && !saved.local ? saved.pts : gain;
      store.set('points', store.get('points', 0) + got);
      if (up?.photo) { S.photoed = S.photoed || new Set(); S.photoed.add(t.id); }
      if (up?.photo && up.verify?.ok) { const my = store.get('contrib', []); my.push({ treeId: t.id, at: Date.now(), never: days < 0, dist: t.dist || '' }); store.set('contrib', my.slice(-200)); }
      showToast(`謝謝！獲得 ${got} 點，已記錄到這棵樹的時間軸`);
      if (t.id.startsWith('HOLE-')) { e.target.reset(); $('#submit').disabled = false; getEvents(t.id).then((l) => { $('#reports').innerHTML = tlHtml(l.map(liveToTl)); }); return; }
      S.tab = 'life'; renderTab(t);
    } catch (err) { showToast('送出失敗：' + err.message); $('#submit').disabled = false; }
  });
  getEvents(t.id).then((list) => {
    const ph = list.filter((x) => x.photo).sort((a, b) => (a.at < b.at ? -1 : 1));
    $('#photo-strip') && ($('#photo-strip').innerHTML = ph.length ? `<div class="strip">${ph.map((e) => `<figure><img src="${esc(e.photo)}" alt="回報照片" loading="lazy"><figcaption>${esc(fmtDate(e.at).slice(0, 10))}<br><span class="badge live">待驗證</span></figcaption></figure>`).join('')}</div>
      <p class="privacy">示範，未送交市府</p>` : '<p class="privacy">還沒有照片</p>');
    const c = list.filter((x) => x.role === 'citizen');
    $('#reports') && ($('#reports').innerHTML = c.length ? tlHtml(c.map(liveToTl)) : '<p class="privacy">還沒有人回報。成為第一個！</p>');
    const key = store.get('adminKey', '');
    if (key && $('#reports')) {
      $('#reports').querySelectorAll('.tl li').forEach((li, i) => {
        const e = c[c.length - 1 - i]; if (!e || e.local) return;
        const b = document.createElement('button'); b.className = 'btn mini'; b.textContent = '管理：隱藏這筆';
        b.onclick = async () => {
          const r = await fetch(`/api/events/${encodeURIComponent(e.id)}`, { method: 'DELETE', headers: { 'x-admin-key': key } });
          showToast(r.ok ? '已隱藏' : '密語不對或沒有權限'); if (r.ok) li.remove();
        };
        li.append(b);
      });
    }
  });
}

// ---------- vendor ----------
function renderVendorFlow(t, wo, statusAlert) {
  const box = $('#vendor-flow');
  if (S.vendor.supervisor && wo) return renderSupervisor(t, wo, statusAlert, box);
  if (!wo || wo.order.vendor !== S.vendor.id) {
    box.innerHTML = `<div class="alert danger"><h3>⛔ 不在你的施工範圍</h3><p>這棵樹不屬於「${esc(S.vendor.name)}」承攬的任何施工案。<b>不得移除、修剪或移植。</b>如果現場與圖面不符，請回報監造。</p></div>`;
    return;
  }
  const st = S.vendorSteps?.[t.id] || { tag: false, ack: false };
  S.vendorSteps = { ...(S.vendorSteps || {}), [t.id]: st };
  box.innerHTML = `
    ${statusAlert(true)}
    <div class="steps">
      <div class="step ${st.tag ? 'done' : ''}">
        <h4>① 現場核對樹牌</h4>
        ${st.tag ? '<p>✔ 樹牌編號相符</p>' : `<label class="field">輸入樹幹上樹牌的編號<input id="tag" placeholder="${esc(t.id.slice(0, 4))}…" autocapitalize="characters"></label>
        <div class="actions"><button class="btn primary" id="tag-ok">核對</button><button class="btn" id="tag-fill">demo：帶入編號</button></div>`}
      </div>
      <div class="step ${st.ack ? 'done' : st.tag ? '' : 'locked'}">
        <h4>② 確認處置方式（施工前）</h4>
        ${st.ack ? '<p>✔ 已確認並留下施工前紀錄</p>' : `<label style="display:flex;gap:8px;font-size:14px"><input type="checkbox" id="ack" ${st.tag ? '' : 'disabled'}> 我已確認本樹核定為「${STATUS[wo.status].label}」，並會依此施工</label>
        <div class="actions"><button class="btn primary" id="ack-ok" ${st.tag ? '' : 'disabled'}>確認，開始施工</button></div>`}
      </div>
      <div class="step ${st.ack ? '' : 'locked'}">
        <h4>③ 施工後回報</h4>
        <div class="choice">${['已移植', '已移除', '保留未動', '發現異常'].map((s) => `<label><input type="radio" name="vres" value="${s}" ${st.ack ? '' : 'disabled'}><span>${s}</span></label>`).join('')}</div>
        <label class="field" style="margin-top:8px">施工後照片<input type="file" accept="image/*" capture="environment" id="vphoto" ${st.ack ? '' : 'disabled'}></label>
        <label class="field">說明<input id="vnote" maxlength="200" ${st.ack ? '' : 'disabled'}></label>
        <div class="actions"><button class="btn sun" id="vsubmit" ${st.ack ? '' : 'disabled'}>送出施工回報</button></div>
      </div>
    </div>`;
  $('#tag-fill')?.addEventListener('click', () => { $('#tag').value = t.id; });
  $('#tag-ok')?.addEventListener('click', () => {
    if ($('#tag').value.trim().toUpperCase() === t.id.toUpperCase()) { st.tag = true; renderVendorFlow(t, wo, statusAlert); }
    else modal(`<h3 style="color:var(--danger)">樹牌不符</h3><p>你輸入的編號和圖面上這棵樹不一樣。<b>先停工</b>，確認是不是站錯樹，或樹牌掉了。</p><button class="btn primary" onclick="document.getElementById('modal').hidden=true">知道了</button>`, 'alarm');
  });
  $('#ack-ok')?.addEventListener('click', async () => {
    if (!$('#ack').checked) return showToast('請先勾選確認');
    st.ack = true;
    await postEvent({ treeId: t.id, role: 'vendor', kind: 'precheck', vendor: S.vendor.name, result: `核定${STATUS[wo.status].label}`, note: '樹牌核對相符' }).catch(() => {});
    renderVendorFlow(t, wo, statusAlert);
  });
  $('#vsubmit')?.addEventListener('click', async () => {
    const res = box.querySelector('input[name=vres]:checked')?.value;
    if (!res) return showToast('請選擇施工結果');
    const f = $('#vphoto').files[0];
    const photo = f ? await cleanPhoto(f).catch(() => null) : null;
    const mismatch = (res === '已移除' && wo.status !== 'remove') || (res === '已移植' && wo.status === 'keep');
    const send = async (kind) => {
      await postEvent({ treeId: t.id, role: 'vendor', kind, vendor: S.vendor.name, result: res, note: $('#vnote').value, photo });
      showToast(kind === 'alarm' ? '已送出異常回報，系統已通報公園處與監造（模擬）' : '已送出施工回報');
      S.tab = 'life'; renderTree(t.id);
    };
    if (!mismatch) return send('report');
    const m = modal(`
      <h3 style="color:var(--danger);font-size:22px">⚠ 與核定處置不符</h3>
      <p>這棵樹核定為 <b style="font-size:20px">「${STATUS[wo.status].label}」</b>，你回報的是 <b>「${res}」</b>。</p>
      <p>送出後系統會<b>立即通報公園處與監造單位</b>、本案暫停驗收請款，並把這筆紀錄公開在這棵樹的時間軸上（模擬流程）。</p>
      <div class="actions"><button class="btn" id="m-back">返回修改</button><button class="btn danger" id="m-send">確定送出異常回報</button></div>`, 'alarm');
    $('#m-back').onclick = m.close;
    $('#m-send').onclick = async () => { m.close(); await send('alarm'); };
  });
}

async function renderSupervisor(t, wo, statusAlert, box) {
  const ev = await getEvents(t.id);
  const alarm = ev.filter((e) => e.kind === 'alarm').pop();
  const reviewed = ev.some((e) => e.kind === 'review');
  box.innerHTML = `${statusAlert(true)}
    ${alarm ? `<div class="alert danger"><h3>⚠ 待複核：施工結果與核定不符</h3><p>${esc(alarm.vendor)} 回報「${esc(alarm.result)}」・${esc(fmtDate(alarm.at))}</p>
      ${reviewed ? '<p>✔ 已複核</p>' : '<div class="actions"><button class="btn danger" id="sv-stop">複核：確認異常，全案停工</button><button class="btn" id="sv-ok">複核：回報有誤，現場無異狀</button></div>'}</div>`
      : '<div class="alert ok"><p>這棵樹目前沒有異常回報。</p></div>'}`;
  const send = async (result) => {
    await postEvent({ treeId: t.id, role: 'vendor', kind: 'review', vendor: S.vendor.name, result, note: '監造複核' });
    showToast('已送出複核結果'); S.tab = 'life'; renderTree(t.id);
  };
  $('#sv-stop')?.addEventListener('click', () => send('確認異常，全案停工'));
  $('#sv-ok')?.addEventListener('click', () => send('回報有誤，現場無異狀'));
}

function vendorLogin() {
  const m = modal(`
    <h3>廠商登入 <span class="badge sim">模擬</span></h3>
    <p class="privacy">示範帳號都是虛構廠商。正式版會接市府帳號與標案系統。</p>
    <form id="vlogin" class="report">
      <label class="field">廠商帳號<select name="acc">${VENDORS.map((v) => `<option value="${v.id}">${esc(v.name)}（${v.account}）</option>`).join('')}</select></label>
      <label class="field">密碼<input type="password" name="pw" value="demo1234" autocomplete="off"></label>
      <button class="btn primary" type="submit">登入</button>
    </form>`);
  $('#vlogin').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = VENDORS.find((x) => x.id === new FormData(e.target).get('acc'));
    S.vendor = v; store.set('vendor', v); m.close();
    document.body.classList.add('vendor-mode'); applyFilters();
    const o = WORK_ORDERS.find((x) => v.supervisor || x.vendor === v.id);
    if (o) S.map.flyTo({ center: o.center, zoom: 15.6, padding: innerWidth <= 760 ? { bottom: innerHeight * 0.6 } : { right: 440 * uiZ() } });
    if (location.hash.startsWith('#/tree/')) route(); else renderVendorHome();
  });
}

function renderVendorHome() {
  if (!S.vendor) return vendorLogin();
  applyFilters();
  const sup = !!S.vendor.supervisor;
  const orders = WORK_ORDERS.filter((o) => sup || o.vendor === S.vendor.id);
  const counts = (o) => {
    const c = { keep: 0, move: 0, remove: 0 };
    for (const t of S.trees) { const w = workOrderFor(t); if (w && w.order === o) c[w.status]++; }
    return c;
  };
  openPanel(`
    <div class="eyebrow">${sup ? '監造' : '施工廠商'} <span class="badge sim">模擬</span>・${esc(S.vendor.name)}</div>
    <form id="tag-search" class="tag-search">
      <label for="tag-q"><b>輸入或掃樹牌編號</b></label>
      <input id="tag-q" placeholder="例如 DA0041111048" autocapitalize="characters" autocomplete="off" inputmode="text">
      <button class="btn primary" type="submit">查核</button>
    </form>
    <p class="privacy"><b style="color:var(--danger)">紅＝保留</b>・<b style="color:var(--warn)">橘＝移植</b>・<b style="color:var(--ok)">藍＝可移除</b></p>
    <h3 class="h3">${sup ? '監造中的施工案' : '承攬的施工案'}</h3>
    ${orders.map((o) => { const c = counts(o); return `<button class="wo" data-wo="${o.id}"><b>${esc(o.name)}</b><small>${o.id}・通報 ${o.noticeDate}・預定施工 ${o.start}</small>
      <div class="counts"><span class="c-keep">保留 ${c.keep}</span><span class="c-move">移植 ${c.move}</span><span class="c-remove">可移除 ${c.remove}</span></div></button>`; }).join('')}
    <div class="actions"><button class="btn" id="vlogout">登出</button></div>`);
  $('#tag-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#tag-q').value.trim().toUpperCase();
    const t = treeFromId(id);
    if (!t) return modal(`<h3 style="color:var(--danger)">查無此樹牌</h3><p>「${esc(id)}」不在樹籍資料裡。<b>先停工</b>，確認編號是否抄錯或樹牌遺失，並通知監造。</p><button class="btn primary" onclick="document.getElementById('modal').hidden=true">知道了</button>`, 'alarm');
    S.vendorSteps = { ...(S.vendorSteps || {}), [t.id]: { tag: true, ack: false } };
    go(`#/tree/${t.id}`);
  });
  body.querySelectorAll('[data-wo]').forEach((b) => b.addEventListener('click', () => {
    const o = WORK_ORDERS.find((x) => x.id === b.dataset.wo);
    S.map.flyTo({ center: o.center, zoom: 16.3, padding: innerWidth <= 760 ? { bottom: innerHeight * 0.6 } : { right: 440 * uiZ() } });
    if (innerWidth <= 760) panel.classList.add('peek');
  }));
  $('#vlogout').onclick = () => { S.vendor = null; store.set('vendor', null); history.replaceState(null, '', '/vendor'); switchRole('vendor', false); };
}

// ---------- other pages ----------
async function leaderboard() {
  const ev = await getAllEvents();
  const pts = new Map(SIM_USERS.map((u) => [u.name, { ...u }]));
  for (const e of ev) {
    if (e.role !== 'citizen' || !e.nickname) continue;
    const u = pts.get(e.nickname) || { name: e.nickname, pts: 0 };
    u.pts += typeof e.pts === 'number' ? e.pts : POINTS.report;
    pts.set(e.nickname, u);
  }
  return [...pts.values()].sort((a, b) => b.pts - a.pts);
}

function rewardsHtml() {
  const my = store.get('points', 0);
  return `<ul class="list">${REWARDS.map((r, i) => { const co = COMPANIES.find((c) => c.id === r.sponsor); return `<li>
    <div style="display:flex;gap:10px;align-items:center">${co ? `<img src="${co.logo}" width="32" height="32" style="border-radius:8px" alt="">` : '<span style="width:32px;text-align:center">🌳</span>'}
    <div><b>${esc(r.name)}</b><br><small class="privacy">${co ? '贊助：' + esc(co.name) : '市府活動'}・${r.cost} 點</small></div></div>
    <button class="btn ${my >= r.cost ? 'sun' : ''}" data-redeem="${i}" ${my >= r.cost ? '' : 'disabled'}>兌換</button></li>`; }).join('')}</ul>
    <p class="privacy">贈品、企業皆虛構 <span class="badge sim">模擬</span></p>`;
}
function bindRedeem() {
  body.querySelectorAll('[data-redeem]').forEach((b) => b.addEventListener('click', () => {
    const r = REWARDS[+b.dataset.redeem];
    store.set('points', store.get('points', 0) - r.cost);
    showToast(`已兌換「${r.name}」（模擬）`); route();
  }));
}

const FRAUD_HTML = `<details class="fraud"><summary>造假賺點數的預防機制（規劃，黑客松版未實作）</summary><ul>
  <li>照片的 EXIF 位置可以偽造，所以要和拍攝當下的瀏覽器定位、拍攝時間交叉比對。</li>
  <li>同一張或很像的照片重複上傳：用感知雜湊比對擋掉。</li>
  <li>每人每棵樹有冷卻時間、每人每天有上限。</li>
  <li>帳號綁手機號碼。</li>
  <li>移動速度異常（短時間內跨區上傳）就暫停計分。</li>
  <li>點數先列「待確認」，等其他人之後上傳同一棵樹、或隨機人工抽查確認後才入帳。</li>
  <li>排行榜前段人工審核。</li>
  <li>獎勵用抽獎機會，不直接換現金，降低造假誘因。</li>
  <li>未來：用 AI 判讀照片裡是不是真的有樹、是不是同一棵。</li>
</ul></details>`;

// ---------- 功能目錄、獨立頁、單棵樹區塊 ----------
// 給功能模組用的工具箱（新功能只透過這個介面拿資料與畫面工具，不直接改 app.js）
function ctx() {
  return {
    S, ROLE, esc, bar, fmtDate, go, showToast, openPanel, select, flyTo, store, distM,
    map: S.map, trees: S.trees, treeFromId, loadShade, loadPlant, getAllEvents, getEvents, postEvent,
    WORK_ORDERS, workOrderFor, STATUS, COMPANIES, adoptionFor, LEVELS,
    badge: (k) => `<span class="badge ${TAG[k] ? TAG[k][0] : k}">${TAG[k] ? TAG[k][1] : k}</span>`,
    fetchJSON: async (u) => (await fetch(u)).json(),
    isOn, setFeature, layers: S.layers, refresh: () => { syncChips(); applyFilters(); },
  };
}
const MATURITY = { stable: ['real', '穩定'], exp: ['est', '實驗中'] };
const AUD = { public: '民眾', gov: '市府', vendor: '施工廠商', esg: '企業', plan: '市府', mayor: '市府' };
const audLabels = (list) => [...new Set(list.map((a) => AUD[a] || a))];

function renderCatalog() {
  const q = params();
  openPanel(`<div class="page">
    <div class="eyebrow">單一入口</div><h2>功能目錄</h2>
    ${q.has('preset') ? `<p class="tree-sub">組合「${esc(q.get('preset'))}」</p>` : ''}
    <div class="actions"><button class="btn" data-preset="demo">全部穩定＋實驗功能</button><button class="btn" data-preset="minimal">精簡組合</button><button class="btn" data-preset="role">回到角色預設</button></div>
    <div class="fcards">${[...FEATURES].filter((f) => !f.hidden).sort((a, b) => forRole(b.featured) - forRole(a.featured)).map((f) => `<article class="fcard ${isOn(f.id) ? 'on' : ''} ${forRole(f.featured) ? 'featured' : ''}">
      <header><b>${esc(f.title)}</b>${forRole(f.featured) ? '<span class="badge live">推薦</span>' : ''}<span class="badge ${MATURITY[f.maturity || 'exp'][0]}">${MATURITY[f.maturity || 'exp'][1]}</span></header>
      <p>${esc(f.oneLiner)}</p>
      <div class="ftags">${audLabels(f.audience).map((a) => `<span class="badge kind">${a}</span>`).join('')}${(f.dataStatus || []).map((d) => ctx().badge(d)).join('')}</div>
      <footer>${f.core ? '<small class="privacy">核心功能（常駐）</small>' : `<label class="switch"><input type="checkbox" data-toggle="${f.id}" ${isOn(f.id) ? 'checked' : ''}> ${isOn(f.id) ? '開啟中' : '已關閉'}</label>`}
        <button class="btn mini" data-page="${f.id}">獨立頁</button>${f.chips && !STANDALONE.has(f.id) ? `<button class="btn mini" data-overlay="${f.id}">疊到地圖</button>` : ''}</footer>
    </article>`).join('')}</div>
  </div>`);
  body.querySelectorAll('[data-toggle]').forEach((c) => c.addEventListener('change', () => { setFeature(c.dataset.toggle, c.checked); renderCatalog(); }));
  body.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => go(`#/f/${b.dataset.page}`)));
  body.querySelectorAll('[data-overlay]').forEach((b) => b.addEventListener('click', () => {
    const f = FEAT.get(b.dataset.overlay);
    if (!isOn(f.id)) setFeature(f.id, true);
    const p = Object.keys(PURPOSES).find((k) => f.chips.includes(PURPOSES[k].layer));
    go('#/'); if (p) setPurpose(p, true); else { for (const k of f.chips) S.layers[k] = true; syncChips(); applyFilters(); }
  }));
  body.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const q2 = params(); q2.delete('f'); q2.delete('preset');
    if (b.dataset.preset !== 'role') q2.set('preset', b.dataset.preset);
    history.replaceState(null, '', `${location.pathname}${q2.toString() ? '?' + q2 : ''}${location.hash}`);
    S.feat = computeFeatures(); S.layers = defaultLayers(); renderRoleChrome(); applyFilters(); renderCatalog(); ensureInit();
  }));
}

function renderNews(id) {
  const n = NEWS[id], co = COMPANIES.find((c) => c.id === id);
  if (!n || !co) return go('#/');
  const back = S.selected && !S.selected.demo ? `#/tree/${S.selected.id}` : '#/';
  openPanel(`<div class="page news">
    <div class="alert warn"><p><b>示意新聞</b>（虛構）<span class="badge sim">模擬</span></p></div>
    <div class="news-head"><img src="${co.logo}" width="48" height="48" alt=""><div><b>${esc(co.name)}</b><br><small class="privacy">${esc(n.date)}・示意新聞</small></div></div>
    <h2>${esc(n.title)}</h2>
    ${n.body.map((x) => `<p>${esc(x)}</p>`).join('')}
    <div class="actions"><button class="btn primary" data-go="${back}">← 回到這棵樹</button><button class="btn" data-go="#/story/esg">看認養流程</button></div>
  </div>`);
  body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}
function leavePage() {
  if (S.page && STANDALONE.has(S.page)) for (const k of FEAT.get(S.page).chips || []) S.layers[k] = false;
  S.page = null;
}
async function renderFeaturePage(id, asHome = false) {
  const f = FEAT.get(id);
  if (!f) { showToast('找不到這個功能'); return go('#/features'); }
  // 獨立頁功能的地圖疊加只在自己的頁面上打開，離開就關
  if (!isOn(f.id) && !f.core && f.ready) setFeature(f.id, true);
  if (S.page !== id) { leavePage(); S.page = id; if (STANDALONE.has(id)) for (const k of f.chips || []) S.layers[k] = true; applyFilters(); }
  const r = f.rollout || {};
  openPanel(`<div class="page fpage">
    <div class="eyebrow">${asHome ? esc(R.label) + ' ' : ''}${(f.dataStatus || []).map((d) => ctx().badge(d)).join('')}</div>
    <h2>${esc(f.title)}</h2>
    <p class="tree-sub">${esc(f.oneLiner)}</p>
    ${!isOn(f.id) && !f.core ? `<div class="alert warn"><p>這個功能目前關閉。<button class="btn mini" id="fp-on">開啟</button></p></div>` : ''}
    <div id="fp-body">${f.page ? '載入中…' : ''}</div>
    ${asHome ? '' : `<details class="fraud"><summary>產品說明</summary>
      <dl class="fdl">
        <dt>要解決什麼問題</dt><dd>${esc(f.problem || '')}</dd>
        <dt>給誰</dt><dd>${audLabels(f.audience).join('、')}</dd>
        <dt>怎麼用</dt><dd>${esc(f.howto || '')}</dd>
        <dt>資料與狀態</dt><dd>${(f.dataStatus || []).map((d) => ctx().badge(d)).join(' ')}${(f.sources || []).map((s) => `<br><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>${s.date ? `（${esc(s.date)}）` : ''}`).join('')}</dd>
        <dt>限制與警語</dt><dd>${esc(f.limits || '')}</dd>
        <dt>100 天落地</dt><dd>局處：${esc(r.agencies || '—')}<br>資料：${esc(r.data || '—')}<br>經費：${esc(r.budget || '—')}<br>推廣：${esc(r.promo || '—')}</dd>
      </dl></details>
      <div class="actions"><button class="btn" data-go="#/features">← 功能目錄</button></div>`}
  </div>`);
  $('#fp-on')?.addEventListener('click', () => { setFeature(f.id, true); renderFeaturePage(id, asHome); });
  body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  if (f.page) {
    const root = $('#fp-body');
    try { root.innerHTML = await f.page(ctx()); f.bindPage && f.bindPage(root, ctx()); } catch (e) { console.error(e); root.innerHTML = '<p class="privacy">這個功能載入失敗。</p>'; }
  } else if (f.nav?.length) $('#fp-body').innerHTML = `<div class="actions"><button class="btn primary" data-go="${NAV[f.nav[0]].hash}">打開「${esc(NAV[f.nav[0]].label)}」</button></div>`;
  body.querySelectorAll('#fp-body [data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

async function renderTreeSections(t) {
  const box = $('#feature-sections'); if (!box) return;
  const parts = [];
  const links = [];
  for (const f of FEATURES) {
    if (!f.onTree || !isOn(f.id)) continue;
    try {
      const html = await f.onTree(ctx(), t);
      if (html) (STANDALONE.has(f.id) ? links.push(f) : parts.push([f, html]));
    } catch (e) { console.warn(f.id, e); }
  }
  if (S.selected !== t) return;
  box.innerHTML = (links.length ? `<section class="fsec flinks"><h3 class="h3">延伸分析</h3>${links.map((f) => `<a href="#/f/${f.id}"><b>${esc(f.title)}</b><span>${esc(TREE_TEASER[f.id] || f.oneLiner)}</span><i>›</i></a>`).join('')}</section>` : '') + parts.map(([f, html]) => `<section class="fsec" data-f="${f.id}"><h3 class="h3">${esc(f.title)} ${(f.dataStatus || []).map((d) => ctx().badge(d)).join('')}</h3>${html}</section>`).join('');
  for (const [f] of parts) if (f.bindTree) try { f.bindTree(box.querySelector(`[data-f="${f.id}"]`), ctx(), t); } catch (e) { console.warn(f.id, e); }
}

// ---------- 角色首頁 ----------
function districtCounts() {
  const m = new Map();
  for (const t of S.trees) m.set(t.dist, (m.get(t.dist) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const bar = (v, max, color = 'var(--leaf)') => `<span class="bar"><i style="width:${Math.round((v / max) * 100)}%;background:${color}"></i></span>`;

const QUALITY = () => {
  const k1 = S.trees.filter((t) => t.kind === 1);
  return [
    ['胸徑為 0', S.trees.filter((t) => t.dbh === 0).length, '9 千多棵樹胸徑記為 0：是沒量、小苗，還是缺值？欄位要能分辨'],
    ['胸徑超過 3 公尺', S.trees.filter((t) => t.dbh > 300).length, `最大值 ${S.trees.reduce((m, t) => Math.max(m, t.dbh || 0), 0)} 公分，最可能是單位或輸入錯誤`],
    ['樹高超過 40 公尺', S.trees.filter((t) => t.height > 40).length, '台北行道樹很少超過 30 公尺，需複核'],
    ['調查日期空白或異常', S.trees.filter((t) => !t.survey).length, '含公園樹 326 筆 1899-12-30、行道樹 1 筆 1900-01-01（原始檔實讀）'],
    ['調查日期在 2016 年以前', S.trees.filter((t) => t.survey && +t.survey.slice(0, 4) <= 2016).length, '十年沒更新的樹況'],
    ['公園名稱空白', k1.filter((t) => !t.place).length, '公園樹找不到所屬公園'],
    ['樹種空白', S.trees.filter((t) => t.species === '未登錄').length, ''],
  ];
};

async function renderDash() {
  if (R.purposes.includes('review')) usePurpose('review');
  const ev = await getAllEvents();
  const alarms = ev.filter((e) => e.kind === 'alarm').reverse();
  const reports = ev.filter((e) => e.role === 'citizen').reverse();
  const track = store.get('track', {});
  const pending = reports.filter((e) => !track[e.treeId]);
  const top = S.reviewOrder.slice(0, 50).map((i) => S.trees[i]);
  const lvl = (t) => LEVELS[t.rl] || LEVELS[0];
  // 追蹤清單：異常通報、民眾回報、複查優先前 50 株
  const rows = [];
  const seen = new Set();
  for (const e of alarms) { const t = treeFromId(e.treeId); if (t && !seen.has(t.id)) { seen.add(t.id); rows.push({ t, src: '廠商異常通報', badge: 'live', risk: 4 }); } }
  for (const e of reports) { const t = treeFromId(e.treeId); if (t && !seen.has(t.id)) { seen.add(t.id); rows.push({ t, src: `民眾回報：${e.result || '照片'}`, badge: 'live', risk: Math.max(2, t.rl || 0) }); } }
  for (const t of top) if (!seen.has(t.id)) { seen.add(t.id); rows.push({ t, src: '複查優先序', badge: 'est', risk: t.rl }); }
  const st = (t) => track[t.id] || '待指派';
  const q = QUALITY();
  openPanel(`<div class="page">
    <div class="eyebrow">主管機關</div><h2>管理總覽</h2>
    <div class="cards3">
      <button class="kcard amber" data-card="report"><b>${pending.length}</b><span>民眾回報待審</span></button>
      <button class="kcard dark" data-card="review"><b>50</b><span>複查優先前 50 株</span></button>
    </div>
    ${alarms.length ? `<div class="alert danger"><h3>⚠ 施工異常</h3>${alarms.slice(0, 3).map((e) => `<p><a href="#/tree/${esc(e.treeId)}">${esc(e.treeId)}</a>　${esc(e.vendor)} 回報「${esc(e.result)}」，與核定處置不符・${esc(fmtDate(e.at))} <span class="badge live">本站回報</span></p>`).join('')}</div>` : ''}

    <h3 class="h3">複查優先序權重 <span class="badge est">推估</span></h3>
    <p class="privacy">拖拉即時重排・非病況診斷</p>
    <div class="sliders">
      <label>久未調查（≤ 2016 或空白）<input type="range" min="0" max="100" value="${S.w.old}" data-w="old"><output>${S.w.old}</output></label>
      <label>大胸徑（≥ 80 公分）<input type="range" min="0" max="100" value="${S.w.big}" data-w="big"><output>${S.w.big}</output></label>
      <label>褐根病常見寄主（榕樹）<input type="range" min="0" max="100" value="${S.w.host}" data-w="host"><output>${S.w.host}</output></label>
    </div>

    <h3 class="h3">追蹤清單</h3>
    <div class="track-wrap"><table class="track">
      <thead><tr><th>樹種／地點</th><th>來源</th><th>優先</th><th>距上次調查</th><th>狀態</th></tr></thead>
      <tbody>${rows.slice(0, 40).map(({ t, src, badge, risk }) => { const d = daysSince(t.survey); return `<tr data-id="${esc(t.id)}">
        <td><b>${esc(t.species)}</b><br><small>${esc(t.dist)} ${esc(t.place)}</small></td>
        <td><span class="badge ${badge}">${esc(src)}</span></td>
        <td><i class="dot" style="background:${LEVELS[risk].color}"></i></td>
        <td>${d == null ? '<small>空白／異常</small>' : `${Math.round(d / 365 * 10) / 10} 年`}</td>
        <td>${st(t) === '待指派' ? `<button class="btn mini" data-assign="${esc(t.id)}">指派複核</button>` : `<small>${esc(st(t))}</small>`}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="privacy">「指派複核」是模擬流程（存在這台電腦的瀏覽器）。點一列地圖會飛過去。</p>

    <h3 class="h3">資料品質 <span class="badge real">真實</span></h3>
    <p class="privacy">開放資料本身的問題，等於直接給公園處年底改版資訊網的建議清單。</p>
    <ul class="list dist">${q.map(([k, n, note]) => `<li><span style="flex:1"><b>${esc(k)}</b>${note ? `<br><small class="privacy">${esc(note)}</small>` : ''}</span><b>${n.toLocaleString()}</b></li>`).join('')}</ul>

    <h3 class="h3">全市彙總（只有大類，沒有逐樹原因）</h3>
    <div class="facts">
      <div class="fact"><b>2,691</b><span>2025 人工移除 <span class="badge est">媒體轉述</span></span></div>
      <div class="fact"><b>473</b><span>2025 天災 <span class="badge est">媒體轉述</span></span></div>
      <div class="fact"><b>3,164</b><span>合計</span></div>
    </div>
    <ul class="list dist">
      <li><small class="privacy">議員引述，市府原表未見</small></li>${[['自然死亡', 996], ['腐朽', 639], ['病蟲害', 522], ['其他', 534]].map(([k, n]) => `<li><span style="width:70px">${k}</span>${bar(n, 996, '#7b877f')}<b>${n}</b></li>`).join('')}
    </ul>
    <details class="fraud"><summary>管理員：隱藏不當照片</summary><p class="privacy">輸入管理密語後，樹木頁的「大家的回報」會出現「隱藏這筆」按鈕。</p>
      <div class="actions"><input id="admin-key" type="password" placeholder="管理密語" value="${esc(store.get('adminKey', ''))}" style="padding:8px 12px;border-radius:10px;border:1px solid var(--line)"><button class="btn" id="admin-save">儲存</button></div></details>
    <p class="privacy">來源：市府 2026-07-12 新聞稿；2,691／473 為媒體轉述</p>
  </div>`);
  $('#admin-save').onclick = () => { store.set('adminKey', $('#admin-key').value.trim()); showToast('已儲存（只存在這台電腦）'); };
  body.querySelectorAll('[data-w]').forEach((inp) => inp.addEventListener('input', () => {
    inp.nextElementSibling.textContent = inp.value;
    S.w = { ...S.w, [inp.dataset.w]: +inp.value }; store.set('weights', S.w);
    clearTimeout(renderDash._t); renderDash._t = setTimeout(recomputeReview, 250);
  }));
  body.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-assign]')) return;
    const t = treeFromId(tr.dataset.id); select(t); flyTo(t, 17); if (innerWidth <= 760) panel.classList.add('peek');
  }));
  body.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => {
    const tr2 = store.get('track', {}); tr2[b.dataset.assign] = '已指派・監造複核（模擬）'; store.set('track', tr2);
    showToast('已指派監造複核（模擬）'); renderDash();
  }));
  body.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.card;
    if (k === 'review') { usePurpose('review'); S.map.flyTo({ center: [121.5435, 25.056], zoom: 12 }); showToast('地圖顯示複查優先序，深紅＝前 50 株'); }
    else { const list = k === 'alarm' ? alarms : pending; if (!list.length) return showToast('目前沒有'); go(`#/tree/${list[0].treeId}`); }
  }));
}

function renderEsg() {
  usePurpose('adopt');
  const cnt = new Map();
  for (const t of S.trees) { const a = adoptionFor(t); if (a) cnt.set(a.company.id, (cnt.get(a.company.id) || 0) + 1); }
  openPanel(`<div class="page">
    <div class="eyebrow">企業認養 <span class="badge sim">模擬</span></div><h2>認養總覽</h2>
    <p class="tree-sub">企業皆虛構 <span class="badge sim">模擬</span></p>
    <ul class="list">${COMPANIES.map((c) => `<li><div style="display:flex;gap:10px;align-items:center"><img src="${c.logo}" width="40" height="40" style="border-radius:10px" alt=""><div><b>${esc(c.name)}</b><br><small class="privacy">${ADOPTIONS.filter((a) => a.company === c.id).map((a) => esc(a.label)).join('、')}</small></div></div><b>${(cnt.get(c.id) || 0).toLocaleString()} 棵</b></li>`).join('')}</ul>
    ${isOn('adopt-proposal') ? '<div class="actions"><a class="btn primary" href="#/f/adopt-proposal">認養效益試算 ›</a><a class="btn" href="#/f/esg-report">報告書素材 ›</a></div>' : ''}
    <h3 class="h3">建議優先認養：人多但樹蔭少的地方</h3>
    <div id="esg-gap">載入中…</div>
    
  </div>`);
  loadShade().then((gj) => {
    const top = gj.features.slice().sort((a, b) => a.properties.rank - b.properties.rank).slice(0, 5);
    $('#esg-gap') && ($('#esg-gap').innerHTML = `<ul class="list">${top.map((f) => `<li><button data-st="${esc(f.properties.name)}"><b>${esc(f.properties.name)}站周邊</b><br><small class="privacy">缺蔭指數 ${f.properties.gap_score}・樹冠約 ${f.properties.canopy_pct}%（推估）</small></button><span>›</span></li>`).join('')}</ul>`);
    body.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => go(`#/station/${encodeURIComponent(b.dataset.st)}`)));
  });
}

// 規劃分數：三個代理指標轉百分位後加權。權重是政策選擇。
const PLAN_W0 = { lack: 40, ben: 35, heat: 25 };
function pctRank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(arr.length);
  idx.forEach(([, i], r) => { out[i] = arr.length > 1 ? r / (arr.length - 1) : 0; });
  return out;
}
async function planInputs() {
  if (S.planX) return S.planX;
  const [pl, sh] = await Promise.all([loadPlant(), loadShade()]);
  if (!pl) return null;
  // 樹點格網（約 50 m）
  const G = 0.0005, grid = new Map();
  for (const t of S.trees) { const k = `${Math.floor(t.lng / G)},${Math.floor(t.lat / G)}`; (grid.get(k) || grid.set(k, []).get(k)).push(t); }
  const dens = [], daily = [], gap = [];
  for (const f of pl.features) {
    const [lng, lat] = f.geometry.coordinates, gx = Math.floor(lng / G), gy = Math.floor(lat / G);
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const t of grid.get(`${gx + dx},${gy + dy}`) || []) if (distM(lat, lng, t.lat, t.lng) <= 50) n++;
    let best = null, bd = 800;
    for (const st of sh.features) { const d = distM(lat, lng, st.geometry.coordinates[1], st.geometry.coordinates[0]); if (d < bd) { bd = d; best = st; } }
    dens.push(n); daily.push(best ? best.properties.daily : 0); gap.push(best ? best.properties.gap_score : 0);
    f.properties.n50 = n; f.properties.st = best ? best.properties.name : '';
  }
  const pd = pctRank(dens), pb = pctRank(daily), ph = pctRank(gap);
  S.planX = pl.features.map((f, i) => ({ f, lack: 1 - pd[i], ben: pb[i], heat: ph[i] }));
  return S.planX;
}
function planScores(X, w) {
  const sum = w.lack + w.ben + w.heat || 1;
  for (const x of X) x.ps = Math.round((100 * (w.lack * x.lack + w.ben * x.ben + w.heat * x.heat)) / sum);
  return X.slice().sort((a, b) => b.ps - a.ps);
}

async function renderPlan() {
  usePurpose('plant');
  S.pw = S.pw || store.get('planW', PLAN_W0);
  openPanel(`<div class="page">
    <div class="eyebrow">規劃</div><h2>補種規劃：下一棵種哪裡</h2>
    <p class="tree-sub">權重是政策選擇・未現勘</p>
    <div class="sliders">
      <label>樹冠缺乏（代理：50 m 內登錄樹少）<input type="range" min="0" max="100" value="${S.pw.lack}" data-pw="lack"><output>${S.pw.lack}</output></label>
      <label>受益人數（代理：附近捷運站進出量）<input type="range" min="0" max="100" value="${S.pw.ben}" data-pw="ben"><output>${S.pw.ben}</output></label>
      <label>周邊缺蔭（代理：捷運站 300 m 樹冠推估）<input type="range" min="0" max="100" value="${S.pw.heat}" data-pw="heat"><output>${S.pw.heat}</output></label>
    </div>
    <p class="privacy">後兩項以捷運資料代理</p>
    <h3 class="h3">候選點排行 <span class="badge est">推估</span></h3>
    <div id="plan-rank">計算中…</div>
    <div class="actions"><button class="btn" id="plan-export">匯出補植清單（CSV）</button></div>
    <h3 class="h3">公平檢查：每公里人行道的行道樹 <span class="badge real">真實</span></h3>
    <div id="plan-dist">載入中…</div>
    <h3 class="h3">人多但沒樹蔭：前 10 站 <span class="badge est">推估</span></h3>
    <div id="plan-gap">載入中…</div>
    <h3 class="h3">校園樹木 <span class="badge real">真實</span></h3>
    <div id="plan-campus">載入中…</div>
  </div>`);
  if (ownedOn('part', 'campus')) campusCard($('#plan-campus')); else { $('#plan-campus').previousElementSibling.remove(); $('#plan-campus').remove(); }
  const X = await planInputs();
  const list = store.get('plantlist', {});
  const drawRank = () => {
    if (!$('#plan-rank') || !X) return;
    // 「疑資料缺漏」（附近樹穴全都對不到樹）的點不進排行，避免資料沒登錄的路段被當成最缺樹
    const top = planScores(X, S.pw).filter(({ f }) => f.properties.ctx === 'row_gap' || f.properties.ctx === 'mixed').slice(0, 15);
    $('#plan-rank').innerHTML = `<div class="track-wrap"><table class="track"><thead><tr><th>地點</th><th>分數</th><th>可種</th><th></th></tr></thead><tbody>${top.map(({ f, ps }) => { const p = f.properties, adv = plantAdvice(p.sw_width), it = list[p.id] || {}; return `<tr data-pid="${p.id}">
      <td><b>${esc(p.road || '')}</b><br><small>${esc(p.dist || '')}・50 m 內 ${p.n50} 棵${p.st ? `・近${esc(p.st)}站` : ''}</small></td>
      <td><b>${ps}</b></td><td><small>${adv.tier === 3 ? '大喬木' : adv.tier === 2 ? '小喬木' : adv.tier === 1 ? '移動植栽' : '待量'}</small></td>
      <td><button class="btn mini ${it.added ? 'on' : ''}" data-add="${p.id}">${it.added ? '✓ 已加入' : '加入補植'}</button><br><label class="mini-check"><input type="checkbox" data-survey="${p.id}" ${it.survey !== false ? 'checked' : ''}> 需會勘管線</label></td></tr>`; }).join('')}</tbody></table></div>
      <p class="privacy">點一列地圖飛過去・補植清單為模擬</p>`;
    body.querySelectorAll('tr[data-pid]').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('button, input, label')) return; go(`#/plant/${tr.dataset.pid}`); }));
    body.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { const l = store.get('plantlist', {}); const id = b.dataset.add; l[id] = { ...(l[id] || {}), added: !(l[id] || {}).added }; store.set('plantlist', l); Object.assign(list, l); drawRank(); }));
    body.querySelectorAll('[data-survey]').forEach((c) => c.addEventListener('change', () => { const l = store.get('plantlist', {}); const id = c.dataset.survey; l[id] = { ...(l[id] || {}), survey: c.checked }; store.set('plantlist', l); Object.assign(list, l); }));
  };
  drawRank();
  body.querySelectorAll('[data-pw]').forEach((inp) => inp.addEventListener('input', () => {
    inp.nextElementSibling.textContent = inp.value;
    S.pw = { ...S.pw, [inp.dataset.pw]: +inp.value }; store.set('planW', S.pw);
    clearTimeout(renderPlan._t); renderPlan._t = setTimeout(drawRank, 120);
  }));
  $('#plan-export').onclick = () => {
    const l = store.get('plantlist', {});
    const rows = X.filter((x) => l[x.f.properties.id]?.added).map(({ f }) => { const p = f.properties; return [p.id, p.dist, p.road, p.sw_width ?? '', plantAdvice(p.sw_width).title, l[p.id].survey !== false ? '是' : '否', f.geometry.coordinates[0], f.geometry.coordinates[1]]; });
    if (!rows.length) return showToast('補植清單是空的，先按「加入補植」');
    const csv = '﻿' + [['樹穴編號', '行政區', '路段', '人行道寬(m)', '建議', '需會勘管線', '經度', '緯度'], ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = '補植清單（模擬）.csv'; a.click();
  };
  fetch('/data/district-stats.json').then((r) => r.json()).then((d) => {
    if (!$('#plan-dist')) return;
    const max = Math.max(...d.rows.map((x) => x.per_km || 0));
    $('#plan-dist').innerHTML = `<ul class="list dist">${d.rows.map((x) => `<li><span style="width:56px">${esc(x.dist)}</span>${bar(x.per_km || 0, max)}<b style="width:44px;text-align:right">${x.per_km}</b><small class="privacy" style="width:72px;text-align:right">候選 ${x.candidates.toLocaleString()}</small></li>`).join('')}</ul>
      <p class="privacy">每公里人行道行道樹數</p>`;
  });
  const gj = await loadShade();
  const top = gj.features.slice().sort((a, b) => a.properties.rank - b.properties.rank).slice(0, 10);
  $('#plan-gap') && ($('#plan-gap').innerHTML = `<ul class="list dist">${top.map((f) => `<li><button data-st="${esc(f.properties.name)}" style="flex:none;width:96px">${esc(f.properties.name)}</button>${bar(f.properties.gap_score, 100, '#b2182b')}<b>${f.properties.gap_score}</b></li>`).join('')}</ul><p class="privacy">第 8 名以後的先後不穩定（換站點範圍算法會變），前幾名可參考。</p>`);
  body.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => go(`#/station/${encodeURIComponent(b.dataset.st)}`)));
}

function milestonesHtml() {
  const my = store.get('contrib', []);
  const per = new Map(); for (const c of my) per.set(c.treeId, (per.get(c.treeId) || 0) + 1);
  const ms = [
    ['首次有效貢獻', '上傳一張位置比對通過的照片', my.length >= 1],
    ['持續更新同一棵', '同一棵樹上傳 2 次以上（看得出變化）', [...per.values()].some((n) => n >= 2)],
    ['補足社區觀測', '拍一棵從沒人拍過的樹', my.some((c) => c.never)],
  ];
  return `<ul class="milestones">${ms.map(([k, d, ok]) => `<li class="${ok ? 'ok' : ''}"><b>${ok ? '✓' : '○'} ${k}</b><small>${d}</small></li>`).join('')}</ul>`;
}

async function renderRank() {
  openPanel(`<div class="page"><div class="eyebrow">遊戲化 <span class="badge sim">模擬</span></div><h2>巡樹排行榜</h2><p class="tree-sub">越久沒人拍，分數越高</p><h3 class="h3">我的里程碑</h3>${milestonesHtml()}
    <h3 class="h3">排行榜</h3><div class="seg" role="tablist"><button data-rk="week" class="on">本週（本站回報）</button><button data-rk="dist">各區缺資料</button><button data-rk="all">全市累計</button></div><div id="rank">載入中…</div><h3 style="margin:20px 0 6px;font-size:17px">可兌換贈品</h3>${rewardsHtml()}${FRAUD_HTML}</div>`);
  bindRedeem();
  const ev = await getAllEvents();
  const all = await leaderboard();
  const draw = (mode) => {
    body.querySelectorAll('[data-rk]').forEach((b) => b.classList.toggle('on', b.dataset.rk === mode));
    if (mode === 'dist') {
      // 各區缺資料比例：樹籍調查超過 3 年沒更新（真實欄位）
      const m = new Map();
      for (const t of S.trees) { const o = m.get(t.dist) || [0, 0]; o[0]++; if (!t.survey || Date.now() - new Date(t.survey) > 3 * 365 * 86400000) o[1]++; m.set(t.dist, o); }
      const rows = [...m.entries()].map(([d, [n, k]]) => [d, k / n]).sort((a, b) => b[1] - a[1]);
      $('#rank').innerHTML = `<ul class="list dist">${rows.map(([d, r]) => `<li><span style="width:56px">${esc(d)}</span>${bar(r, rows[0][1], '#b7791f')}<b>${Math.round(r * 100)}%</b></li>`).join('')}</ul>
        <p class="privacy">樹籍超過 3 年沒更新的比例 <span class="badge real">真實</span></p>`;
      return;
    }
    let list;
    if (mode === 'week') {
      const wk = Date.now() - 7 * 86400000, m = new Map();
      for (const e of ev) if (e.role === 'citizen' && e.nickname && new Date(e.at) > wk) m.set(e.nickname, (m.get(e.nickname) || 0) + (typeof e.pts === 'number' ? e.pts : POINTS.report));
      list = [...m.entries()].map(([name, pts]) => ({ name, pts })).sort((a, b) => b.pts - a.pts);
    } else list = all;
    const meIdx = list.findIndex((u) => u.name === S.nick);
    const shown = list.slice(0, 15).map((u, i) => [u, i]);
    if (meIdx >= 15) shown.push([list[meIdx], meIdx]);
    else if (meIdx < 0) shown.push([{ name: S.nick, pts: 0 }, list.length]);
    $('#rank').innerHTML = `<ul class="list">${shown.map(([u, i]) => `<li class="${u.name === S.nick ? 'me' : ''}"><span class="rank-n">${i + 1}</span><span style="flex:1">${esc(u.name)} ${u.sim ? '<span class="badge sim">模擬</span>' : ''}</span><b>${u.pts}</b></li>`).join('')}</ul>`;
  };
  body.querySelectorAll('[data-rk]').forEach((b) => b.addEventListener('click', () => draw(b.dataset.rk)));
  draw('week');
}

function renderMine() {
  const follows = store.get('follows', []).map(treeFromId).filter(Boolean);
  openPanel(`<div class="page">
    <h2>我的樹</h2>
    <p class="tree-sub">暱稱：${esc(S.nick)}・點數 <b style="font-size:20px;color:var(--sun)">${store.get('points', 0)}</b></p>
    ${follows.length ? `<ul class="list">${follows.map((t) => `<li><button data-id="${esc(t.id)}"><b>${esc(t.species)}</b><br><small class="privacy">${esc(t.dist)} ${esc(t.place)}・${esc(t.id)}</small></button><span>›</span></li>`).join('')}</ul>`
      : '<div class="placeholder">還沒有關心的樹。在地圖上點一棵樹，按「☆ 關心這棵樹」，它有新的修剪、施工通報或民眾回報時就看得到。</div>'}
    <h3 class="h3">我的里程碑</h3>${milestonesHtml()}
    <h3 style="margin:20px 0 6px;font-size:17px">用點數換贈品</h3>${rewardsHtml()}
    <p class="privacy">「我的樹」與點數存在這支手機的瀏覽器裡，不需要註冊、不收集個資。</p></div>`);
  body.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => go(`#/tree/${b.dataset.id}`)));
  bindRedeem();
}

// 校園樹木：教育部平臺官方 API 只有每校樹種棵數（沒有單株座標與照片），做成統計卡＋連回平臺
async function campusCard(el) {
  try {
    S.campus = S.campus || await (await fetch('/data/campus-trees.json')).json();
    const d = S.campus;
    const by = new Map();
    for (const x of d.schools) by.set(x.dist, (by.get(x.dist) || 0) + x.total);
    const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
    const top = d.schools.slice().sort((a, b) => b.total - a.total).slice(0, 6);
    el.innerHTML = `<div class="facts">
        <div class="fact"><b>${d.school_count}</b><span>所公立學校</span></div>
        <div class="fact"><b>${(d.tree_count / 10000).toFixed(1)} 萬</b><span>棵校園樹木</span></div>
        <div class="fact"><b>${esc(d.top_species[0][0])}</b><span>最多的樹種</span></div></div>
      <ul class="list dist">${rows.map(([k, n]) => `<li><span style="width:56px">${esc(k)}</span>${bar(n, rows[0][1], '#2b6cb0')}<b>${n.toLocaleString()}</b></li>`).join('')}</ul>
      <p class="privacy">樹最多的學校：${top.map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.school)}</a>（${x.total}）`).join('、')}。點校名到教育部平臺看照片。</p>
      <p class="privacy">來源：教育部校園樹木平臺（授權未標示）</p>`;
  } catch { el.innerHTML = '<p class="privacy">校園樹木資料載入失敗。</p>'; }
}

async function renderNear() {
  openPanel('<div class="page"><h2>我附近</h2><p class="privacy">取得位置中…（位置只在你的手機上用，不會上傳）</p></div>');
  const loc = await browserLocation();
  const c = loc || { lat: S.map.getCenter().lat, lng: S.map.getCenter().lng };
  const near = nearbyTrees(S.trees, c.lat, c.lng, 500);
  const never = near.filter(({ t }) => treeStale(t) < 0).length;
  const old = near.filter(({ t }) => treeStale(t) > 365).length;
  const pl = await loadPlant();
  const pn = pl ? pl.features.filter((f) => distM(c.lat, c.lng, f.geometry.coordinates[1], f.geometry.coordinates[0]) <= 500).length : 0;
  S.map.flyTo({ center: [c.lng, c.lat], zoom: 15.5, padding: innerWidth <= 760 ? { bottom: innerHeight * 0.45 } : { right: 440 * uiZ(), left: 300 * uiZ() } });
  const closest = near.slice(0, 5);
  openPanel(`<div class="page">
    <div class="eyebrow">${loc ? '你目前位置' : '拿不到定位，改用地圖中心'}附近 500 公尺</div><h2>我附近</h2>
    <div class="facts">
      <div class="fact"><b>${near.length.toLocaleString()}</b><span>登錄樹木 <span class="badge real">真實</span></span></div>
      <div class="fact"><b>${(never + old).toLocaleString()}</b><span>很久沒人拍 <span class="badge sim">模擬</span></span></div>
      <div class="fact"><b>${pn.toLocaleString()}</b><span>推薦種樹點 <span class="badge est">推估</span></span></div>
    </div>
    <h3 class="h3">附近待更新（從沒人拍過或超過一年）</h3>
    <ul class="list">${near.filter(({ t }) => treeStale(t) < 0 || treeStale(t) > 365).slice(0, 5).map(({ t, d }) => `<li><button data-id="${esc(t.id)}"><b>${esc(t.species)}</b> <small class="privacy">+${photoPoints(treeStale(t))} 點</small><br><small class="privacy">${Math.round(d)} 公尺・${esc(t.place)}</small></button><span>›</span></li>`).join('') || '<li>附近的樹最近都有人拍過</li>'}</ul>
    <p class="privacy">請只在人行道、公園等安全的公開位置拍攝，不要為了點數進入工地或車道。</p>
    <h3 class="h3">最近的樹</h3>
    <ul class="list">${closest.map(({ t, d }) => `<li><button data-id="${esc(t.id)}"><b>${esc(t.species)}</b><br><small class="privacy">${Math.round(d)} 公尺・${esc(t.place)}</small></button><span>›</span></li>`).join('')}</ul>
    ${closest[0] ? `<div class="actions"><button class="btn primary" id="near-report">📷 回報最近的這棵樹</button></div>` : ''}
  </div>`);
  body.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => go(`#/tree/${b.dataset.id}`)));
  $('#near-report')?.addEventListener('click', () => { S.tab = 'report'; go(`#/tree/${closest[0].t.id}`); });
  usePurpose('stale');
}

async function renderRecords() {
  const ev = await getAllEvents();
  const alarms = ev.filter((e) => e.kind === 'alarm').reverse();
  const wo = { remove: 0, move: 0 };
  for (const t of S.trees) { const w = workOrderFor(t); if (w && w.status !== 'keep') wo[w.status]++; }
  const removedLive = new Set(ev.filter((e) => e.role === 'vendor' && e.result === '已移除').map((e) => e.treeId)).size;
  const fm = S.trees.filter((t) => t.place === FUMIN.park).sort((a, b) => (b.dbh || 0) - (a.dbh || 0))[0];
  openPanel(`<div class="page">
    <div class="eyebrow">公開紀錄</div><h2>樹被移走，市民看得到嗎？</h2>
    <p class="tree-sub">有來源的真實紀錄・對帳卡為模擬</p>

    <h3 class="h3">2025 年全市移除 3,164 株 <span class="badge real">官方總數</span></h3>
    <div class="facts">
      <div class="fact"><b>2,691</b><span>人工移除 <span class="badge est">媒體轉述</span></span></div>
      <div class="fact"><b>473</b><span>天災 <span class="badge est">媒體轉述</span></span></div>
      <div class="fact"><b>42,250</b><span>2023–2026/9 種植喬木</span></div>
    </div>
    <ul class="list dist"><li><small class="privacy">議員引述，市府原表未見</small></li>${[['自然死亡', 996], ['腐朽', 639], ['病蟲害', 522], ['其他', 534]].map(([k, n]) => `<li><span style="width:70px">${k}</span>${bar(n, 996, '#7b877f')}<b>${n}</b></li>`).join('')}</ul>
    <p class="privacy">3,164 出自<a href="https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&s=B9708CAABE7AAC15&sms=72544237BBE4C5F6" target="_blank" rel="noopener">臺北市政府 2026-07-12 新聞稿</a>；2,691／473 為媒體轉述；42,250 株出自<a href="https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=B1649759E218DB6B" target="_blank" rel="noopener">公園處 2026-10-03 新聞稿</a>・兩者不能相減</p>

    <h3 class="h3">示範區對帳：移除幾棵、承諾補種幾棵、已補幾棵 <span class="badge sim">模擬</span></h3>
    <div class="facts">
      <div class="fact"><b>${wo.remove}</b><span>核定可移除</span></div>
      <div class="fact"><b>${wo.remove}</b><span>承諾補種</span></div>
      <div class="fact"><b>0</b><span>已補種</span></div>
    </div>
    <p class="privacy">另 ${wo.move} 株核定移植</p>
    ${alarms.length ? `<div class="alert danger"><h3>⚠ 施工結果與核定不符（本站回報）</h3>${alarms.slice(0, 5).map((e) => `<p><a href="#/tree/${esc(e.treeId)}">${esc(e.treeId)}</a>：核定「${esc(STATUS[workOrderFor(treeFromId(e.treeId) || {})?.status]?.label || '—')}」，回報「${esc(e.result)}」・${esc(fmtDate(e.at))}</p>`).join('')}<p class="privacy">示範區、模擬施工案；回報是使用者在 demo 上操作的。</p></div>` : ''}
    ${removedLive ? '' : ''}

    <h3 class="h3">富民生態公園：預定移除從約 12 株改到 6 株 <span class="badge real">真實</span></h3>
    ${tlHtml(FUMIN.events)}
    ${fm ? `<div class="actions"><button class="btn" data-go="#/tree/${esc(fm.id)}">看公園裡的樹</button></div>` : ''}

    <h3 class="h3">東門市場茄苳：核定移植，結果被移除 <span class="badge real">真實</span></h3>
    <p class="privacy">樹位是推定位置，未經市府確認；責任描述依「市府稱」。</p>
    ${tlHtml(DONGMEN.timeline.filter((x) => x.tag === 'real'))}
    <div class="actions"><button class="btn" data-go="#/tree/${DONGMEN.id}">看這棵樹的頁面</button></div>

    <h3 class="h3">想知道更多？申請政府資訊公開</h3>
    <div class="placeholder"><p>範本（可改寫後向臺北市政府工務局公園路燈工程管理處申請）：</p>
      <p>「依政府資訊公開法，申請提供民國 114 年 1 月至 115 年 9 月臺北市行道樹及公園樹木移除紀錄，欄位包含樹籍編號、位置、樹種、移除日期、移除原因類別、核准文號或核准單位；如有移植，請一併提供移植地點與存活追蹤。」</p>
      <p class="privacy">研究筆記整理，申請流程與時限以機關公告為準。</p></div>
  </div>`);
  body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

function renderAbout() {
  openPanel(`<div class="page">
    <h2>資料說明</h2>
    <p>這是黑客松 demo。<b>樹的位置、樹種、胸徑、樹高、調查日期是真實開放資料</b>；歷史事件、施工案、企業認養、排行榜大多是<b>模擬</b>，畫面上都有標示。</p>
    <table class="src-table">
      <tr><th>內容</th><th>性質</th><th>來源</th></tr>
      <tr><td>行道樹 90,441 棵、公園樹 72,011 棵</td><td><span class="badge real">真實</span></td><td><a href="https://data.gov.tw/dataset/128274" target="_blank" rel="noopener">臺北市行道樹及公園樹木分布圖</a>（公園處），2026-10-13 下載</td></tr>
      <tr><td>推薦種樹點</td><td><span class="badge est">推估</span></td><td>由<a href="https://data.gov.tw/dataset/134908" target="_blank" rel="noopener">新工處樹穴圖</a>、樹木點位、<a href="https://data.taipei/dataset/detail?id=715d3a83-8445-4496-b6bf-b0900538b7e7" target="_blank" rel="noopener">人行道範圍圖</a>推算，未現勘</td></tr>
      <tr><td>東門市場茄苳案時間線</td><td><span class="badge real">真實</span>（樹位為推定位置，未經市府確認）</td><td>臺北市政府 2026-09-21、09-22 新聞稿；聯合報 2026-09-21</td></tr>
      <tr><td>種植年份</td><td><span class="badge est">推估</span></td><td>依胸徑粗算，誤差很大</td></tr>
      <tr><td>修剪、病蟲害、颱風紀錄、施工案、核准文號、廠商</td><td><span class="badge sim">模擬</span></td><td>示範用虛構資料</td></tr>
      <tr><td>企業認養、贈品、排行榜</td><td><span class="badge sim">模擬</span></td><td>企業名稱與 logo 皆為虛構</td></tr>
      <tr><td>捷運各站進出量（2026 年 8 月）、出入口座標</td><td><span class="badge real">真實</span></td><td><a href="https://data.gov.tw/dataset/128506" target="_blank" rel="noopener">臺北捷運各站分時進出量</a>、臺北捷運車站出入口座標，2026-10-23 下載</td></tr>
      <tr><td>捷運站周邊樹冠覆蓋、缺蔭指數</td><td><span class="badge est">推估</span></td><td>由胸徑、樹高粗估樹冠，未計建物陰影</td></tr>
      <tr><td>歷年正射影像（5 棵示範樹）</td><td><span class="badge real">真實</span></td><td>內政部國土測繪中心 國土測繪圖資服務雲；標示為圖層年份</td></tr>
      <tr><td>「多久沒人拍」天數</td><td><span class="badge sim">模擬</span></td><td>示範用；有人在本站上傳就歸零</td></tr>
      <tr><td>移動植栽</td><td><span class="badge sim">模擬</span></td><td>位置取自真實推薦點，其餘虛構</td></tr>
      <tr><td>底圖</td><td>—</td><td>© OpenStreetMap contributors、OpenFreeMap</td></tr>
    </table>
    <p class="privacy">本站不收集真實個資；拍照位置只用來比對樹，公開的照片不含相機資訊。沒有爬取或掃描任何市府系統。</p></div>`);
}

// ---------- search ----------
function setupSearch() {
  const q = $('#q'), out = $('#results');
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
  q.addEventListener('focus', run);
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) out.hidden = true; });
  $('#search').addEventListener('submit', (e) => { e.preventDefault(); out.querySelector('button')?.click(); });
  function run() {
    const s = q.value.trim();
    if (!s || !S.trees.length) { out.hidden = true; return; }
    const res = [];
    const up = s.toUpperCase();
    const exact = S.byId.get(up);
    if (exact) res.push({ t: exact });
    if ('東門'.includes(s) || s.includes('東門')) res.push({ t: DONGMEN });
    // 樹種
    const sp = S.data.species.map((n, i) => [n, i]).filter(([n]) => n.includes(s)).slice(0, 4);
    for (const [n, i] of sp) res.push({ species: i, label: n, count: S.trees.reduce((c, t) => c + (t.s === i), 0) });
    // 路段／公園
    const seen = new Map();
    for (const t of S.trees) {
      if (!t.place.includes(s)) continue;
      const k = t.dist + t.place;
      if (!seen.has(k)) seen.set(k, { place: t.place, dist: t.dist, t, n: 0 });
      seen.get(k).n++;
    }
    for (const v of [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 8)) res.push({ place: v });
    out.innerHTML = res.length ? res.map((r, i) => r.t ? `<button data-i="${i}">🌳 ${esc(r.t.species)}　${esc(r.t.id)}<small>${esc(r.t.dist)} ${esc(r.t.place)}</small></button>`
      : r.species != null ? `<button data-i="${i}">只看「${esc(r.label)}」<small>全市 ${r.count.toLocaleString()} 棵</small></button>`
      : `<button data-i="${i}">📍 ${esc(r.place.place)}<small>${esc(r.place.dist)}・${r.place.n} 棵</small></button>`).join('') : '<p class="privacy" style="padding:10px">找不到</p>';
    out.hidden = false;
    out.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const r = res[+b.dataset.i]; out.hidden = true; q.blur();
      if (r.t) go(`#/tree/${r.t.id}`);
      else if (r.species != null) { S.species = String(r.species); applyFilters(); showToast(`只顯示「${r.label}」`); }
      else { S.map.flyTo({ center: [r.place.t.lng, r.place.t.lat], zoom: 16 }); }
    }));
  }
}

function syncChips() {
  document.querySelectorAll('#chips .purpose').forEach((b) => { const on = S.purpose === b.dataset.p; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
}

// ---------- 用途按鈕：按下去飛到代表性的地方，並用一句話說出「你現在看到的是什麼」----------
// 找某一群點最密的一格（約 550 m），當作代表性地點
function densest(pts, cell = 0.005) {
  const g = new Map();
  for (const [lng, lat] of pts) { const k = `${Math.floor(lng / cell)},${Math.floor(lat / cell)}`; g.set(k, (g.get(k) || 0) + 1); }
  let best = null, bn = 0;
  for (const [k, n] of g) if (n > bn) { bn = n; best = k; }
  if (!best) return null;
  const [x, y] = best.split(',').map(Number);
  return { center: [(x + 0.5) * cell, (y + 0.5) * cell], n: bn };
}
const fmtN = (n) => Number(n || 0).toLocaleString();
// 每顆按鈕：飛到哪裡（where）＋一句結果提示（aha）
const AHA = {
  stale: () => {
    const pts = S.trees.filter((t) => treeStale(t) < 0).map((t) => [t.lng, t.lat]);
    const d = densest(pts);
    return { center: d?.center, zoom: 15.6, aha: `紅＝從沒人拍，拍一張 ${POINTS.never} 點`, tag: 'sim' };
  },
  plant: async () => {
    const gj = await loadPlant(); if (!gj) return { aha: '推薦種樹點載入失敗' };
    const top = gj.features.filter((f) => f.properties.status === 'likely_empty');
    const d = densest(top.map((f) => f.geometry.coordinates), 0.004);
    return { center: d?.center, zoom: 16, aha: `橘＝空樹穴，全市 ${fmtN(top.length)} 處`, tag: 'est' };
  },
  adopt: () => {
    const a = ADOPTIONS.find((x) => x.company === 'c2') || ADOPTIONS[0];
    const ts = S.trees.filter((t) => adoptionFor(t)?.label === a.label);
    const c = ts.length ? [ts.reduce((v, t) => v + t.lng, 0) / ts.length, ts.reduce((v, t) => v + t.lat, 0) / ts.length] : [121.5395, 25.03];
    const all = S.trees.filter((t) => adoptionFor(t)).length;
    return { center: c, zoom: 16, aha: `彩色＝企業認養，共 ${fmtN(all)} 棵`, tag: 'sim', story: 'esg' };
  },
  wish: () => ({ center: [121.5435, 25.042], zoom: 13.2, aha: '綠＝民眾許願種樹的地方，越深越多人想種', tag: 'live' }),
  review: () => {
    const top = S.trees.filter((t) => t.rl === 4);
    const d = densest(S.trees.filter((t) => t.rl >= 3 && t.kind === 0).map((t) => [t.lng, t.lat]), 0.008);
    return { center: d?.center, zoom: 15, aha: `深紅＝最該先看的 ${fmtN(top.length)} 棵`, tag: 'est' };
  },
  shade: async () => {
    const gj = await loadShade();
    const top = gj?.features.slice().sort((a, b) => a.properties.rank - b.properties.rank)[0];
    return { center: top?.geometry.coordinates, zoom: 14.5, aha: top ? `紅圈＝人多樹蔭少。最缺：${top.properties.name}站` : '資料載入失敗', tag: 'est' };
  },
  nonew: () => {
    const pts = S.trees.filter(isNoNew).map((t) => [t.lng, t.lat]);
    const d = densest(pts);
    return { center: d?.center, zoom: 15.4, aha: `深灰＝不再新植樹種，${fmtN(pts.length)} 棵`, tag: 'real' };
  },
  planter: async () => {
    const ps = await loadPlanters();
    const d = densest(ps.map((x) => [x.lng, x.lat]), 0.008);
    return { center: d?.center, zoom: 16, aha: '紫＝移動植栽', tag: 'sim' };
  },
  dongmen: () => {
    const dm = FEAT.get('dongmen-block');
    if (dm && isOn(dm.id)) dm.open(ctx()); // 街區時光機（歷年航照）
    return { aha: '', tree: DONGMEN.id };
  },
};
// 不飛、不提示，只切換上色模式（從各頁面呼叫）
function usePurpose(k) {
  if (S.purpose === k) return;
  const P = PURPOSES[k];
  S.purpose = k;
  for (const c of Object.keys(S.layers)) if (c !== 'street' && c !== 'park') S.layers[c] = false;
  if (P?.layer) S.layers[P.layer] = true;
  showAha(null); syncChips(); applyFilters();
}
async function setPurpose(k, fly = true) {
  if (!S.booted) { showToast('樹木資料載入中，馬上好'); await S.bootP; }
  // 再按一次已經亮著、而且剛提示過的按鈕＝關掉；角色預設亮著的按鈕第一次按，照樣飛過去並提示
  if (S.purpose === k && fly && S.ahaFor === k) { hideKeycard(); S.purpose = null; for (const c of Object.keys(S.layers)) if (c !== 'street' && c !== 'park') S.layers[c] = false; showAha(null); syncChips(); applyFilters(); return; }
  const P = PURPOSES[k];
  usePurpose(k);
  if (k !== 'dongmen') FEAT.get('dongmen-block')?.close?.(ctx());
  hideKeycard();
  const r = await AHA[k]();
  if (fly && r.center) {
    const mobile = innerWidth <= 760;
    S.map.flyTo({ center: r.center, zoom: r.zoom || 15, padding: mobile ? { top: 170, bottom: 40 } : { left: 320 * uiZ() }, duration: 1400 });
  }
  if (r.tree) {
    go(`#/tree/${r.tree}`);
    // 手機：樹頁先收成半高，地圖與街區時光機露出來
    if (k === 'dongmen' && innerWidth <= 760) setTimeout(() => panel.classList.add('peek'), 700);
    return;
  }
  if (!panel.hidden && !location.hash.startsWith('#/tree/') && innerWidth <= 760) panel.classList.add('peek');
  showAha(r); S.ahaFor = P.action ? null : k;
}
function showAha(r) {
  const el = $('#aha');
  if (!r) { el.hidden = true; S.ahaFor = null; return; }
  el.innerHTML = `<p>${esc(r.aha)} ${r.tag ? ctx().badge(r.tag) : ''}</p>${r.story ? `<button class="btn mini" data-story="${r.story}">看認養流程</button>` : ''}${r.story && ROLE === 'esg' && isOn('adopt-proposal') ? ' <a class="btn mini" href="#/f/adopt-proposal">認養效益試算</a>' : ''}`;
  el.hidden = false;
  el.querySelector('[data-story]')?.addEventListener('click', (e) => go(`#/story/${e.target.dataset.story}`));
}

// ---------- 每個角色進站第一眼：一張重點卡（一個數字＋一句話＋一個主要按鈕）----------
const KEYCARD = {
  public: () => {
    const n = S.trees.filter((t) => { const d = treeStale(t); return d < 0 || d > 365; }).length;
    return { n, unit: '棵', line: '很久沒人拍的樹', tag: 'sim', main: ['📍 看我附近', () => go('#/near')], alt: ['看全市', () => setPurpose('stale')] };
  },
  gov: () => {
    const n = S.trees.filter((t) => t.rl === 4).length;
    return { n, unit: '棵', line: '本週先複查', tag: 'est', main: ['看在哪', () => setPurpose('review')], alt: ['管理總覽', () => go('#/dash')] };
  },
  vendor: () => {
    let n = 0;
    for (const t of S.trees) { const w = workOrderFor(t); if (w && w.order.vendor === VENDORS[0].id && w.status !== 'remove') n++; }
    return { n, unit: '棵', line: '施工區要保留或移植的樹', tag: 'sim', main: ['看查核示範', () => go('#/story/vendor')], alt: ['查樹牌', () => go('#/vendor')] };
  },
  esg: () => {
    const n = S.trees.filter((t) => adoptionFor(t)).length;
    return { n, unit: '棵', line: `企業認養的樹（${COMPANIES.length} 家虛構企業）`, tag: 'sim', main: ['看認養流程', () => go('#/story/esg')], alt: ['認養總覽', () => go('#/esg')] };
  },
  plan: async () => {
    const gj = await loadPlant();
    const n = gj ? gj.features.filter((f) => f.properties.status === 'likely_empty').length : 0;
    return { n, unit: '處', line: '可補植的空樹穴', tag: 'est', main: ['看在哪', () => setPurpose('plant')], alt: ['規劃總覽', () => go('#/plan')] };
  },
  mayor: () => {
    const n = S.trees.filter((t) => !t.survey || +t.survey.slice(0, 4) <= 2016).length;
    return { n, unit: '棵', line: '十年沒調查的樹', tag: 'real', main: ['首長儀表板', () => go('#/mayor')], alt: ['先看哪棵', () => setPurpose('review')] };
  },
};
function hideKeycard() { $('#keycard').hidden = true; }
async function showKeycard() {
  const el = $('#keycard'), k = KEYCARD[ROLE];
  if (!k || S.kcClosed?.[ROLE] || document.body.classList.contains('dm-active')) return hideKeycard();
  const c = await k();
  if (location.hash.replace(/^#\/?/, '') !== '') return;
  el.innerHTML = `<button class="kc-close" aria-label="關閉">×</button>
    <div class="eyebrow">${esc(R.label)} ${ctx().badge(c.tag)}</div>
    <p class="kc-num"><b>${fmtN(c.n)}</b> ${c.unit}</p>
    <p class="kc-line">${esc(c.line)}</p>
    <p class="kc-line"><a href="https://puma.taipei/hackathon/vote" target="_blank" rel="noopener">🗳 幫我們投票（10/24 17:00 開放）</a></p>
    <div class="actions"><button class="btn primary" data-kc="main">${esc(c.main[0])}</button>${c.alt ? `<button class="btn" data-kc="alt">${esc(c.alt[0])} ›</button>` : ''}</div>`;
  el.hidden = false;
  el.querySelector('.kc-close').onclick = () => { S.kcClosed = { ...(S.kcClosed || {}), [ROLE]: true }; hideKeycard(); };
  el.querySelector('[data-kc=main]').onclick = () => { hideKeycard(); c.main[1](); };
  el.querySelector('[data-kc=alt]')?.addEventListener('click', () => { hideKeycard(); c.alt[1](); });
}

// ---------- 引導故事：企業認養、模擬施工，一步一步演給第一次看的人 ----------
function storyTree(pred) { return S.trees.filter((t) => pred(t) && t.dbh <= 120).sort((a, b) => (b.dbh || 0) - (a.dbh || 0))[0]; }
const STORIES = {
  esg: () => {
    const co = COMPANIES.find((c) => c.id === 'c2'), a = ADOPTIONS.find((x) => x.company === 'c2');
    const ts = S.trees.filter((t) => adoptionFor(t)?.label === a.label);
    const t = ts.filter((x) => x.dbh <= 120).sort((x, y) => (y.dbh || 0) - (x.dbh || 0))[0] || ts[0];
    const c = [ts.reduce((v, x) => v + x.lng, 0) / ts.length, ts.reduce((v, x) => v + x.lat, 0) / ts.length];
    return {
      eyebrow: '企業認養', title: '企業認養怎麼運作',
      intro: `${co.name}・${a.label}`,
      steps: [
        { text: `認養範圍：${fmtN(ts.length)} 棵`, run: () => { usePurpose('adopt'); S.map.flyTo({ center: c, zoom: 16, padding: storyPad() }); select(null); } },
        { text: '樹頁掛上企業 logo 與贊助新聞', run: () => { select(t); flyTo(t, 17.5); },
          extra: `<div class="story-card"><img src="${co.logo}" width="40" height="40" alt=""><div><b>${esc(t.species)}</b>・${esc(t.id)}<br><small>認養：${esc(co.name)}・${a.since} 起 <span class="badge sim">模擬</span></small><a class="adopt-news" href="#/news/${co.id}">📰 ${esc(NEWS[co.id].title)}<small>示意新聞 ›</small></a></div></div><button class="btn mini" data-go="#/tree/${esc(t.id)}">開樹頁 ›</button>` },
        { text: '民眾回報，企業與公園處同時收到', run: () => {},
          extra: '<div class="story-card"><span style="font-size:28px">📷</span><div><b>📷 樹枝斷裂</b><br><small>→ 公園處、綠廊人壽（虛構）<span class="badge sim">模擬</span></small></div></div>' },
      ],
      outro: '企業出錢、民眾出眼睛、市府出資料。',
      done: [['永續報告書素材', `#/f/esg-report?c=${co.id}`], ['認養總覽', '#/esg'], ['回地圖', '#/']],
    };
  },
};
const storyPad = () => (innerWidth <= 760 ? { bottom: innerHeight * 0.55 } : { right: 440 * uiZ(), left: 300 * uiZ() });
function renderStory(id, i = 0) {
  const mk = STORIES[id]; if (!mk) return go('#/');
  const st = mk(), n = st.steps.length, end = i >= n;
  hideKeycard();
  openPanel(`<div class="page story">
    <div class="eyebrow">${esc(st.eyebrow)} <span class="badge sim">模擬</span></div>
    <h2>${esc(st.title)}</h2>
    <p class="tree-sub">${esc(st.intro)}</p>
    <ol class="stepbar">${st.steps.map((_, k) => `<li class="${k < i ? 'done' : k === i ? 'on' : ''}">${k + 1}/${n}</li>`).join('')}<li class="${end ? 'on' : ''}">✓</li></ol>
    <div class="stepbox">${end ? `<p class="kc-line"><b>${esc(st.outro)}</b></p>` : `<p>${esc(st.steps[i].text)}</p>${st.steps[i].extra || ''}`}</div>
    <div class="actions">${i > 0 ? '<button class="btn" data-step="-1">上一步</button>' : ''}${end ? st.done.map(([l, h], k) => `<button class="btn ${k ? '' : 'primary'}" data-go="${h}">${esc(l)}</button>`).join('') + '<button class="btn" data-step="restart">重看</button>' : `<button class="btn primary" data-step="1">${i === n - 1 ? '結果' : '下一步'}</button>`}</div>
  </div>`);
  panel.classList.add('story-mode');
  if (!end) st.steps[i].run();
  body.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => renderStory(id, b.dataset.step === 'restart' ? 0 : i + +b.dataset.step)));
  body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

const ROLE_KEYS = ['public', 'gov', 'esg'];

// 新功能自帶的圖層按鈕（不在任何角色預設清單裡）也要出現

function renderRoleChrome() {
  document.title = ROLE === 'public' ? '「樹」位孿生｜台北市' : `${R.label}｜「樹」位孿生`;
  document.body.dataset.role = ROLE;
  document.body.classList.toggle('vendor-mode', ROLE === 'vendor');
  $('#role').value = ROLE;
  $('#nav').innerHTML = [...R.nav.filter((k) => ownedOn('nav', k)), 'features'].map((k) => `<a href="${NAV[k].hash}" data-nav="${k}">${NAV[k].label}</a>`).join('');
  const ps = R.purposes.filter((k) => (PURPOSES[k].layer ? ownedOn('chip', PURPOSES[k].layer) : ownedOn('part', 'demos'))).slice(0, 4);
  $('#chips').innerHTML = ps.map((k) => `<button class="purpose" data-p="${k}" aria-pressed="false"><span class="pi" aria-hidden="true">${PURPOSES[k].icon}</span><b>${esc(PURPOSES[k].name)}</b><small>${esc(PURPOSES[k].hint)}</small></button>`).join('');
  $('#chips').hidden = !ps.length;
  for (const k of Object.keys(S.layers)) if (!ownedOn('chip', k)) S.layers[k] = false;
  showAha(null);
  document.body.classList.toggle('no-img-markers', !ownedOn('part', 'img-markers'));
  syncChips();
}

// 切角色不重載：換網址路徑、保留地圖位置與選中的樹，只套新角色的圖層與側欄
function switchRole(k, push = true) {
  if (!ROLES[k]) return;
  ROLE = k; R = ROLES[k];
  if (push) history.pushState(null, '', R.path + location.hash);
  S.vendor = ROLE === 'vendor' ? store.get('vendor', null) : null;
  if (!params().has('f') && !params().has('preset')) S.feat = computeFeatures();
  if (S.booted) ensureInit();
  S.layers = defaultLayers();
  S.tab = R.tab || 'life';
  S.homeShown = false;
  $('#modal').hidden = true;
  renderRoleChrome();
  applyFilters();
  const h = location.hash.replace(/^#\/?/, '');
  // 停在別的角色專屬頁（例如 #/dash）時，換到新角色的首頁；單棵樹、推薦點等詳細頁保留
  const foreign = NAV[h] && !R.nav.includes(h) && h !== 'about';
  if (foreign) go('#/'); else route();
}

function setupRole() {
  const rs = $('#role');
  for (const [k, r] of Object.entries(ROLES)) rs.add(new Option(r.label, k, false, k === ROLE));
  rs.addEventListener('change', () => switchRole(rs.value));
  addEventListener('popstate', () => { const k = roleFromPath(location.pathname); if (k !== ROLE) switchRole(k, false); });
  // Demo 快捷鍵：1–3 切角色、5 開公開紀錄
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = +e.key;
    if (n === 5) { if (ROLE !== 'public') switchRole('public'); go('#/records'); }
    else if (n >= 1 && n <= ROLE_KEYS.length && ROLE_KEYS[n - 1]) switchRole(ROLE_KEYS[n - 1]);
    else if (false) { if (ROLE !== 'public') switchRole('public'); go('#/records'); }
  });
  $('#nav').addEventListener('click', (e) => { const a = e.target.closest('a'); if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); route(); } });
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.purpose'); if (!b) return;
    setPurpose(b.dataset.p);
  });
  renderRoleChrome();
}

function setupLayers() {
  $('#stat-count').textContent = S.trees.length.toLocaleString();
}

// ---------- routing ----------
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function route() {
  let h = location.hash.replace(/^#\/?/, '');
  try { h = decodeURIComponent(h); } catch { h = ''; }
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', h.startsWith(a.dataset.nav)));
  if (!S.ready || !S.booted) return; // 樹木資料與功能還沒到齊，開機最後會自己 route 一次
  if (S.page && !h.startsWith('f/') && h !== 'mayor') { leavePage(); applyFilters(); }
  if (h !== '') hideKeycard();
  if (document.body.classList.contains('dm-active')) {
    const t = h.startsWith('tree/') ? treeFromId(h.slice(5)) : null;
    const [w, s, e, n] = FEAT.get('dongmen-block')?.bounds || [0, 0, 0, 0];
    const inBlock = t && (t.id === DONGMEN.id || (t.lng >= w && t.lng <= e && t.lat >= s && t.lat <= n));
    if (!inBlock) { FEAT.get('dongmen-block')?.close?.(ctx()); if (S.purpose === 'dongmen') { S.purpose = null; syncChips(); } }
  }
  if (h.startsWith('story/')) return renderStory(h.slice(6));
  if (h.startsWith('news/')) return renderNews(h.slice(5));
  if (h.startsWith('tree/')) return renderTree((h.slice(5)));
  if (h.startsWith('plant/')) return renderPlant((h.slice(6)));
  if (h.startsWith('planter/')) return renderPlanter((h.slice(8)));
  if (h.startsWith('station/')) return renderStation((h.slice(8)));
  if (h === 'vendor') return go('#/');
  if (h === 'dash') return renderDash();
  if (h === 'mayor') { const f = FEAT.get('mayor-dash'); if (f && isOn(f.id)) return renderFeaturePage('mayor-dash', true); return go('#/features'); }
  if (h === 'esg') return renderEsg();
  if (h === 'plan') return renderPlan();
  if (h === 'rank') return renderRank();
  if (h === 'mine') return renderMine();
  if (h === 'about') return renderAbout();
  if (h === 'records') return renderRecords();
  if (h === 'features') return renderCatalog();
  if (h.startsWith('f/')) { const [id, qs] = h.slice(2).split('?'); S.fq = new URLSearchParams(qs || ''); return renderFeaturePage(id); }
  for (const f of FEATURES) if (f.route && h === f.route && isOn(f.id) && f.page) return renderFeaturePage(f.id, true);
  if (h === 'near') return renderNear();
  closePanel();
  showKeycard();
}
addEventListener('hashchange', route);

// ---------- App 內建瀏覽器防護（Threads／IG／Messenger 往下拉會關掉視窗）----------
function setupTouchGuard() {
  const el = $('#map');
  for (const t of ['touchstart', 'touchmove']) el.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  const pin1 = () => { if (window.scrollY < 1 && document.documentElement.scrollHeight > window.innerHeight) window.scrollTo(0, 1); };
  addEventListener('scroll', pin1, { passive: true }); addEventListener('load', pin1); setTimeout(pin1, 50);
  if (/FBAN|FBAV|FB_IAB|Instagram|Barcelona|MessengerForiOS/i.test(navigator.userAgent) && !store.get('iabDismissed', false)) {
    const bar = $('#iab'); bar.hidden = false;
    $('#iabClose').onclick = () => { bar.hidden = true; store.set('iabDismissed', true); };
  }
}
setupTouchGuard();

// ---------- boot ----------
(async function boot() { try {
  // /features、/f/<id> 是單一入口的網址，轉成首頁的 hash 路由
  if (/^\/(plan|mayor)\/?$/.test(location.pathname)) history.replaceState(null, '', `/gov${location.search}${location.hash}`);
  if (/^\/vendor\/?$/.test(location.pathname)) history.replaceState(null, '', `/${location.search}`);
  { const m = /^\/(features|f\/[\w-]+)\/?$/.exec(location.pathname); if (m) history.replaceState(null, '', `/${location.search}#/${m[1]}`); }
  const map = initMap(await pickStyle());
  const b = map.getBounds();
  const [gj] = await Promise.all([loadTreesFirst([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]), new Promise((r) => (map.loaded() ? r() : map.once('load', r)))]);
  if (!S.zhStyle) try { localizeLabels(map); } catch {}
  addLayers(map, gj);
  $('#stat-count').textContent = S.data.total.toLocaleString(); // 全市總數寫在 index，背景還在載也先顯示
  S.feat = computeFeatures();
  S.layers = defaultLayers();
  setupRole();
  applyFilters();
  await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 200)));
  await loadTreesRest();
  await ensureInit();
  await loadImagery();
  const zoomCls = () => document.body.classList.toggle('far', map.getZoom() < 13.5);
  map.on('zoomend', zoomCls); zoomCls();
  getAllEvents().then((ev) => { S.photoed = new Set(ev.filter((e) => e.photo && e.role === 'citizen').map((e) => e.treeId)); });
  setupLayers();
  setupSearch();
  applyFilters();
  S.booted = true; S.bootResolve?.();
  route();
} catch (e) {
  console.error(e);
  $('#stat-count').textContent = '載入失敗';
  showToast('地圖或樹木資料載入失敗，請重新整理再試一次', 10000);
} })();
