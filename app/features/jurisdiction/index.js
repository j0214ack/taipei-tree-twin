// 跨局處權責地圖：這棵樹／這個點是誰管、要找誰回報。
// 單棵樹：依樹籍「行道樹／公園樹」判斷（真實欄位）。地圖任一點：用最近的登錄樹木＋底圖（OpenStreetMap）土地使用推估，標推估。
const KX = 100850, KY = 110900;

const AG = {
  pkl: { name: '工務局公園處', url: 'https://pkl.gov.taipei/', duty: 'https://pkl.gov.taipei/News.aspx?n=C2DFEFA42339B690&sms=A2B20440BA18ED01' },
  nco: { name: '工務局新工處', url: 'https://nco.gov.taipei/', duty: 'https://nco.gov.taipei/News.aspx?n=EF8BCD0B3D07B082&sms=73A5113E33DDEA76' },
  doe: { name: '教育局與各校', url: 'https://www.doe.gov.taipei/' },
  dig: { name: '道路挖掘管理中心', url: 'https://dig.taipei/Tpdig/' },
};
const CH = {
  c1999: { label: '1999 線上陳情', url: 'https://1999.gov.taipei/' },
  geo: { label: '行道樹路燈資訊網', url: 'https://geopkl.gov.taipei/' },
  edu: { label: '校園樹木資訊平臺', url: 'https://edutreemap.moe.edu.tw/trees/' },
};
const PHONE = '1999／外縣市 02-2720-8889';

let on = false, popup = null;
const ZH = { school: '學校', kindergarten: '幼兒園', university: '大學', college: '專科學校', hospital: '醫院', cemetery: '墓地', military: '軍事用地', park: '公園', garden: '花園', national_park: '國家公園', protected_area: '保護區', nature_reserve: '自然保留區' };
const zh = (k) => ZH[k] || k;

function nearest(trees, lng, lat, maxM) {
  const dl = maxM / KX, dt = maxM / KY;
  let best = { street: null, ds: Infinity, park: null, dp: Infinity };
  for (const t of trees) {
    if (Math.abs(t.lng - lng) > dl || Math.abs(t.lat - lat) > dt) continue;
    const d = Math.hypot((t.lng - lng) * KX, (t.lat - lat) * KY);
    if (t.kind === 1) { if (d < best.dp) { best.dp = d; best.park = t; } } else if (d < best.ds) { best.ds = d; best.street = t; }
  }
  return best;
}

// 回傳 { title, who: [[角色, AG 或文字]], channels: [CH], basis: [], status: 'real'|'est' }
function classifyTree(t) {
  if (t.kind === 1) return {
    title: `公園樹${t.place ? `（${t.place}）` : ''}`,
    who: [['樹木養護、修剪、移植', AG.pkl], ['公園設施與管理', AG.pkl]],
    channels: [CH.c1999, CH.geo], basis: ['樹籍：公園樹'], status: 'real',
  };
  return {
    title: `行道樹${t.place ? `（${t.place}）` : ''}`,
    who: [['樹木養護、修剪、移植', AG.pkl], ['人行道與樹穴', AG.nco], ['路燈', AG.pkl]],
    channels: [CH.c1999, CH.geo], basis: ['樹籍：行道樹'], status: 'real',
  };
}

function osmAt(map, point) {
  const out = { landuse: null, park: null, cover: null, road: false };
  const layers = ['jur-osm-landuse', 'jur-osm-cover', 'park'].filter((id) => map.getLayer(id));
  if (layers.length) {
    for (const f of map.queryRenderedFeatures(point, { layers })) {
      if (f.layer.id === 'jur-osm-landuse' && !out.landuse) out.landuse = f.properties.class;
      if (f.layer.id === 'jur-osm-cover' && !out.cover) out.cover = f.properties.subclass || f.properties.class;
      if (f.layer.id === 'park' && !out.park) out.park = { cls: f.properties.class, name: f.properties['name:zh-Hant'] || f.properties['name:zh'] || f.properties.name };
    }
  }
  const roads = (map.getStyle()?.layers || []).filter((l) => l['source-layer'] === 'transportation' && l.type === 'line' && /highway|road/.test(l.id)).map((l) => l.id);
  if (roads.length) {
    const p = point;
    out.road = map.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]], { layers: roads }).length > 0;
  }
  return out;
}

