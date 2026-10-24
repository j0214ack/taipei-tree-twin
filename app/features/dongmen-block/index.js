// 示範街區：東門市場。歷年影像只用 NLSC 公開 WMTS 即時顯示，不下載或快取圖磚。

export const DONGMEN_BLOCK = Object.freeze({
  name: '示範街區：東門市場',
  center: [121.52691, 25.03489],
  // 約 475 × 477 公尺：西側杭州南路、東側金山南路，南側信義路、北側仁愛路之間。
  bounds: Object.freeze([121.52385, 25.03345, 121.52855, 25.03775]),
  treeCountAt20261013: 207,
});

export const IMAGERY_YEARS = Object.freeze([2014, 2015, 2017, 2018, 2019, 2021, 2023, 2025]);

const SOURCE = '影像：國土測繪中心';
const YEAR_NOTE = '圖層年份不等於拍攝年份';
const YEAR_BADGE = '<span class="badge est">圖層年份≠拍攝年份</span>';
const CHECK_BADGE = '<span class="badge real">真實比對・未經市府確認</span>';
const SOURCE_URL = 'https://maps.nlsc.gov.tw/pro/use_clause.jsp';
const idFor = (kind, year) => `dm-${kind}-${year}`;
const tileUrl = (year) => `https://wmts.nlsc.gov.tw/wmts/PHOTO${year}/default/GoogleMapsCompatible/{z}/{y}/{x}`;

// 2024-11 樹籍存檔有、2026-10 官方資料已無此編號；消失不等於已證實遭移除。
const GONE_TREES = Object.freeze([
  {
    id: 'JJ0263131034', openId: 'DEMO-DONGMEN', lng: 121.527226, lat: 25.034695,
    species: '茄苳', note: '東門誤砍案的最可能候選（假說，未經市府確認）',
  },
  {
    id: 'JJ0253210002', openId: 'JJ0253210002', lng: 121.524113, lat: 25.035246,
    species: '榕樹', note: '消失原因可能是移除、合併編號或資料修正，目前查不到',
  },
]);

const state = { active: false, yearIndex: IMAGERY_YEARS.length - 1, launcher: null, control: null, treeMap: null, treeCount: 0, goneMarkers: [] };

function inBlock(tree) {
  if (!tree || !Number.isFinite(+tree.lng) || !Number.isFinite(+tree.lat)) return false;
  const [w, s, e, n] = DONGMEN_BLOCK.bounds;
  return +tree.lng >= w && +tree.lng <= e && +tree.lat >= s && +tree.lat <= n;
}

function ringFeature(tree, radiusM = 11) {
  const points = [];
  for (let i = 0; i <= 48; i++) {
    const a = i / 48 * Math.PI * 2;
    points.push([tree.lng + Math.cos(a) * radiusM / 101000, tree.lat + Math.sin(a) * radiusM / 111000]);
  }
  return {
    type: 'Feature',
    properties: { id: tree.id, openId: tree.openId, species: tree.species, note: tree.note },
    geometry: { type: 'Polygon', coordinates: [points] },
  };
}

