// 首長儀表板：一頁六張卡（存量帳｜樹冠｜久未調查的優先複查樹｜本月異常通報｜補種承諾｜最缺樹蔭三區）。
// 每張卡標資料狀態；市府沒公開的數字不補造，直接寫「市府未公開，建議公開欄位：○○」。點卡下鑽。
import { topDistricts } from '../shade-equity/equity.js';
import { showOnMap } from '../shade-equity/index.js';

// ---------- 官方與開放資料數字（都附來源；改數字請一起改來源）----------
const FACTS = {
  removed2025: { n: 3164, src: '市府 2026-07-12 新聞稿', url: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&s=B9708CAABE7AAC15&sms=72544237BBE4C5F6' },
  planted: { n: 42250, span: '2023 年至 2026 年 9 月底', src: '市府 2026-10-03 新聞稿', url: 'https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=B1649759E218DB6B' },
  pledge: { text: '到 2030 年底（民國 119 年）再增加 4 萬餘株喬木', src: '市府 2026-10-03 新聞稿', url: 'https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=B1649759E218DB6B',
    // 同稿三個分項；相加 40,104 才對得上「4 萬餘」，最可能是相加（未驗證，驗法：向公園處要拆分表）
    urban: 6703, building: 18497, mountain: 14904 },
  pledge2027: { n: 3555, src: '市府 2026-09-26 新聞稿', url: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&sms=72544237BBE4C5F6&s=8DCD753F29154262' },
  canopyStudy: { from: 628, to: 615, src: '中央社 2026-09-27 引述研究團隊衛星推估', url: 'https://www.cna.com.tw/news/aloc/202609270166.aspx' },
  // 行道樹開放資料兩個版本逐筆比對（本專案計算）：網路時光機 2024-11-21 存檔 vs 2026-10-13 下載
  registry: { before: 95498, beforeDate: '2024-11-21', after: 90441, afterDate: '2026-10-13', gone: 9267, added: 4210,
    url: 'https://web.archive.org/web/20241121065019id_/https://tppkl.blob.core.windows.net/blobfs/TaipeiTree.csv' },
};
// 胸徑→冠幅 W＝a·D^b（公尺、公分）。臺中市行道樹開放資料自行擬合，低信心；未列樹種用全樹種合併式
const CROWN = { 茄苳: [1.3649, 0.4831], 樟樹: [2.2799, 0.3225], 臺灣欒樹: [0.8917, 0.6269], 楓香: [0.6816, 0.6908], 榕樹: [1.001, 0.5383], 小葉欖仁: [0.6535, 0.6841] };
const CROWN_FALLBACK = [1.3672, 0.4339];

const n0 = (n) => Math.round(n).toLocaleString();

function canopyEstimate(trees) {
  let area = 0, used = 0, skipped = 0;
  for (const t of trees) {
    let D = t.dbh;
    if (!(D > 0)) { skipped++; continue; }
    if (D > 200) D = 200; // 明顯異常值截斷
    const [a, b] = CROWN[t.species] || CROWN_FALLBACK;
    const W = a * D ** b;
    area += (Math.PI * W * W) / 4;
    used++;
  }
  return { ha: area / 1e4, used, skipped };
}

function staleReview(trees) {
  // 複查優先序前 1%（優先 1、2）裡，調查日期在 2016 年以前或空白的樹
  let top = 0, stale = 0, allStale = 0, oldest = null;
  for (const t of trees) {
    const y = t.survey ? +t.survey.slice(0, 4) : 0;
    const isStale = !y || y <= 2016;
    if (isStale) allStale++;
    if (t.rl >= 3) {
      top++;
      if (isStale) {
        stale++;
        if (y && (!oldest || t.survey < oldest.survey || (t.survey === oldest.survey && (t.dbh || 0) > (oldest.dbh || 0)))) oldest = t;
      }
    }
  }
  return { top, stale, allStale, oldest };
}

async function alarmsThisMonth(ctx) {
  const ev = await ctx.getAllEvents();
  const ym = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 7);
  const ymOf = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 7);
  // 紅線：模擬的異常只算示範區（有模擬施工案）的樹
  const inZone = (e) => { const t = ctx.treeFromId(e.treeId); return t && ctx.workOrderFor(t); };
  const alarms = ev.filter((e) => e.kind === 'alarm' && e.at && ymOf(e.at) === ym && inZone(e)).sort((a, b) => (a.at < b.at ? 1 : -1));
  const reviewed = (a) => ev.some((e) => e.kind === 'review' && e.treeId === a.treeId && e.at > a.at);
  const trees = [...new Set(alarms.map((a) => a.treeId))];
  return { ym, alarms, trees, open: alarms.filter((a) => !reviewed(a)).length };
}