function classifyPoint(ctx, lngLat, point) {
  const { lng, lat } = lngLat;
  const nb = nearest(ctx.trees, lng, lat, 60);
  const osm = osmAt(ctx.map, point);
  const basis = [];
  if (nb.park) basis.push(`最近的公園樹 ${Math.round(nb.dp)} 公尺${nb.park.place ? `（${nb.park.place}）` : ''}`);
  if (nb.street) basis.push(`最近的行道樹 ${Math.round(nb.ds)} 公尺${nb.street.place ? `（${nb.street.place}）` : ''}`);
  if (osm.landuse) basis.push(`底圖土地使用：${zh(osm.landuse)}`);
  if (osm.park) basis.push(`底圖公園範圍：${osm.park.name || zh(osm.park.cls)}`);
  if (osm.cover) basis.push(`底圖地表：${zh(osm.cover)}`);
  if (osm.road) basis.push('點在底圖道路上');
  const R = (title, who, channels) => ({ title, who, channels, basis, status: 'est' });
  if (['school', 'kindergarten'].includes(osm.landuse)) return R('校園', [['校園樹木與校地', AG.doe]], [CH.edu, CH.c1999]);
  if (['university', 'college'].includes(osm.landuse)) return R('大專校院', [['校園樹木與校地', '各校自管（非市府）']], [CH.edu]);
  if (osm.park && osm.park.cls === 'national_park') return R('國家公園', [['園區管理', '陽明山國家公園管理處']], [CH.c1999]);
  if (nb.park && nb.dp <= 30 && (!nb.street || nb.dp <= nb.ds)) return R(`公園綠地${nb.park.place ? `（${nb.park.place}）` : ''}`, [['公園樹木與設施', AG.pkl]], [CH.c1999, CH.geo]);
  if (nb.street && nb.ds <= 15) return R(osm.road ? '道路與人行道' : '人行道／行道樹帶', [['行道樹', AG.pkl], ['人行道與樹穴', AG.nco], ...(osm.road ? [['道路養護', AG.nco]] : []), ['路燈', AG.pkl]], [CH.c1999, CH.geo]);
  if (osm.road) return R('市區道路', [['道路養護', AG.nco], ['道路施工、挖掘', AG.dig], ['路燈', AG.pkl]], [CH.c1999]);
  if (osm.park || ['park', 'garden'].includes(osm.cover)) return R('綠地', [['市府公園', AG.pkl], ['其他', '私有地或未列管']], [CH.c1999]);
  return R('私有地或未列管', [['土地與樹木', '查無市府列管']], [CH.c1999]);
}

function html(ctx, r, compact) {
  const e = ctx.esc;
  const who = r.who.map(([role, a]) => `<li><span style="color:var(--ink-3)">${e(role)}</span><br>${typeof a === 'string' ? e(a) : `<a href="${e(a.url)}" target="_blank" rel="noopener">${e(a.name)}</a>`}</li>`).join('');
  const ch = r.channels.map((c) => `<a href="${e(c.url)}" target="_blank" rel="noopener">${e(c.label)}</a>`).join('<br>');
  return `<div class="f-jurisdiction" style="font-size:13px;line-height:1.55;${compact ? 'max-width:260px' : ''}">
    ${compact ? `<b style="font-size:14px">${e(r.title)}</b> ${ctx.badge(r.status)}` : ''}
    <ul style="list-style:none;padding:0;margin:6px 0">${who}</ul>
    <div style="background:var(--paper);border-radius:10px;padding:8px 10px;margin:6px 0"><b>回報管道</b><br>${ch}<br><span style="color:var(--ink-3)">${PHONE}</span></div>
    ${r.basis.length ? `<p class="privacy" style="margin:4px 0">依據：${e(r.basis.join('；'))}</p>` : ''}
  </div>`;
}

const STYLE = `<style>
.f-jurisdiction-page table.track td:first-child{white-space:nowrap}
</style>`;