function setLayerVisibility(map, id, visible) {
  if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

// 街區內樹籍變化（tree-diff 三版比對：2022-10、2024-11、2026-10）。
// 紅＝期間內從資料消失（只能細到期間）；綠＝新出現，依調查日推定登錄年（細到單年）；重新編號不顯示。
const DIFF_COLOR = { gone: '#d9362b', new: '#1f9d55' };
async function loadDiff(ctx) {
  if (state.diff) return state.diff;
  const d = await (await fetch('/data/tree-diff.json')).json();
  const features = [];
  for (const p of d.periods) {
    const per = p.from >= '2024' ? 'b' : 'a';
    for (const x of p.points) {
      if (x.type === 'suspected-renumbered' || !inBlock(x)) continue;
      const gone = x.type === 'suspected-removed';
      const sv = ctx.S.byId.get(x.id)?.survey;
      const yr = gone ? +p.to.slice(0, 4) : Math.min(+p.to.slice(0, 4), Math.max(+p.from.slice(0, 4), sv ? +sv.slice(0, 4) : +p.to.slice(0, 4)));
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lng, x.lat] },
        properties: { kind: gone ? 'gone' : 'new', per, yr, id: x.id, species: x.species || '', from: p.from, to: p.to } });
    }
  }
  state.diff = { type: 'FeatureCollection', features };
  ctx.map.getSource('dm-diff')?.setData(state.diff);
  return state.diff;
}
function diffFilter(year, last) {
  const per = year >= 2024 ? 'b' : year >= 2022 ? 'a' : null;
  if (!per) return ['==', ['get', 'per'], 'none'];
  return ['all', ['==', ['get', 'per'], per], last ? true : ['any', ['==', ['get', 'kind'], 'gone'], ['<=', ['get', 'yr'], year]]];
}
// 時光機開著時，一般樹點變成小白點，不搶變化點的注意力
const TREE_LAYERS = ['trees-street', 'trees-park'];
function dimTrees(map, on) {
  for (const id of TREE_LAYERS) {
    if (!map.getLayer(id)) continue;
    if (on) {
      state.treePaint ||= {};
      state.treePaint[id] ||= { c: map.getPaintProperty(id, 'circle-color'), o: map.getPaintProperty(id, 'circle-opacity'), s: map.getPaintProperty(id, 'circle-stroke-width') };
      map.setPaintProperty(id, 'circle-color', '#ffffff'); map.setPaintProperty(id, 'circle-opacity', 0.6); map.setPaintProperty(id, 'circle-stroke-width', 0);
    } else if (state.treePaint?.[id]) {
      const o = state.treePaint[id];
      map.setPaintProperty(id, 'circle-color', o.c); map.setPaintProperty(id, 'circle-opacity', o.o ?? 1); map.setPaintProperty(id, 'circle-stroke-width', o.s ?? 0);
    }
  }
}

function showYear(map, index) {
  state.yearIndex = Math.max(0, Math.min(IMAGERY_YEARS.length - 1, +index));
  const year = IMAGERY_YEARS[state.yearIndex];
  for (const y of IMAGERY_YEARS) setLayerVisibility(map, idFor('layer', y), state.active && y === year);
  if (map.getLayer('dm-diff-pts')) {
    map.setFilter('dm-diff-pts', diffFilter(year, state.yearIndex === IMAGERY_YEARS.length - 1));
    setLayerVisibility(map, 'dm-diff-pts', state.active);
  }
  if (!state.control) return;
  const range = state.control.querySelector('[data-dm-range]');
  if (range) range.value = String(state.yearIndex);
  const out = state.control.querySelector('[data-dm-year]');
  if (out) out.textContent = `圖層年份 ${year}`;
  state.control.querySelectorAll('[data-dm-y]').forEach((button) => button.classList.toggle('on', +button.dataset.dmY === year));
  const nd = state.control.querySelector('[data-dm-nodiff]'); if (nd) nd.hidden = year >= 2022;
}