const NOPUB = (fields) => `<div class="md-nopub"><b>未公開</b>｜應公開：${fields}</div>`;

function card({ key, title, badges, big, unit, key1, sub, nopub, cta, extra }) {
  return `<article class="md-card" data-card="${key}" tabindex="0" role="button" aria-label="${title}：${cta}">
    <header><h3>${title}</h3><span class="md-badges">${badges}</span></header>
    <div class="md-big">${big}${unit ? `<small>${unit}</small>` : ''}</div>
    ${key1 ? `<div class="md-key">${key1}</div>` : ''}
    ${nopub || ''}
    <details class="md-more"><summary>算法</summary><div class="md-sub">${sub}</div></details>
    <footer><span class="md-cta">${cta} →</span>${extra || ''}</footer>
  </article>`;
}

const STYLE = `<style>
.f-mayor-dash .md-lead { font-size: 13px; color: var(--ink-2); margin: 4px 0 12px; }
.f-mayor-dash .md-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.f-mayor-dash .md-card { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 12px 12px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; transition: box-shadow .15s, border-color .15s; min-width: 0; }
.f-mayor-dash .md-card:hover, .f-mayor-dash .md-card:focus-visible { border-color: var(--forest); box-shadow: 0 4px 14px rgba(28,43,34,.12); outline: none; }
.f-mayor-dash .md-card header { display: flex; flex-direction: column; gap: 4px; }
.f-mayor-dash .md-card h3 { margin: 0; font-size: 14px; color: var(--forest); line-height: 1.35; }
.f-mayor-dash .md-badges { display: flex; gap: 4px; flex-wrap: wrap; }
.f-mayor-dash .md-badges .badge { font-size: 11px; padding: 1px 6px; }
.f-mayor-dash .md-big { font-family: "Noto Serif TC", serif; font-weight: 900; font-size: 26px; color: var(--ink); line-height: 1.15; word-break: keep-all; overflow-wrap: anywhere; }
.f-mayor-dash .md-big small { font-family: inherit; font-size: 13px; font-weight: 500; color: var(--ink-2); margin-left: 4px; }
.f-mayor-dash .md-big.md-text { font-size: 20px; }
.f-mayor-dash .md-key { font-size: 13px; color: var(--ink); line-height: 1.5; }
.f-mayor-dash .md-more summary { font-size: 12px; color: var(--ink-3); cursor: pointer; }
.f-mayor-dash .md-more[open] summary { margin-bottom: 4px; }
.f-mayor-dash .md-sub { font-size: 12px; color: var(--ink-2); line-height: 1.55; }
.f-mayor-dash .md-sub a { color: var(--leaf); }
.f-mayor-dash .md-sub ul { margin: 2px 0 0; padding-left: 1.1em; }
.f-mayor-dash .md-nopub { font-size: 12px; line-height: 1.5; background: var(--warn-bg); color: #6b3f00; border-radius: 8px; padding: 6px 8px; }
.f-mayor-dash .md-card footer { margin-top: auto; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: space-between; padding-top: 4px; }
.f-mayor-dash .md-cta { font-size: 12px; font-weight: 700; color: var(--forest); }
.f-mayor-dash .md-card .btn.mini { font-size: 12px; padding: 4px 9px; }
.f-mayor-dash .md-badge-np { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--warn-bg); color: #6b3f00; border: 1px dashed var(--warn); }
.f-mayor-dash .md-foot { font-size: 12px; color: var(--ink-3); margin-top: 14px; line-height: 1.6; }
</style>`;

