// 存量帳／樹冠帳：期初＋新植－死亡－移除＝期末。官方有的數字附來源與日期，沒有的格子寫「市府未公開」。
// 不同口徑的數字不相減，並排寫口徑差異。數字依 research/18c-kpi-factcheck.md、research/03、board-factcheck.json（2026-10-23 核對）。
import * as M from '../canopy-debt/model.js';

const R100 = (agencies, data, budget, promo) => ({ agencies, data, budget, promo });
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('zh-TW', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');

// 來源
const S = {
  pkl0712: { t: '公園處新聞稿〈網路砍樹謠言扭曲事實 市府展開蒐證〉', d: '2026-07-12', u: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&s=B9708CAABE7AAC15&sms=72544237BBE4C5F6', lv: '官方' },
  ltn0713: { t: '自由時報〈洪婉臻批北市行道樹「砍多種少」〉（議員引述市府資料）', d: '2026-07-13', u: 'https://news.ltn.com.tw/news/Taipei/breakingnews/5503570', lv: '媒體轉述' },
  pwd2024: { t: '工務局統計室《減緩臺北市熱島效應—樹木儲碳潛力知多少》表 4', d: '2024-08', u: 'https://www-ws.gov.taipei/Download.ashx?icon=.pdf&n=6ZmE5Lu2Ml%2FmuJvnt6noh7rljJfluILnhrHls7bmlYjmh4nigJTmqLnmnKjlhLLnorPmvZvlipvnn6XlpJrlsJEucGRm&u=LzAwMS9VcGxvYWQvMzQ0L3JlbGZpbGUvNDQzMzMvOTI1NTQzMi81MDk5MWYxZC0wOWMzLTRiZDgtODQ4MS0yMTU0MjAxMWY0OTcucGRm', lv: '官方' },
  mayor07: { t: '市長施政報告（書面，115 年 7 月）', d: '2026-07', u: 'https://www.gov.taipei/News_Content.aspx?n=D07E52F0FF169E83&sms=4F76BD4E1FD15647&s=2801FEBFC089D317', lv: '官方' },
  ltn0827: { t: '自由時報（公園處改版計畫報導，稱截至 2026-06 底管理 181,049 棵）', d: '2026-08-27', u: 'https://news.ltn.com.tw/news/life/breakingnews/5553609', lv: '媒體轉述' },
  mirror: { t: '鏡週刊專欄（轉述市府性平成果報告，原件未取得）', d: '2026-07-23', u: 'https://www.mirrormedia.mg/external/dailycolumn_74602', lv: '媒體轉述' },
  od: { t: '臺北市行道樹及公園樹木分布圖（開放資料）', d: '2026-10-13 下載', u: 'https://data.gov.tw/dataset/128274', lv: '官方開放資料' },
  cna: { t: '中央社〈學者計算2年來北市樹冠面積減少　蔣萬安：增1.3萬棵樹〉', d: '2026-09-27', u: 'https://www.cna.com.tw/news/aloc/202609270166.aspx', lv: '媒體轉述研究' },
  pkl0926: { t: '公園處新聞稿（回應樹冠減少）', d: '2026-09-26', u: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&sms=72544237BBE4C5F6&s=8DCD753F29154262', lv: '官方' },
  pkl1003: { t: '公園處新聞稿〈臺北持續增綠 市府植樹增蔭降溫〉', d: '2026-10-03', u: 'https://www.gov.taipei/News_Content.aspx?n=F0DDAF49B89E9413&s=B1649759E218DB6B', lv: '官方' },
  meeting: { t: '第 2275 次市政會議紀錄（市長裁示訂綠覆降溫階段性目標）', d: '2023-12-21', u: 'https://www.gov.taipei/News_Content.aspx?n=D6946078AE437FF0&s=492A32D416258AF7&sms=14AEF9A8536E3B5E', lv: '官方' },
};

const STYLE = `<style>
.f-cl .cl-lead{font-size:15px;line-height:1.6;margin:8px 0}
.f-cl .cl-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:14px 0}
.f-cl .cl-card h3{font-size:17px;margin:0 0 4px}
.f-cl .cl-eq{display:grid;grid-template-columns:28px 1fr;gap:0;margin-top:8px}
.f-cl .cl-op{font-size:20px;font-weight:700;color:var(--ink-3);text-align:center;padding-top:8px}
.f-cl .cl-row{border-bottom:1px solid var(--line);padding:8px 0}
.f-cl .cl-row:last-child{border-bottom:0}
.f-cl .cl-row .k{font-size:13px;color:var(--ink-3)}
.f-cl .cl-row .v{font-size:15px;line-height:1.55}
.f-cl .cl-row .v b{font-family:"Noto Serif TC",serif;font-size:20px;color:var(--forest)}
.f-cl .cl-na{display:inline-block;font-size:13px;font-weight:600;color:var(--danger);border:1.5px dashed var(--danger);border-radius:8px;padding:1px 8px;margin-right:6px}
.f-cl .cl-src{font-size:12px;color:var(--ink-3)}
.f-cl .cl-src a{color:inherit;text-decoration:underline}
.f-cl .cl-note{font-size:13px;color:var(--ink-2);margin:4px 0 0}
.f-cl .cl-note b,.f-cl .cl-ask b{font-family:inherit;font-size:inherit;color:var(--ink)}
.f-cl .cl-total{background:var(--paper);border-radius:10px;padding:8px 10px}
.f-cl .cl-tablewrap{overflow-x:auto}
.f-cl table.track td b{font-variant-numeric:tabular-nums}
.f-cl ul.cl-ask{margin:6px 0;padding-left:18px;font-size:14px;line-height:1.7}
.f-cl .cl-lv{display:inline-block;font-size:11px;border-radius:999px;padding:0 6px;border:1px solid var(--line);color:var(--ink-2);white-space:nowrap}
</style>`;

const NA = '<span class="cl-na">市府未公開</span>';
const src = (e, k) => { const s = S[k]; return `<span class="cl-src">〔<a href="${e(s.u)}" target="_blank" rel="noopener" title="${e(s.t)}">${e(s.d)}</a> <span class="cl-lv">${e(s.lv)}</span>〕</span>`; };

function row(op, k, v) { return `<div class="cl-op" aria-hidden="true">${op}</div><div class="cl-row"><div class="k">${k}</div><div class="v">${v}</div></div>`; }

const OPEN_FIELDS = [
    { field: '年度存量帳：期初、期末株數（分區、分行道樹／公園樹）', why: '沒有期初期末，就算不出全市樹是變多還是變少', status: '未公開', agency: '公園處', when: '100 天' },
    { field: '年度移植移入／移出株數', why: '移植樹不是移除也不是新植，沒有這兩格帳就對不平', status: '未公開', agency: '公園處', when: '100 天' },
    { field: '死亡未移除株數、天災倒伏株數（與移除分開記）', why: '避免同一棵樹在「死亡」和「移除」被扣兩次', status: '未公開', agency: '公園處', when: '100 天' },
    { field: '新植株數分機關、分地點類型（人行道、公園、山區、建築基地）', why: '13,225、42,250 都混了不同機關與山區，無法放進同一本帳', status: '未公開', agency: '公園處、大地處、都發局', when: '100 天' },
    { field: '移除原因年度統計原表（2,691 的四個分項）', why: '目前只見於議員引述，市府原稿只公布合併類別', status: '未公開', agency: '公園處', when: '100 天' },
    { field: '年度樹冠覆蓋率（影像年份、方法、分區）', why: '株數不等於綠蔭；官方沒有逐年樹冠指標', status: '未公開', agency: '公園處、都發局', when: '中期' },
];

let canopyCache = null;
function siteCanopy(ctx) {
  if (canopyCache && canopyCache.n === ctx.trees.length) return canopyCache;
  let A = 0, ok = 0, bad = 0;
  for (const t of ctx.trees) {
    if (!M.dbhValid(t.dbh)) { bad++; continue; }
    A += M.areaOf(M.crownW(t.species, t.dbh)); ok++;
  }
  canopyCache = { n: ctx.trees.length, A, ok, bad };
  return canopyCache;
}

export default {
  id: 'canopy-ledger',
  title: '存量帳／樹冠帳',
  oneLiner: '樹木帳哪幾格沒公開',
  audience: ['mayor', 'gov', 'public'],
  dataStatus: ['real', 'est'],
  maturity: 'stable',
  ready: true,
  demoValue: '一張帳表就看得出來：3,164 有官方數字，但期初、期末、移植三格市府都沒公開，所以「全市樹變多還是變少」現在沒人答得出來',
  problem: '「移除 3,164」「兩年種 1.3 萬」「四年種 42,250」「樹冠少 13 公頃」各說各話：期間、機關、範圍、單位都不同，卻常被拿來互相加減。',
  howto: '打開獨立頁，第一張是 2025 年的株數帳（官方數字附來源，缺的格子寫「市府未公開」），第二張把不同口徑的存量數字並排，第三張是樹冠面積帳，最後列出要補齊這本帳需要市府公開的欄位。',
  limits: '只收已核對原件的官方數字與標明「媒體轉述」的數字；2,691 的四個分項只見於議員引述（原表沒找到）；審計部列管 2,989 株找不到原件，不採用。本站樹冠加總是用胸徑推估、沒有扣掉樹冠重疊，只是快照，不能和研究團隊的衛星估計相減。',
  rollout: R100('公園處（主責年度存量帳）、大地處與都發局（新植分機關）、研考會（列管與公開）', '年度存量帳（分區、分行道／公園：期初、新植、移入、移出、移除依原因、期末）、逐樹異動清冊、年度樹冠覆蓋（方法公開）', '情境試算：帳表格式與公開不需新系統，含在平台試辦 100–200 萬內；樹冠覆蓋可沿用既有航照', '每年固定日期公布一次，議會與媒體引用同一本帳；配合公園處 2026 年底資訊網改版'),
  sources: [
    { label: S.pkl0712.t, url: S.pkl0712.u, date: S.pkl0712.d },
    { label: S.ltn0713.t, url: S.ltn0713.u, date: S.ltn0713.d },
    { label: S.pwd2024.t, url: S.pwd2024.u, date: S.pwd2024.d },
    { label: S.mayor07.t, url: S.mayor07.u, date: S.mayor07.d },
    { label: S.cna.t, url: S.cna.u, date: S.cna.d },
    { label: S.pkl1003.t, url: S.pkl1003.u, date: S.pkl1003.d },
    { label: S.od.t, url: S.od.u, date: S.od.d },
  ],
  openFields: OPEN_FIELDS,

  async page(ctx) {
    const e = ctx.esc;
    let est = '';
    try {
      await M.loadParams(ctx);
      const c = siteCanopy(ctx);
      est = `<b>${fmt(c.A / 10000)}</b> 公頃 ${ctx.badge('est')}<p class="cl-note">${fmt(c.ok)} 棵加總・${fmt(c.bad)} 棵未計・未扣重疊</p>`;
    } catch (err) { est = '<span class="privacy">載入失敗</span>'; }
    const nOd = ctx.trees.length;

    const stock = [
      ['行道樹 92,447；公園喬木 112,491', '工務局統計', '2023 年底', 'pwd2024'],
      ['行道樹 93,877；公園樹 88,540', '轉述市府報告', '2025-06-30', 'mirror'],
      ['市區道路行道樹 92,196', '市區道路', '2026-07', 'mayor07'],
      ['市府管理樹木 181,049', '公園處全部（轉述）', '2026-06 底', 'ltn0827'],
      [`行道樹 90,441＋公園樹 72,011＝${fmt(162452)}`, '開放資料樹籍', '2026-10-13 下載', 'od'],
    ];

    return `${STYLE}<div class="f-cl">
      <p class="cl-lead"><b>期初＋新植－死亡－移除＝期末</b></p>
      <p class="privacy">${ctx.badge('real')} 2026-10-23 核對・口徑不同不相減</p>

      <div class="cl-card">
        <h3>2025 株數帳</h3>
        <div class="cl-eq">
          ${row('', '期初', `${NA}<p class="cl-note">參考：2023 底 行道樹 92,447・公園喬木 112,491</p>`)}
          ${row('＋', '新植／補植', `<b>778</b> 棵（公園處補植行道樹）${src(e, 'ltn0713')}<p class="cl-note">另：114–115 三機關 13,225 ${src(e, 'pkl0712')}（兩年、含山區，不可併）</p>`)}
          ${row('＋', '移植移入', NA)}
          ${row('－', '移植移出', NA)}
          ${row('－', '死亡未移除', NA)}
          ${row('－', '移除（含天災）', `<b>3,164</b> 株 ${src(e, 'pkl0712')}
            <p class="cl-note">市府：自然原因 2,630・其他不到兩成</p>
            <p class="cl-note">議員引述：人工 2,691＋天災 473 ${src(e, 'ltn0713')}；分項 996／639／522／534（<b>市府原表未見</b>）</p>
            <p class="cl-note">2024 人工移除 1,425 ${src(e, 'ltn0713')}；同口徑 +89%（非 +122%）</p>`)}
          ${row('＝', '期末', NA)}
        </div>
        <div class="cl-total"><p class="cl-note"><b>淨變化：算不出</b>・3,164－778＝2,386 非淨減</p></div>
      </div>

      <div class="cl-card">
        <h3>存量快照（口徑不同）</h3>
        <p class="cl-note">差額<b>≠</b>砍或種的棵數</p>
        <div class="cl-tablewrap"><table class="track"><thead><tr><th>數字</th><th>口徑</th><th>時點</th></tr></thead><tbody>
          ${stock.map(([n, k, d, s]) => `<tr><td><b>${e(n)}</b><br>${src(e, s)}</td><td>${e(k)}</td><td>${e(d)}</td></tr>`).join('')}
          <tr><td><b>${fmt(nOd)}</b><br><span class="cl-src">〔本站〕</span></td><td>本站樹籍</td><td>即時</td></tr>
        </tbody></table></div>
        <p class="cl-note">例：92,196－90,441＝1,755 非減少（原因未查明）</p>
      </div>

      <div class="cl-card">
        <h3>樹冠帳（公頃）</h3>
        <div class="cl-eq">
          ${row('', '官方樹冠覆蓋', `${NA}<p class="cl-note">2023-12 裁示訂目標 ${src(e, 'meeting')}；至 2026-08 無數字</p>`)}
          ${row('', '研究衛星估計', `<b>628 → 615</b> 公頃（兩年 −13）${src(e, 'cna')}<p class="cl-note">中研院沈聖峰團隊（原件未見）；公園處：含台大校地、交流道、私人開發 ${src(e, 'pkl0926')}</p>`)}
          ${row('', '市長說法', `兩年 +<b>1.3 萬</b>多棵 ${src(e, 'cna')}<p class="cl-note">棵≠公頃，不可互減</p>`)}
          ${row('', '本站推估（快照）', est)}
          ${row('＝', '期末樹冠', `${NA}<p class="cl-note">需逐樹異動</p>`)}
        </div>
      </div>

      <div class="cl-card">
        <h3>待公開欄位</h3>
        <ul class="cl-ask">
          ${OPEN_FIELDS.map((f) => `<li><b>${e(f.field)}</b>（${e(f.agency)}）</li>`).join('')}
          <li><b>逐樹異動清冊</b></li>
        </ul>
        <p class="privacy"><a href="#/f/open-fields">看完整清單</a>・<a href="#/f/commitments">看承諾追蹤</a></p>
      </div>
    </div>`;
  },
};