function injectStyle() {
  if (document.getElementById('dm-style')) return;
  const style = document.createElement('style');
  style.id = 'dm-style';
  style.textContent = `
    .dm-entry{margin-top:9px;padding-top:9px;border-top:1px solid var(--line)}
    .dm-entry button{width:100%;border:1px solid #8f5e33;background:#fff7e8;color:var(--forest);border-radius:12px;padding:9px 11px;text-align:left;cursor:pointer;display:grid;grid-template-columns:auto 1fr;gap:2px 9px;align-items:center;font:inherit}
    .dm-entry button .dm-icon{font-size:21px;grid-row:1/3}.dm-entry button b{font-size:13px}.dm-entry button small{font-size:11px;color:var(--ink-3)}
    .dm-entry button.on{background:#8f5e33;color:#fff}.dm-entry button.on small{color:#fff7e8}
    body.dm-active .img-marker{display:none}
    body.dm-active .dm-tree-wrap{display:none}
    body.dm-active .layers .stat,body.dm-active .layers .purpose small,body.dm-active .layers .aha{display:none}
    body.dm-active .layers{width:auto;max-width:300px}
    .dm-control{position:fixed;z-index:16;left:50%;bottom:48px;transform:translateX(-50%);width:min(720px,calc(100vw - 360px));background:rgba(255,253,248,.97);border:1px solid var(--line);border-radius:16px;padding:10px 14px;box-shadow:var(--shadow)}
    .dm-control[hidden]{display:none}.dm-head{display:flex;align-items:center;gap:8px}.dm-head b{color:var(--forest)}.dm-head output{margin-left:auto;font-weight:700;color:#8f3f22}.dm-close{border:0;background:none;font-size:21px;line-height:1;cursor:pointer;color:var(--ink-3)}
    .dm-control input[type=range]{width:100%;accent-color:#9f3b2d;margin:8px 0 3px}.dm-years{display:flex;justify-content:space-between;gap:3px}.dm-years button{border:0;background:transparent;border-radius:999px;padding:3px 6px;font-size:11px;color:var(--ink-3);cursor:pointer}.dm-years button.on{background:#9f3b2d;color:#fff}
    .dm-caption{margin:6px 0 0;font-size:11px;color:var(--ink-3);line-height:1.45}.dm-caption a{color:inherit}.dm-leg{font-size:12.5px;color:var(--ink)}.dm-leg i{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 4px 0 2px;vertical-align:-1px;border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2)}
    .dm-gone-marker{border:1px dashed #d9362b;background:rgba(255,255,255,.94);color:#7d1c14;border-radius:8px;padding:3px 6px;font:700 10px/1.25 "Noto Sans TC",sans-serif;box-shadow:0 1px 5px rgba(0,0,0,.2);cursor:pointer;white-space:nowrap}.dm-gone-marker small{display:block;font-size:9px;font-weight:500}
    .dm-tree-wrap{border:1px solid var(--line);border-radius:13px;overflow:hidden;background:#e7e5dc}.dm-tree-map{height:280px;width:100%}.dm-tree-controls{padding:9px 10px;background:#fff}.dm-tree-controls input{width:100%;accent-color:#9f3b2d}.dm-tree-years{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}.dm-tree-years button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:3px 8px;font-size:11px;cursor:pointer}.dm-tree-years button.on{background:#9f3b2d;color:#fff;border-color:#9f3b2d}.dm-tree-meta{display:flex;justify-content:space-between;gap:8px;font-size:12px}.dm-tree-note{margin:8px 0 0;font-size:12px;line-height:1.5;color:var(--ink-3)}
    @media(max-width:760px){.dm-control{left:10px;right:10px;bottom:62px;transform:none;width:auto;padding:7px 9px}.dm-control .dm-caption:not(.dm-leg){display:none}.dm-control input[type=range]{margin:4px 0 2px}.dm-head{font-size:13px}.dm-caption{font-size:10px}.dm-years button{padding:3px 4px;font-size:10px}.dm-tree-map{height:225px}}
  `;
  document.head.append(style);
}

function ensureUi(ctx) {
  injectStyle();
  if (!state.launcher) {
    const row = document.createElement('div');
    row.className = 'dm-entry';
    row.hidden = true;
    row.innerHTML = `<button type="button" data-dm-open aria-pressed="false"><span class="dm-icon" aria-hidden="true">🕰️</span><b>示範街區：東門市場</b><small>看東門街區歷年航照</small></button>`;
    document.getElementById('chips')?.insertAdjacentElement('afterend', row);
    row.querySelector('button').addEventListener('click', () => state.active ? deactivate(ctx) : activate(ctx));
    state.launcher = row;
  }
  if (!state.control) {
    const box = document.createElement('section');
    box.className = 'dm-control';
    box.hidden = true;
    box.setAttribute('aria-label', '街區時光機年份控制');
    box.innerHTML = `<div class="dm-head"><b>街區時光機</b><output data-dm-year></output><button class="dm-close" type="button" aria-label="關閉街區時光機">×</button></div>
      <input data-dm-range type="range" min="0" max="${IMAGERY_YEARS.length - 1}" step="1" value="${state.yearIndex}" aria-label="選擇正射影像圖層年份">
      <div class="dm-years">${IMAGERY_YEARS.map((year) => `<button type="button" data-dm-y="${year}">${year}</button>`).join('')}</div>
      <p class="dm-caption dm-leg"><i style="background:${DIFF_COLOR.gone}"></i><i style="background:#fff"></i>白 現存・<i style="background:${DIFF_COLOR.gone}"></i>紅 消失・<i style="background:${DIFF_COLOR.new}"></i>綠 新植 <span class="badge real">真實</span> <span class="badge est" data-dm-nodiff hidden>2022 前無比對資料</span></p>
      <p class="dm-caption"><a href="${SOURCE_URL}" target="_blank" rel="noopener">${SOURCE}</a> ${YEAR_BADGE}</p>`;
    document.body.append(box);
    box.querySelector('[data-dm-range]').addEventListener('input', (event) => showYear(ctx.map, +event.target.value));
    box.querySelectorAll('[data-dm-y]').forEach((button) => button.addEventListener('click', () => showYear(ctx.map, IMAGERY_YEARS.indexOf(+button.dataset.dmY))));
    box.querySelector('.dm-close').addEventListener('click', () => deactivate(ctx));
    state.control = box;
  }
}