async function page(ctx) {
  const esc = ctx.esc, B = ctx.badge, NP = '<span class="md-badge-np">未公開</span>';
  const R = FACTS.registry;
  const cn = canopyEstimate(ctx.trees);
  const sr = staleReview(ctx.trees);
  let al = null, eq = null;
  try { al = await alarmsThisMonth(ctx); } catch (e) { console.warn('mayor-dash alarms', e); }
  try { eq = await topDistricts(ctx, 3); } catch (e) { console.warn('mayor-dash equity', e); }

  const cards = [
    card({
      key: 'ledger', title: '存量帳', badges: `${B('real')}${NP}`,
      big: '算不出來', key1: `移除 ${n0(FACTS.removed2025.n)}（2025）｜種植 ${n0(FACTS.planted.n)}（2023–2026/9）｜口徑不同`, sub: `<ul>
        <li>登錄筆數 ${esc(R.beforeDate)} <b>${n0(R.before)}</b> → ${esc(R.afterDate)} <b>${n0(R.after)}</b>（消失 ${n0(R.gone)}、新增 ${n0(R.added)}；原因未公開）</li></ul>`,
      nopub: NOPUB('分區分年存量帳、逐樹異動與原因'),
      cta: '看存量帳', extra: '<button class="btn mini" data-go2="#/records">公開紀錄</button>',
    }),
    card({
      key: 'canopy', title: '樹冠面積', badges: `${B('est')}`,
      big: `約 ${n0(cn.ha)}`, unit: '公頃', key1: `衛星推估 ${FACTS.canopyStudy.to} 公頃（媒體轉述）`,
      sub: `${n0(cn.used)} 棵胸徑推冠幅加總；${n0(cn.skipped)} 棵無胸徑；重疊未扣<br>衛星推估 ${FACTS.canopyStudy.from}→${FACTS.canopyStudy.to} 公頃`,
      nopub: NOPUB('逐年樹冠覆蓋率、分里樹冠面積'),
      cta: '看樹冠負債',
    }),
    card({
      key: 'review', title: '優先複查樹', badges: `${B('real')}${B('est')}`,
      big: n0(sr.stale), unit: '株', key1: '前 1% 中 2016 年前未調查｜排序，非診斷',
      sub: `前 1%：${n0(sr.top)} 株｜全市久未調查：${n0(sr.allStale)} 株${sr.oldest ? `<br>例：<a href="#/tree/${esc(sr.oldest.id)}">${esc(sr.oldest.species)}（${esc(sr.oldest.dist)}，${esc(sr.oldest.survey)}）</a>` : ''}`,
      nopub: NOPUB('巡檢日期、風險等級、處理狀態'),
      cta: '在地圖上看',
    }),
    card({
      key: 'alarm', title: '本月異常通報', badges: `${B('sim')}${B('live')}`,
      big: al ? n0(al.alarms.length) : '—', unit: '件', key1: al ? `${al.open} 件未複核` : '',
      sub: al ? `${esc(al.ym)}｜${al.trees.length} 棵樹${al.alarms[0] ? `<br>最新：<a href="#/tree/${esc(al.alarms[0].treeId)}">${esc(ctx.treeFromId(al.alarms[0].treeId)?.place || al.alarms[0].treeId)}・${esc(al.alarms[0].result || '')}</a>` : ''}<br>僅示範區｜廠商（虛構）` : '讀不到回報',
      nopub: NOPUB('核定處置清冊、監造複核紀錄'),
      cta: '到管理總覽',
    }),
    card({
      key: 'pledge', title: '補種達成率', badges: `${B('real')}${NP}`,
      big: '無法計算', key1: `2030 年再增 4 萬餘株｜市區僅 ${n0(FACTS.pledge.urban)}｜無樹冠目標`, sub: `市區 <b>${n0(FACTS.pledge.urban)}</b>、建築基地 ${n0(FACTS.pledge.building)}、山區撫育 ${n0(FACTS.pledge.mountain)}（相加＝4 萬餘，假說）<br>2027 年底市區再增 ${n0(FACTS.pledge2027.n)}`,
      nopub: NOPUB('拆分、逐年進度、存活率、樹冠目標'),
      cta: '看承諾追蹤',
    }),
    card({
      key: 'equity', title: '最缺樹蔭三區', badges: `${B('real')}${B('est')}`,
      big: eq && eq.length ? esc(eq.map((r) => r.u.d.replace(/區$/, '')).join('、')) : '—', unit: eq && eq.length ? '區' : '', key1: eq && eq.length ? eq.map((r) => `${esc(r.u.d)} ${r.u.perKm} 株／km`).join('、') : '',
      sub: eq && eq.length ? `缺蔭 50%＋兒童 25%＋長者 25%<br>${eq.map((r) => `${esc(r.u.d)}：${Math.round(r.score)} 分`).join('<br>')}` : '載入失敗',
      cta: '看排行', extra: '<button class="btn mini" data-eqmap>看地圖</button>',
    }),
  ];
  // 拿掉卡片內 big 的兩段文字樣式
  const html = cards.join('').replace(/<div class="md-big">(算不出來|無法計算)/g, '<div class="md-big md-text">$1');
  return `${STYLE}<div class="f-mayor-dash">
    <p class="md-lead">${B('real')}${B('est')}${B('sim')}${B('live')}<span class="md-badge-np">未公開</span></p>
    <div class="md-grid">${html}</div>
    <p class="md-foot">來源：公園處樹籍（2026-10-13）、民政局人口（2026-09）｜<a href="#/f/mayor-dash">詳細</a></p>
  </div>`;
}

