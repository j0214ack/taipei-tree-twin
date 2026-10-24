// 承諾追蹤：每條官方承諾有目標、期限、現況、來源、更新日。
// 資料：/data/policy/official-kpis.json（複製自 data/derived/policy/official-kpis.json，2026-10-23 決策功能資料準備 thread 核對原件；
// 來源與雜湊見同目錄 official-kpis.manifest.json、research/18c-kpi-factcheck.md）。
// 進度：官方沒有逐年進度，一律寫「未公開」；時間進度是用發布日到期限的日曆計算。本隊提案 KPI 的進度是模擬示範。

const R100 = (agencies, data, budget, promo) => ({ agencies, data, budget, promo });
const fmt = (v) => (Number.isFinite(v) ? v.toLocaleString('zh-TW') : '—');

const GROUPS = [
  { key: 'count', title: '有數字有期限（皆株數）', ids: ['KPI-01', 'KPI-05', 'KPI-10'], children: { 'KPI-01': ['KPI-02', 'KPI-03', 'KPI-04'] } },
  { key: 'other', title: '有期限、無指標', ids: ['KPI-08', 'KPI-09'] },
  { key: 'progress', title: '官方自述進度', ids: ['KPI-14'] },
];
const NOSHADE = ['KPI-06', 'KPI-07', 'KPI-12', 'KPI-13', 'KPI-11'];
const EXCLUDED = ['KPI-15'];
const TARGET_LABEL = { 'KPI-01': '再增 4 萬餘株', 'KPI-02': '約 6,703 株', 'KPI-03': '18,497 株（預估）', 'KPI-04': '14,904 株（預估）', 'KPI-05': '3,555 棵', 'KPI-10': '774 株', 'KPI-08': '完成改版', 'KPI-09': '每路段 5 年修剪 1 次', 'KPI-14': '逾 13,225 株（已種）' };
const READ = { // 本隊判讀（一句話）
  'KPI-01': '僅約 6,703 株（17%）在市區人行道／公園，其餘為建築基地與山區',
  'KPI-05': '屬 6,703 株的一部分（假說）；以原稿 3,555 為準',
  'KPI-08': '本站可作改版示範',
  'KPI-09': '修剪 25–35% 樹枝，與降溫目標有張力',
  'KPI-14': '跨兩年、三機關、含山區，不可對比 3,164',
};

const PROPOSED = [
  { k: '抽樣樹木事件可連回樹籍與核准文件', target: '≥ 95%', sim: '72%', simPct: 72 / 95 },
  { k: '非緊急施工後更新紀錄', target: '3 個工作天內', sim: '平均 5.2 個工作天', simPct: 3 / 5.2 },
  { k: '每株額外工時', target: '≤ 10 分鐘', sim: '14 分鐘', simPct: 10 / 14 },
  { k: '處置與核准不符、且沒被事前攔下的案件', target: '0 件', sim: '1 件', simPct: 0 },
];

const STYLE = `<style>
.f-cm .cm-lead{font-size:15px;line-height:1.6;margin:8px 0}
.f-cm .cm-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:10px 0}
.f-cm .cm-card.child{margin:8px 0 0 10px;padding:8px 10px;border-style:dashed;background:transparent}
.f-cm .cm-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap}
.f-cm .cm-head h4{font-size:15px;margin:0}
.f-cm .cm-target{font-family:"Noto Serif TC",serif;font-size:20px;color:var(--forest);font-weight:700}
.f-cm .cm-card.child .cm-target{font-size:16px}
.f-cm dl{display:grid;grid-template-columns:72px 1fr;gap:3px 8px;margin:8px 0 0;font-size:13px}
.f-cm dt{color:var(--ink-3)}
.f-cm dd{margin:0;color:var(--ink-2)}
.f-cm .cm-na{display:inline-block;font-size:12px;font-weight:600;color:var(--danger);border:1.5px dashed var(--danger);border-radius:8px;padding:0 6px}
.f-cm .cm-time{display:flex;align-items:center;gap:6px}
.f-cm .cm-time .bar{flex:1;max-width:160px}
.f-cm .cm-read{font-size:13px;margin:8px 0 0;padding:6px 8px;background:var(--paper);border-radius:8px}
.f-cm details{margin-top:6px;font-size:13px}
.f-cm details summary{cursor:pointer;color:var(--ink-2)}
.f-cm blockquote{margin:6px 0;padding:4px 10px;border-left:3px solid var(--leaf-2);color:var(--ink-2)}
.f-cm .cm-gap{border:2px solid var(--danger);background:var(--danger-bg)}
.f-cm .cm-gap h3{color:#7d1c14}
.f-cm .cm-gap li{margin:4px 0}
.f-cm .cm-lv{display:inline-block;font-size:11px;border-radius:999px;padding:0 6px;border:1px solid var(--line);white-space:nowrap}
.f-cm table.track td:nth-child(2),.f-cm table.track td:nth-child(3){white-space:nowrap}
.f-cm .cm-tablewrap{overflow-x:auto}
</style>`;