function activate(ctx) {
  state.active = true;
  document.body.classList.add('dm-active');
  const keycard = document.getElementById('keycard');
  if (keycard) keycard.hidden = true;
  if (state.launcher) {
    const button = state.launcher.querySelector('button');
    button.classList.add('on'); button.setAttribute('aria-pressed', 'true');
  }
  if (state.control) state.control.hidden = false;
  setLayerVisibility(ctx.map, 'dm-block-line', true);
  setLayerVisibility(ctx.map, 'dm-block-line-top', true);
  setLayerVisibility(ctx.map, 'dm-gone-hit', true);
  setLayerVisibility(ctx.map, 'dm-gone-rings', true);
  for (const marker of state.goneMarkers) marker.addTo(ctx.map);
  dimTrees(ctx.map, true);
  loadDiff(ctx).then(() => showYear(ctx.map, state.yearIndex)).catch((e) => console.warn('dm diff', e));
  showYear(ctx.map, state.yearIndex);
  const mobile = innerWidth <= 760;
  ctx.map.fitBounds([[DONGMEN_BLOCK.bounds[0], DONGMEN_BLOCK.bounds[1]], [DONGMEN_BLOCK.bounds[2], DONGMEN_BLOCK.bounds[3]]], {
    padding: mobile ? { top: 175, right: 20, bottom: 175, left: 20 } : (() => { const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1; return { top: 70 * z, right: 60, bottom: 190 * z, left: 340 * z }; })(),
    duration: 1200,
    maxZoom: 17.4,
  });
}

function deactivate(ctx) {
  state.active = false;
  document.body.classList.remove('dm-active');
  if (state.launcher) {
    const button = state.launcher.querySelector('button');
    button.classList.remove('on'); button.setAttribute('aria-pressed', 'false');
  }
  if (state.control) state.control.hidden = true;
  for (const year of IMAGERY_YEARS) setLayerVisibility(ctx.map, idFor('layer', year), false);
  for (const id of ['dm-block-line', 'dm-block-line-top', 'dm-gone-hit', 'dm-gone-rings', 'dm-diff-pts']) setLayerVisibility(ctx.map, id, false);
  dimTrees(ctx.map, false);
  state.diffPopup?.remove();
  for (const marker of state.goneMarkers) marker.remove();
}

function miniMapHtml(tree) {
  const gone = tree.gone || tree.demo;
  return `<div class="dm-tree-wrap">
    <div class="dm-tree-map" data-dm-mini role="img" aria-label="以這棵樹為中心的歷年正射影像地圖"></div>
    <div class="dm-tree-controls">
      <div class="dm-tree-meta"><b data-dm-mini-year>圖層年份 2025</b><span>紅圈＝樹籍座標</span></div>
      <input data-dm-mini-range type="range" min="0" max="${IMAGERY_YEARS.length - 1}" step="1" value="${IMAGERY_YEARS.length - 1}" aria-label="選擇正射影像圖層年份">
      <div class="dm-tree-years">${IMAGERY_YEARS.map((year) => `<button type="button" data-dm-mini-y="${year}">${year}</button>`).join('')}</div>
      <p class="dm-tree-note"><a href="${SOURCE_URL}" target="_blank" rel="noopener">${SOURCE}</a> ${YEAR_BADGE}${gone ? ' ' + CHECK_BADGE : ''}</p>
    </div>
  </div>`;
}

