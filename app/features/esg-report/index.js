// 永續報告書素材：每家虛構企業一份 Excel、PDF 與三格報告書段落草稿。
// 依據 research/22c：只能寫成自願正向行動（GRI 101-2-a-v、TNFD A24、氣候調適質性敘述／GRI 413），
// 不能寫成公司減排或碳信用；不提供碳吸存數字。
import { ADOPTIONS, staleDays } from '../../js/sim.js';

const R100 = (agencies, data, budget, promo) => ({ agencies, data, budget, promo });
const REMINDER = '自願保育行動，不能算減排，也不是碳權。';
const FILES = {
  c1: 'c1-yesi-solar-esg-pack',
  c2: 'c2-green-corridor-life-esg-pack',
  c3: 'c3-under-tree-books-esg-pack',
};
const DAY = 86400000;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const STYLE = `<style>
.f-esgr .co-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}
.f-esgr .co-tabs button{display:flex;gap:6px;align-items:center;padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;font:inherit;font-size:13px}
.f-esgr .co-tabs button.on{background:var(--forest);border-color:var(--forest);color:#fff}
.f-esgr .co-tabs img{width:22px;height:22px;border-radius:6px}
.f-esgr .reminder{padding:10px 12px;border-radius:12px;background:var(--warn-bg);border:1px solid var(--warn);font-weight:700;font-size:14px;margin:10px 0}
.f-esgr .draft{border:1px solid var(--line);border-radius:12px;padding:12px;margin:10px 0;background:#fff}
.f-esgr .draft header{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px}
.f-esgr .draft header b{font-size:14px}
.f-esgr .draft .tag{font-size:12px;color:var(--est);background:var(--est-bg);padding:2px 8px;border-radius:999px;white-space:nowrap}
.f-esgr .draft p{font-size:14px;line-height:1.75;margin:6px 0}
.f-esgr .draft .fill{background:#fff3c4;padding:0 3px;border-radius:3px}
.f-esgr .draft small{display:block;color:var(--ink-3);font-size:12px;line-height:1.5}
.f-esgr .tblwrap{overflow-x:auto;max-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:10px}
.f-esgr table{width:100%;border-collapse:collapse;font-size:12.5px}
.f-esgr th,.f-esgr td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
.f-esgr th{position:sticky;top:0;background:var(--paper)}
</style>`;

// 每棵認養樹的「可稽核原始紀錄」：樹籍欄位是真實的；照片日期優先用本站真實上傳，沒有才用模擬天數
function rows(ctx, co, ev) {
  const live = new Map();
  for (const e of ev) {
    if (e.role !== 'citizen' || !e.photo) continue;
    const x = live.get(e.treeId) || { n: 0, last: null };
    x.n++; if (!x.last || e.at > x.last) x.last = e.at;
    live.set(e.treeId, x);
  }
  const now = Date.now();
  return ctx.trees.filter((t) => ctx.adoptionFor(t)?.company.id === co.id).map((t) => {
    const a = ctx.adoptionFor(t), l = live.get(t.id), d = staleDays(t.id);
    const last = l ? ymd(new Date(l.last)) : d >= 0 ? ymd(new Date(now - d * DAY)) : '';
    return {
      t, a, n: l ? l.n : 0, last, src: l ? '本站上傳' : d >= 0 ? '模擬' : '從未有人拍',
      status: t.survey ? `樹籍在冊（調查 ${t.survey.slice(0, 7)}）` : '樹籍在冊（調查日期空白）',
    };
  });
}

function drafts(ctx, co, list) {
  const e = ctx.esc, ads = ADOPTIONS.filter((a) => a.company === co.id);
  const since = ads.map((a) => a.since).sort()[0] || '—';
  const where = ads.map((a) => (a.type === 'zone' ? a.label : '單棵認養行道樹')).join('、');
  const dists = [...new Set(list.map((r) => r.t.dist))].join('、');
  const withPhoto = list.filter((r) => r.last).length;
  const pct = list.length ? Math.round((withPhoto / list.length) * 100) : 0;
  const fill = (s) => `<span class="fill">${s}</span>`;
  return [
    { tag: 'GRI 101-2-a-v 額外保育行動', title: '生物多樣性：額外保育行動',
      text: `本公司自 ${e(since)} 起與臺北市政府公園處合作，自願認養${e(where)}共 ${list.length.toLocaleString()} 株樹木，負擔養護經費。此為與第三方合作的額外保育行動，不用來管理本公司營運造成的生物多樣性衝擊。每株樹都有市府樹籍編號，養護與市民照片紀錄公開於「樹」位孿生平台，可逐株稽核（附件：認養樹清單）。`,
      note: 'GRI 101 自 2026-01-01 生效' },
    { tag: 'TNFD 額外指標 A24', title: '自願保育與復育',
      text: `A24.1：認養範圍 ${list.length.toLocaleString()} 株（位於${e(dists || '—')}），期間 ${e(since)} 起，監測頻率由市民照片提供：目前 ${pct}% 的認養樹有照片紀錄。A24.2：額外保育行動投入金額 ${fill('〔請填認養金額〕')} 元。`,
      note: 'TNFD 額外指標，非強制' },
    { tag: '氣候調適（質性）／GRI 413', title: '氣候調適與社區投資',
      text: `認養樹位於${e(dists || '—')}的人行道與公園，替行人提供遮蔭、緩和都市熱島，屬「其他氣候行動」中的調適質性敘述，不換算成本公司的減量數字。社區參與：本年度舉辦 ${fill('〔場次〕')} 場市民巡樹與拍照活動，市民上傳 ${list.reduce((s, r) => s + r.n, 0).toLocaleString()} 張照片（平台紀錄）。`,
      note: '413-1 限據點周邊，否則用 201-1' },
  ];
}