export default {
  id: 'jurisdiction',
  title: '跨局處權責地圖',
  oneLiner: '這裡誰管、找誰回報',
  audience: ['public', 'gov'],
  dataStatus: ['real', 'est'],
  maturity: 'exp',
  ready: true,
  demoValue: '民眾不用先搞懂市府組織圖，點一下就知道找公園處、新工處還是學校',
  problem: '樹木、樹穴、人行道、路燈、校園分屬不同單位；民眾回報常被轉來轉去，市府內部也要花時間分派。',
  howto: '單棵樹頁面下方有「誰管這棵樹」。開啟這個功能後，在地圖上點沒有樹的地方，會跳出那個位置最可能的權責單位與回報管道。',
  limits: '單棵樹依樹籍的「行道樹／公園樹」分類，屬真實欄位；地圖任一點是推估：用最近的登錄樹木距離與 OpenStreetMap 土地使用判斷，不是地籍或管理機關的正式紀錄。校園只靠底圖判斷；查不到的寫「私有地或未列管（推測）」。',
  rollout: {
    agencies: '工務局（公園處、新工處）、教育局、研考會（1999 分派）、地政局',
    data: '公園範圍面、人行道範圍圖、校地範圍、地籍與管理機關欄位；1999 案件分派規則',
    budget: '情境試算：圖資已大多存在於市府，主要是整合與 1999 分派規則對接人力',
    promo: '樹牌 QR 直接帶出權責與回報管道；1999 客服用同一張圖分派',
  },
  sources: [
    { label: '公園處業務職掌（行道樹、公園）', url: AG.pkl.duty, date: '2026-10-23 查閱' },
    { label: '新工處業務職掌（道路橋涵人行道）', url: AG.nco.duty, date: '2026-10-23 查閱' },
    { label: '臺北市陳情系統 1999', url: CH.c1999.url, date: '2026-10-23 查閱' },
    { label: '臺北市行道樹及公園樹木分布圖', url: 'https://data.gov.tw/dataset/128274', date: '2026-10-13 下載' },
    { label: '底圖土地使用：OpenStreetMap（經 OpenFreeMap）', url: 'https://www.openstreetmap.org/copyright' },
  ],

  async page(ctx) {
    const e = ctx.esc;
    const street = ctx.trees.filter((t) => t.kind === 0).length, park = ctx.trees.length - street;
    const rows = [
      ['行道樹', AG.pkl, `${street.toLocaleString()} 棵（樹籍）`],
      ['公園樹、公園設施', AG.pkl, `${park.toLocaleString()} 棵（樹籍）`],
      ['路燈', AG.pkl, ''],
      ['人行道、樹穴', AG.nco, ''],
      ['市區道路、道路挖掘', AG.nco, ''],
      ['國中小、高中校園', AG.doe, '各校自管'],
      ['查不到的地方', null, '私有地或未列管（推估）'],
    ];
    return `${STYLE}<div class="f-jurisdiction-page">
      <table class="track"><thead><tr><th>對象</th><th>單位</th><th>備註</th></tr></thead><tbody>
      ${rows.map(([k, a, n]) => `<tr><td>${e(k)}</td><td>${a ? `<a href="${e(a.url)}" target="_blank" rel="noopener">${e(a.name)}</a>` : '—'}</td><td><small>${e(n)}</small></td></tr>`).join('')}
      </tbody></table>
      <h3 class="h3">回報管道 ${ctx.badge('real')}</h3>
      <ul class="list dist">
        <li><a href="${e(CH.c1999.url)}" target="_blank" rel="noopener">${e(CH.c1999.label)}</a><span>${e(PHONE)}</span></li>
        <li><a href="${e(CH.geo.url)}" target="_blank" rel="noopener">${e(CH.geo.label)}</a><span>公園處</span></li>
        <li><a href="${e(AG.dig.url)}" target="_blank" rel="noopener">${e(AG.dig.name)}</a><span>工務局</span></li>
        <li><a href="${e(CH.edu.url)}" target="_blank" rel="noopener">${e(CH.edu.label)}</a><span>教育部</span></li>
      </ul>
      <p class="privacy">來源：各機關業務職掌（2026-10-23）</p>
      <div class="actions"><button class="btn primary" data-try>點地圖查誰管</button></div>
    </div>`;
  },
  bindPage(root, ctx) {
    root.querySelector('[data-try]')?.addEventListener('click', () => {
      if (!ctx.isOn('jurisdiction')) ctx.setFeature('jurisdiction', true);
      ctx.go('#/');
      ctx.showToast('點地圖空白處看誰管', 5000);
    });
  },

  async onTree(ctx, tree) {
    const r = classifyTree(tree);
    const wo = ctx.workOrderFor(tree);
    return `<p style="margin:4px 0"><b>${ctx.esc(r.title)}</b></p>${html(ctx, r, false)}
      ${wo ? `<p class="privacy">施工中歸工程主辦機關：${ctx.esc(wo.order.name)} ${ctx.badge('sim')}</p>` : ''}`;
  },

  async init(ctx) {
    const m = ctx.map;
    // 底圖（OpenFreeMap）有向量圖磚時，加兩個看不見的圖層，讓點擊可以查到土地使用
    if (m.getSource('openmaptiles')) {
      try {
        m.addLayer({ id: 'jur-osm-landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', filter: ['match', ['get', 'class'], ['school', 'kindergarten', 'university', 'college', 'hospital', 'cemetery', 'military'], true, false], paint: { 'fill-opacity': 0 } }, m.getLayer('trees-park') ? 'trees-park' : undefined);
        m.addLayer({ id: 'jur-osm-cover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: ['match', ['get', 'subclass'], ['park', 'garden'], true, false], paint: { 'fill-opacity': 0 } }, m.getLayer('trees-park') ? 'trees-park' : undefined);
      } catch (e) { console.warn('jurisdiction osm', e); }
    }
    const treeLayers = ['shade', 'planters', 'dongmen', 'trees-wo', 'trees-adopt', 'trees-stale', 'trees-review', 'trees-street', 'trees-park', 'plant', 'trees-nonew'];
    m.on('click', (ev) => {
      if (!on) return;
      popup?.remove(); popup = null;
      if (Date.now() - (ctx.S.__caPickAt || 0) < 800) return; // 剛剛是工程衝突預警在選中心
      const p = ev.point, pad = matchMedia('(pointer: coarse)').matches ? 14 : 6;
      const live = treeLayers.filter((id) => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none');
      if (live.length && m.queryRenderedFeatures([[p.x - pad, p.y - pad], [p.x + pad, p.y + pad]], { layers: live }).length) return; // 點到樹，交給樹的頁面
      const r = classifyPoint(ctx, ev.lngLat, p);
      popup = new maplibregl.Popup({ maxWidth: '290px', closeButton: true }).setLngLat(ev.lngLat).setHTML(html(ctx, r, true)).addTo(m);
    });
  },
  apply(ctx, layers, isOn) {
    on = !!isOn;
    if (!on) { popup?.remove(); popup = null; }
  },
};