function bindMiniMap(root, tree) {
  const container = root.querySelector('[data-dm-mini]');
  if (!container || !window.maplibregl) return;
  try { state.treeMap?.remove(); } catch {}
  const startYear = IMAGERY_YEARS[IMAGERY_YEARS.length - 1];
  const markerData = { type: 'Feature', geometry: { type: 'Point', coordinates: [+tree.lng, +tree.lat] }, properties: {} };
  const map = new maplibregl.Map({
    container,
    center: [+tree.lng, +tree.lat],
    zoom: 19,
    minZoom: 16,
    maxZoom: 19,
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        aerial: { type: 'raster', tiles: [tileUrl(startYear)], tileSize: 256, minzoom: 12, maxzoom: 19, attribution: SOURCE },
        marker: { type: 'geojson', data: markerData },
      },
      layers: [
        { id: 'aerial', type: 'raster', source: 'aerial', paint: { 'raster-fade-duration': 0 } },
        { id: 'tree-ring', type: 'circle', source: 'marker', paint: { 'circle-radius': 16, 'circle-color': 'rgba(255,255,255,.04)', 'circle-stroke-color': '#ed2f2f', 'circle-stroke-width': 3 } },
        { id: 'tree-center', type: 'circle', source: 'marker', paint: { 'circle-radius': 2.5, 'circle-color': '#ed2f2f' } },
      ],
    },
  });
  state.treeMap = map;
  const range = root.querySelector('[data-dm-mini-range]');
  const output = root.querySelector('[data-dm-mini-year]');
  const buttons = [...root.querySelectorAll('[data-dm-mini-y]')];
  const show = (index) => {
    const i = Math.max(0, Math.min(IMAGERY_YEARS.length - 1, +index));
    const year = IMAGERY_YEARS[i];
    range.value = String(i); output.textContent = `圖層年份 ${year}`;
    buttons.forEach((button) => button.classList.toggle('on', +button.dataset.dmMiniY === year));
    const source = map.getSource('aerial');
    if (source?.setTiles) source.setTiles([tileUrl(year)]);
  };
  range.addEventListener('input', (event) => show(+event.target.value));
  buttons.forEach((button) => button.addEventListener('click', () => show(IMAGERY_YEARS.indexOf(+button.dataset.dmMiniY))));
  map.on('load', () => show(IMAGERY_YEARS.length - 1));
  show(IMAGERY_YEARS.length - 1);
}