const NA = '<span class="cm-na">未公開</span>';
const strip = (s) => String(s || '').replace(/我的/g, '本隊的');
const topic = (k) => String(k.topic || '').split('｜').pop();

function timePct(k, now) {
  const a = Date.parse(String(k.published).slice(0, 10)), b = Date.parse(String(k.deadline || '').slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.max(0, Math.min(1, (now - a) / (b - a)));
}

function card(ctx, k, now, child = false) {
  const e = ctx.esc;
  const tp = timePct(k, now);
  const deadline = k.deadline && /^\d{4}/.test(k.deadline) ? String(k.deadline).replace(/（.*$/, '') : (k.deadline || '沒寫');
  const isProgress = k.id === 'KPI-14';
  return `<article class="cm-card ${child ? 'child' : ''}">
    <div class="cm-head"><h4>${e(topic(k))}</h4><span class="cm-target">${e(TARGET_LABEL[k.id] || (k.target_value != null ? fmt(k.target_value) : '沒有數字'))}</span></div>
    <dl>
      ${isProgress ? '' : `<dt>期限</dt><dd>${e(deadline)}${tp != null ? `<div class="cm-time">${ctx.bar(tp, 1, 'var(--ink-3)')}<small>時間過 ${Math.round(tp * 100)}%</small></div>` : ''}</dd>`}
      <dt>基準</dt><dd>${e(k.baseline || '未提供')}</dd>
      ${isProgress ? '' : `<dt>進度</dt><dd>${NA}</dd>`}
      <dt>來源</dt><dd><a href="${e(k.url)}" target="_blank" rel="noopener">${e(k.publisher)}</a>，${e(k.published)} <span class="cm-lv">${e(k.evidence_level)}</span></dd>
      <dt>核對日</dt><dd>${e(k.verified_on)}</dd>
    </dl>
    ${READ[k.id] ? `<p class="cm-read"><b>判讀</b> ${e(READ[k.id])}</p>` : ''}
    <details><summary>原文</summary><blockquote>「${e(k.quote)}」</blockquote><p>${e(strip(k.notes))}</p></details>
  </article>`;
}

let cache = null;
async function load(ctx) {
  if (!cache) cache = ctx.fetchJSON('/data/policy/official-kpis.json').catch((err) => { cache = null; throw err; });
  return cache;
}

export default {
  id: 'commitments',
  title: '承諾追蹤',
  oneLiner: '市府植樹承諾做到哪',
  audience: ['mayor', 'public', 'gov'],
  dataStatus: ['real', 'sim'],
  maturity: 'stable',
  ready: true,
  demoValue: '「2030 再增 4 萬餘株」原件屬實，但拆開只有約 6,703 株種在市區公共空間；官方沒有任何一條樹冠或遮蔭目標',
  problem: '承諾散在新聞稿、施政報告、市政會議紀錄裡，沒有人追進度；株數目標混了山區、民間建案和人行道，看不出路上的樹蔭會不會變多。',
  howto: '打開獨立頁：每條承諾一張卡，有目標、期限、時間已過多少、基準、來源連結與原文；達成進度沒有官方數字就寫「未公開」。最下面是本隊提案的 100 天試辦 KPI，進度可切換成模擬示範。',
  limits: '只收已打開原件核對的官方承諾（2026-10-23）；鏡週刊轉述的「2030 公園樹木 110,675 棵」找不到原件，不列入追蹤。官方沒有逐年進度，所以沒有「達成率」；時間進度只是日曆計算。本隊提案 KPI 不是市府承諾，示範進度是模擬。',
  rollout: R100('研考會（列管）、公園處（植樹與資訊網）、都發局與大地處（分塊植樹）、秘書處（市政會議追蹤）', '每條承諾的年度進度（分市區、建築基地、山區三塊）、樹冠或遮蔭目標與量測方法、體感降溫量測方法與基準', '情境試算：只需整理既有報告欄位，含在平台試辦 100–200 萬內', '每季更新一次，首長記者會與議會報告直接引用；記者與市民可訂閱單一承諾'),
  sources: [
    { label: '公園處〈臺北持續增綠 市府植樹增蔭降溫〉（2030 再增 4 萬餘株）', url: 'https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=B1649759E218DB6B', date: '2026-10-03' },
    { label: '公園處（2027 年底市區再增 3,555 棵）', url: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&sms=72544237BBE4C5F6&s=8DCD753F29154262', date: '2026-09-26' },
    { label: '公園處（115 年 12 月底前優化行道樹路燈資訊網）', url: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&sms=72544237BBE4C5F6&s=7A981D7DA6F441A1', date: '2026-09-14' },
    { label: '市長議會專案報告（體感降溫 2℃）', url: 'https://www.gov.taipei/News_Content.aspx?n=D07E52F0FF169E83&sms=4F76BD4E1FD15647&s=09FB428A30CB2AEA', date: '2026-08-28' },
    { label: '第 2275 次市政會議紀錄（綠覆降溫階段性目標）', url: 'https://www.gov.taipei/News_Content.aspx?n=D6946078AE437FF0&s=492A32D416258AF7&sms=14AEF9A8536E3B5E', date: '2023-12-21' },
  ],
  openFields: [
    { field: '4 萬株承諾的拆分表與逐年進度（市區 6,703／建築基地 18,497／山區 14,904）', why: '沒有進度就沒有達成率；三塊對行人樹蔭的作用差很多', status: '未公開', agency: '公園處、都發局、大地處', when: '100 天' },
    { field: '樹冠或遮蔭目標（數值、期限、量測方法）', why: '市長報告說政策轉向「高遮蔭」，卻沒有一條遮蔭指標', status: '未公開', agency: '公園處、都發局', when: '100 天' },
    { field: '體感降溫 2℃ 的量測方法、測點、基準值', why: '沒有方法就無法驗證目標是否達成', status: '未公開', agency: '都發局、環保局', when: '中期' },
    { field: '綠覆降溫階段性目標全文（2023-12 市政會議裁示）', why: '裁示近三年，官方文件仍寫「由公園處訂定」', status: '未公開', agency: '公園處', when: '100 天' },
  ],

  async page(ctx) {
    const e = ctx.esc;
    const list = await load(ctx);
    const by = Object.fromEntries(list.map((k) => [k.id, k]));
    const now = Date.now();
    const withNum = list.filter((k) => k.target_value != null && k.deadline && /^\d{4}/.test(k.deadline) && !EXCLUDED.includes(k.id)).length;
    const groups = GROUPS.map((g) => `<h3 class="h3">${e(g.title)}</h3>${g.ids.filter((id) => by[id]).map((id) => {
      const kids = (g.children?.[id] || []).filter((c) => by[c]);
      return card(ctx, by[id], now) + (kids.length ? `<div class="privacy" style="margin:6px 0 0 10px">拆三塊（合計 40,104・假說）</div>${kids.map((c) => card(ctx, by[c], now, true)).join('')}` : '');
    }).join('')}`).join('');
    const gap = NOSHADE.filter((id) => by[id]).map((id) => {
      const k = by[id];
      const why = { 'KPI-06': '無期限、無基準、無量法', 'KPI-07': '2023-12 裁示，至 2026-08 未訂', 'KPI-12': '只列工作項目，無數字', 'KPI-13': '只有綠化面積，無樹冠指標', 'KPI-11': '碳匯無數字' }[id] || '';
      return `<li><b>${e(topic(k))}</b>：${e(why)} <a href="${e(k.url)}" target="_blank" rel="noopener">原件</a>（${e(k.published)}）</li>`;
    }).join('');
    const ex = EXCLUDED.filter((id) => by[id]).map((id) => `<li>${e(by[id].statement_zh)}（<a href="${e(by[id].url)}" target="_blank" rel="noopener">${e(by[id].publisher)}</a>，${e(by[id].published)}）・原件未見</li>`).join('');
    return `${STYLE}<div class="f-cm">
      <div class="facts">
        <div class="fact"><b>${withNum}</b><span>條有數字有期限</span></div>
        <div class="fact"><b>0</b><span>條樹冠／遮蔭目標</span></div>
        <div class="fact"><b>0</b><span>條逐年進度</span></div>
      </div>
      <article class="cm-card cm-gap">
        <h3>無樹冠／遮蔭數字目標</h3>
        <p class="cm-lead" style="font-size:14px">市長 2026-08-28：轉向「密植、高遮蔭」，指標仍是株數</p>
        <ul>${gap}</ul>
      </article>
      ${groups}
      <h3 class="h3">本隊 100 天 KPI（非市府承諾）</h3>
      <div class="cm-card">
        <p class="privacy"><label><input type="checkbox" data-cm-sim> 看模擬進度</label></p>
        <div class="cm-tablewrap"><table class="track"><thead><tr><th>指標</th><th>目標</th><th>現況</th></tr></thead><tbody>
          ${PROPOSED.map((p, i) => `<tr><td>${e(p.k)}</td><td>${e(p.target)}</td><td data-cm-cell="${i}">尚未開始</td></tr>`).join('')}
        </tbody></table></div>
      </div>
      ${ex ? `<details><summary>未列入</summary><ul class="privacy">${ex}</ul></details>` : ''}
      <p class="privacy">來源：官方原件（2026-10-23 核對）</p>
    </div>`;
  },
  bindPage(root, ctx) {
    const box = root.querySelector('[data-cm-sim]'); if (!box) return;
    box.addEventListener('change', () => {
      root.querySelectorAll('[data-cm-cell]').forEach((td) => {
        const p = PROPOSED[+td.dataset.cmCell];
        td.innerHTML = box.checked ? `${ctx.esc(p.sim)} ${ctx.badge('sim')}<br>${ctx.bar(Math.max(0.02, p.simPct), 1, 'var(--sim)')}` : '尚未開始';
      });
    });
  },
};