async function render(root, ctx) {
  const e = ctx.esc;
  const id = ctx.S.fq?.get('c') || ctx.S.esgCo || ctx.COMPANIES[0].id;
  const co = ctx.COMPANIES.find((c) => c.id === id) || ctx.COMPANIES[0];
  ctx.S.esgCo = co.id;
  const ev = await ctx.getAllEvents().catch(() => []);
  const list = rows(ctx, co, ev);
  root.innerHTML = `${STYLE}<div class="f-esgr">
    <div class="co-tabs">${ctx.COMPANIES.map((c) => `<button data-co="${c.id}" class="${c.id === co.id ? 'on' : ''}"><img src="${c.logo}" alt="">${e(c.name)}</button>`).join('')}</div>
    <p class="reminder">${REMINDER}</p>
    <div class="facts">
      <div class="fact"><b>${list.length.toLocaleString()}</b><span>認養株數 ${ctx.badge('sim')}</span></div>
      <div class="fact"><b>${list.length ? Math.round((list.filter((r) => r.last).length / list.length) * 100) : 0}%</b><span>有照片紀錄 ${ctx.badge('sim')}</span></div>
      <div class="fact"><b>${list.reduce((s, r) => s + r.n, 0)}</b><span>本站市民照片 ${ctx.badge('live')}</span></div>
    </div>
    <h3 class="h3">報告書草稿・黃底自填</h3>
    ${drafts(ctx, co, list).map((d, i) => `<section class="draft"><header><b>${e(d.title)}</b><span class="tag">可對應：${e(d.tag)}</span></header><p data-text="${i}">${d.text}</p><small>${e(d.note)}</small><div class="actions"><button class="btn mini" data-copy="${i}">複製</button></div></section>`).join('')}
    <h3 class="h3">下載報告素材</h3>
    <div class="actions"><a class="btn primary" download href="/downloads/esg/${FILES[co.id]}.xlsx">下載 Excel</a><a class="btn" download href="/downloads/esg/${FILES[co.id]}.pdf">下載 PDF</a><a class="btn" href="#/f/adopt-proposal">認養效益試算 ›</a></div>
    <h3 class="h3">認養樹清單</h3>
    <div class="tblwrap"><table><thead><tr><th>樹籍編號</th><th>樹種</th><th>胸徑</th><th>最近照片</th><th>照片數</th><th>狀態</th></tr></thead><tbody>
      ${list.slice(0, 60).map((r) => `<tr><td><a href="#/tree/${e(r.t.id)}">${e(r.t.id)}</a></td><td>${e(r.t.species)}</td><td>${r.t.dbh ?? '—'}</td><td>${r.last ? `${e(r.last)}${r.src === '模擬' ? ' ' + ctx.badge('sim') : r.src === '本站上傳' ? ' ' + ctx.badge('live') : ''}` : '從未'}</td><td>${r.n}</td><td>${e(r.status)}</td></tr>`).join('')}
    </tbody></table></div>
    ${list.length > 60 ? `<p class="privacy">前 60 筆・全部見 Excel</p>` : ''}
    <p class="privacy">真實樹籍・其他模擬</p>
  </div>`;
  root.querySelectorAll('[data-co]').forEach((b) => b.addEventListener('click', () => { ctx.S.esgCo = b.dataset.co; ctx.S.fq = null; render(root, ctx); }));
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const txt = root.querySelector(`[data-text="${b.dataset.copy}"]`).textContent;
    try { await navigator.clipboard.writeText(txt); ctx.showToast('已複製段落'); } catch { ctx.showToast('瀏覽器不允許複製，請手動選取'); }
  }));
}

export default {
  id: 'esg-report',
  title: '永續報告書素材',
  oneLiner: '認養樹清單與報告書草稿',
  audience: ['esg', 'public'],
  dataStatus: ['real', 'sim', 'live'],
  maturity: 'stable',
  ready: true,
  nav: ['esgreport'],
  demoValue: '企業出錢的理由是「永續報告書有東西可寫、而且可稽核」：每棵樹有樹籍編號、市民照片當監測紀錄',
  problem: '企業想認養，但不知道能寫進永續報告書的哪一項，也拿不出可稽核的逐株紀錄；寫錯成減排又有漂綠風險。',
  howto: '選企業後下載 Excel 或 PDF，也可複製報告書段落。',
  limits: '企業與認養範圍虛構；照片日期部分模擬；揭露項目對應是依準則原文的建議，不是確信意見；不提供碳吸存量。',
  rollout: R100('公園處（認養契約附平台紀錄）、研考會（認養成果彙整）', '認養範圍對樹籍編號、認養金額、養護紀錄', '含在平台內，不另計', '企業永續報告書、認養說明會'),
  sources: [
    { label: 'GRI 101: Biodiversity 2024（101-2-a-v，2026-01-01 生效）', url: 'https://www.globalreporting.org/pdf.ashx?id=24534', date: '2024' },
    { label: 'TNFD 建議揭露與額外指標（A24 自願保育與復育）', url: 'https://tnfd.global/wp-content/uploads/2023/08/Recommendations_of_the_Taskforce_on_Nature-related_Financial_Disclosures_September_2023.pdf', date: '2023-09' },
  ],
  async page() { return '<p class="privacy">載入中…</p>'; },
  bindPage(root, ctx) { render(root, ctx); },
};