export default {
  id: 'dongmen-block',
  title: '歷年航照｜東門市場街區',
  oneLiner: '用 NLSC 歷年正射影像看同一個街區與每棵樹的位置變化',
  audience: ['public', 'plan', 'mayor'],
  dataStatus: ['real'],
  maturity: 'exp',
  ready: true,
  demoValue: '把單棵誤砍案拉回街區尺度，2014–2025 可直接切換八期真正不同的航照',
  problem: '樹籍只顯示現在，市民看不到同一個街區過去的樹冠與樹籍異動。',
  howto: '按地圖左上「示範街區：東門市場」，拖底部年份滑桿；點街區裡任一棵樹，在詳細頁看以樹為中心的航照。',
  limits: '圖層年份不等於拍攝年份；年度影像會錯位，也可能有雲與陰影。樹籍編號消失不等於已證實遭移除。',
  rollout: { agencies: '國土測繪中心、公園處、資訊局', data: '年度正射影像拍攝日期、逐樹異動原因與歷史樹籍', budget: '先以既有公開 WMTS 試辦，不大量下載', promo: '從東門街區公開示範，邀請市民人工判讀' },
  sources: [{ label: SOURCE, url: SOURCE_URL, date: '2026-10-23 查證' }],

  async init(ctx) {
    state.treeCount = ctx.trees.filter(inBlock).length;
    ensureUi(ctx);
    const map = ctx.map;
    for (const year of IMAGERY_YEARS) {
      map.addSource(idFor('source', year), {
        type: 'raster', tiles: [tileUrl(year)], tileSize: 256, minzoom: 12, maxzoom: 19,
        bounds: DONGMEN_BLOCK.bounds, attribution: SOURCE,
      });
      map.addLayer({
        id: idFor('layer', year), type: 'raster', source: idFor('source', year),
        layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0 },
      }, 'trees-park');
    }
    map.addSource('dm-block', { type: 'geojson', data: {
      type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[
        [DONGMEN_BLOCK.bounds[0], DONGMEN_BLOCK.bounds[1]], [DONGMEN_BLOCK.bounds[2], DONGMEN_BLOCK.bounds[1]],
        [DONGMEN_BLOCK.bounds[2], DONGMEN_BLOCK.bounds[3]], [DONGMEN_BLOCK.bounds[0], DONGMEN_BLOCK.bounds[3]],
        [DONGMEN_BLOCK.bounds[0], DONGMEN_BLOCK.bounds[1]],
      ]] },
    } });
    map.addLayer({ id: 'dm-block-line', type: 'line', source: 'dm-block', layout: { visibility: 'none' }, paint: { 'line-color': '#fff8e7', 'line-width': 4 } });
    map.addLayer({ id: 'dm-block-line-top', type: 'line', source: 'dm-block', layout: { visibility: 'none' }, paint: { 'line-color': '#8f3f22', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
    map.addSource('dm-gone', { type: 'geojson', data: { type: 'FeatureCollection', features: GONE_TREES.map((tree) => ringFeature(tree)) } });
    map.addLayer({ id: 'dm-gone-hit', type: 'fill', source: 'dm-gone', layout: { visibility: 'none' }, paint: { 'fill-color': '#d9362b', 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'dm-gone-rings', type: 'line', source: 'dm-gone', layout: { visibility: 'none' }, paint: { 'line-color': '#d9362b', 'line-width': 3, 'line-dasharray': [1.4, 1.4] } });
    state.goneMarkers = GONE_TREES.map((tree) => {
      const element = document.createElement('button');
      element.className = 'dm-gone-marker'; element.type = 'button';
      element.innerHTML = `${tree.species}｜2026 消失`;
      element.title = `${tree.species}：${tree.note}`;
      element.addEventListener('click', (event) => { event.stopPropagation(); ctx.go(`#/tree/${tree.openId}`); });
      return new maplibregl.Marker({ element, anchor: 'top', offset: [0, 13] }).setLngLat([tree.lng, tree.lat]);
    });
    const openGone = (event) => {
      const feature = event.features?.[0]; if (!feature) return;
      ctx.go(`#/tree/${feature.properties.openId}`);
    };
    map.addSource('dm-diff', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'dm-diff-pts', type: 'circle', source: 'dm-diff', layout: { visibility: 'none' }, paint: {
      'circle-color': ['match', ['get', 'kind'], 'gone', DIFF_COLOR.gone, DIFF_COLOR.new],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 4, 17, 7, 19, 11],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
    } });
    map.on('click', 'dm-diff-pts', (event) => {
      const f = event.features?.[0]; if (!f) return;
      const q = f.properties, e = ctx.esc;
      const ym = (s) => s.slice(0, 7);
      const html = `<b>${e(q.id)}</b>・${e(q.species)}<br>${q.kind === 'gone' ? `${ym(q.from)} 版有、${ym(q.to)} 版沒有` : `${ym(q.from)} 版沒有、${ym(q.to)} 版有・調查 ${q.yr}`}<br><span class="badge real">真實資料比對</span> ${q.kind === 'gone' ? '消失≠已移除' : `新出現≠新植<br><a href="#/tree/${e(q.id)}">開樹頁 ›</a>`}`;
      state.diffPopup?.remove();
      state.diffPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' }).setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
    });
    map.on('mouseenter', 'dm-diff-pts', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'dm-diff-pts', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'dm-gone-hit', openGone);
    map.on('mouseenter', 'dm-gone-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'dm-gone-hit', () => { map.getCanvas().style.cursor = ''; });
  },

  apply(ctx, _layers, on) {
    ensureUi(ctx);
    const visible = on;
    state.launcher.hidden = true; // 入口改成用途按鈕「東門市場」（每角色最多 4 顆）
    const count = state.launcher.querySelector('small');
    if (count) count.textContent = "看東門街區歷年航照";
    if (!visible && state.active) deactivate(ctx);
    setLayerVisibility(ctx.map, 'dm-block-line-top', state.active && visible);
  },

  // 給用途按鈕「東門市場」用：打開／關閉街區時光機
  bounds: DONGMEN_BLOCK.bounds,
  open(ctx) { if (!state.active) activate(ctx); },
  close(ctx) { if (state.active) deactivate(ctx); },

  onTree(_ctx, tree) {
    return inBlock(tree) ? miniMapHtml(tree) : '';
  },

  bindTree(root, _ctx, tree) {
    bindMiniMap(root, tree);
  },

  page(ctx) {
    return `<div class="alert ok"><h3>${DONGMEN_BLOCK.name}</h3><p>範圍約 475 × 477 公尺，2026-10-13 樹籍共有 <b>${state.treeCount.toLocaleString('zh-TW')} 棵</b>。航照只在街區範圍載入，外面維持原底圖。</p></div>
      <p>${IMAGERY_YEARS.join('、')}：已排除沿用前一年照片的 2016、2020、2022、2024 圖層。</p>
      <div class="actions"><button class="btn primary" type="button" data-dm-page-open>打開街區時光機</button></div>`;
  },

  bindPage(root, ctx) {
    root.querySelector('[data-dm-page-open]')?.addEventListener('click', () => { ctx.go('#/'); setTimeout(() => activate(ctx), 0); });
  },
};