function turnOnReview(ctx) {
  if (!ctx.isOn('review')) ctx.setFeature('review', true);
  const L = ctx.S.layers;
  L.review = true; L.street = true; L.park = true;
  // 決定點顏色的圖層同時只能開一個
  for (const k of ['stale']) L[k] = false;
  ctx.refresh();
  ctx.S.homeShown = true;
  ctx.go('#/');
  ctx.map.flyTo({ center: [121.545, 25.06], zoom: 11.6, duration: 900 });
}

function bindPage(root, ctx) {
  const act = (key) => {
    if (key === 'ledger') ctx.go('#/f/canopy-ledger');
    else if (key === 'canopy') ctx.go('#/f/canopy-debt');
    else if (key === 'review') turnOnReview(ctx);
    else if (key === 'alarm') ctx.go('#/dash');
    else if (key === 'pledge') ctx.go('#/f/commitments');
    else if (key === 'equity') ctx.go('#/f/shade-equity');
  };
  root.addEventListener('click', (e) => {
    if (e.target.closest('a, details')) return; // 卡片內連結、展開說明照常
    const b = e.target.closest('button');
    if (b && b.dataset.go2) { e.stopPropagation(); return ctx.go(b.dataset.go2); }
    if (b && b.hasAttribute('data-eqmap')) { e.stopPropagation(); return showOnMap(ctx, null, null); }
    const c = e.target.closest('[data-card]'); if (c) act(c.dataset.card);
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-card]')) { e.preventDefault(); act(e.target.dataset.card); }
  });
}

export default {
  id: 'mayor-dash',
  title: '首長儀表板',
  oneLiner: '一頁看樹的三本帳與公平',
  audience: ['mayor'],
  dataStatus: ['real', 'est', 'sim', 'live'],
  maturity: 'stable',
  ready: true,
  nav: ['mayor'],
  route: 'mayor',
  demoValue: '首長第一眼：哪些數字算得出來、哪些市府根本沒公開，點下去就到地圖',
  problem: '「移除 3,164 棵」和「種了 42,250 棵」口徑不同、對不起來；決策者沒有一頁能看出樹是變多還是變少、樹蔭有沒有變多、哪裡出事、錢該先給誰。',
  howto: '首長版首頁就是這一頁（鍵盤 7 切換）。六張卡各標資料狀態，點卡下鑽：存量帳、樹冠負債、地圖上的複查優先序、管理總覽、承諾追蹤、樹蔭公平排行。',
  limits: '存量帳與補種達成率市府未公開，卡片只並列官方數字、不相減；樹冠是用胸徑推估（臺中資料擬合的冠幅式，樹冠重疊未扣），不是航照判讀；複查優先序是排序不是病況；異常通報只算示範區，示範資料為模擬、廠商虛構；最缺樹蔭三區用登錄樹木密度代理。',
  rollout: {
    agencies: '研考會（彙整 KPI、每月更新）、公園處（存量帳、補植與巡檢資料）、資訊局（儀表板與資料串接）、工務局（施工異常）',
    data: '年度存量帳（期初、新植、死亡、移除、期末）、逐樹異動原因、巡檢與風險評估紀錄、補植地點與存活率、施工核定處置清冊',
    budget: '情境試算：儀表板本身約 1–2 人月，含在平台試辦 100–200 萬內；資料整備另計',
    promo: '市政會議固定第一頁；對外公開版每月更新一次，未公開的格子留著當資料開放進度表',
  },
  sources: [
    { label: '市府新聞稿：2025 年移除 3,164 株（網路砍樹謠言扭曲事實）', url: FACTS.removed2025.url, date: '2026-07-12' },
    { label: '市府新聞稿：2023 年至 2026 年 9 月底種植 42,250 株、2030 年底再增 4 萬餘株', url: FACTS.planted.url, date: '2026-10-03' },
    { label: '市府新聞稿：2027 年底市區再新增 3,555 棵', url: FACTS.pledge2027.url, date: '2026-09-26' },
    { label: '中央社：研究團隊推估市區樹冠 628→615 公頃（媒體轉述）', url: FACTS.canopyStudy.url, date: '2026-09-27' },
    { label: '臺北市行道樹及公園樹木分布圖（公園處，政府資料開放授權）', url: 'https://data.gov.tw/dataset/128274', date: '2026-10-13 下載' },
    { label: '行道樹 CSV 網路時光機存檔（比對登錄筆數用）', url: FACTS.registry.url, date: '2024-11-21' },
    { label: '冠幅公式來源：臺中市主要道路喬木植栽開放資料（本專案自行擬合）', url: 'https://data.gov.tw/dataset/108167', date: '2026-10-23' },
    { label: '各里人口按年齡（民政局）', url: 'https://data.taipei/dataset/detail?id=a6394e3f-3514-4542-87bd-de4310a40db3', date: '2026 年 9 月' },
  ],
  page,
  bindPage,
};
