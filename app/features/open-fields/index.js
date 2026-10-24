// 公開欄位清單：把網站裡所有「缺資料／市府未公開」的地方匯成一張表，可匯出 CSV，直接當 100 天落地的資料需求。
// 兩個來源：(1) 下面 CURATED（依 research/08-datasets.md、research/13 第五節、research/16、research/18、README「資料」一節整理）；
// (2) 任何功能 manifest 裡選填的 openFields 陣列（{ field, why, status, agency, when, note? }），開頁時自動併入、依欄位名稱去重。

const R100 = (agencies, data, budget, promo) => ({ agencies, data, budget, promo });
const fmt = (v) => (Number.isFinite(v) ? v.toLocaleString('zh-TW') : '—');

const STATUS = {
  未公開: { tone: 'var(--danger)', hint: '未公開或僅彙總' },
  非開放格式: { tone: 'var(--warn)', hint: '僅網頁／PDF' },
  部分公開: { tone: 'var(--ok)', hint: '缺關鍵欄位' },
  開放但定義不清: { tone: 'var(--est)', hint: '定義／單位不清' },
  待查: { tone: 'var(--ink-3)', hint: '本隊未查到' },
};

const CURATED = (q) => [
  { field: '逐樹異動清冊（樹籍編號、日期、異動類別：新植／移植／移除／天災、原因、核准文號）', why: '每一筆移除與補種都能對到哪一棵樹；存量帳、公開紀錄、承諾進度都靠它', features: ['records', 'canopy-ledger', 'canopy-debt', 'mayor-dash', 'commitments'], status: '未公開', agency: '公園處', when: '100 天', note: '行道樹路燈資訊網有移樹履歷查詢網頁，未確認可下載；公園處 2026-09-14 稱改版前先在官網公告 115 年度異動資料' },
  { field: '移除前的診斷紀錄（健康評估、腐朽率、診斷者、診斷日期）', why: '市民看得到「為什麼要移除」，不用等議員質詢', features: ['records', 'review', 'cases'], status: '非開放格式', agency: '公園處', when: '100 天', note: '個案 PDF 散在公園處「樹木移除計畫審查專區」' },
  { field: '移植紀錄（原位置、移植地點、移植日、存活追蹤）', why: '核定移植卻被移除（東門茄苳）要能被追到；存量帳需要移入／移出', features: ['vendor-check', 'cases', 'canopy-ledger'], status: '部分公開', agency: '公園處', when: '100 天', note: '樹木異動專區有部分 2026 年移植資料；移植計畫審查為 PDF' },
  { field: '核准文號與樹籍編號的對照', why: '施工現場掃樹牌就知道這棵核定保留、移植還是可移除', features: ['vendor-check', 'canopy-debt', 'conflict-alert'], status: '未公開', agency: '公園處、各工程主辦機關', when: '100 天' },
  { field: '工程設計階段的範圍圖（範圍、主辦機關、廠商、監造、工期）', why: '在設計階段就看到會碰到幾棵大樹，最早、最便宜的保樹時機', features: ['conflict-alert', 'vendor-record'], status: '部分公開', agency: '工務局、各工程主辦機關', when: '100 天', note: '「今日施工」「明日施工預約」有施工範圍，但只到已核准施工的階段' },
  { field: '預定施工路段清單（可下載格式）', why: '提前半年知道哪些路段要動工', features: ['conflict-alert'], status: '非開放格式', agency: '工務局（道路挖掘管理中心）', when: '100 天', note: 'dig.taipei 有「預定施工路段」網頁，沒有下載或 API' },
  { field: '受保護樹木名錄（含座標）', why: '工程範圍碰到受保護樹木要直接警示', features: ['conflict-alert', 'review'], status: '待查', agency: '文化局', when: '100 天', note: '本隊查不到開放資料' },
  { field: '列管危木清單（列管日、處理期限、實際處理日）', why: '首長要看的是「逾期未處理」有幾棵', features: ['mayor-dash', 'review'], status: '未公開', agency: '公園處', when: '100 天' },
  { field: '樹籍胸徑的缺值標記與單位', why: '胸徑是推估樹冠的唯一依據，0 分不出是沒量、小苗還是缺值', features: ['canopy-debt', 'canopy-ledger', 'review'], status: '開放但定義不清', agency: '公園處', when: '100 天', note: `目前 ${fmt(q.dbh0)} 棵胸徑為 0、${fmt(q.dbhBig)} 棵超過 3 公尺（本站載入資料實算）；資料集沒寫單位，推定為公分` },
  { field: '調查日期與最近一次巡查日（含異常日期修正）', why: '知道哪棵樹多久沒人看過，排複查順序', features: ['review', 'stale-points', 'gov-dash'], status: '開放但定義不清', agency: '公園處', when: '100 天', note: `目前 ${fmt(q.noSurvey)} 棵調查日期空白或異常、${fmt(q.old)} 棵在 2016 年以前（本站實算）` },
  { field: '人行道寬度欄位定義（是否為淨寬）', why: '公園處原則：人行道不到 2 公尺不補種，寬度定義錯就會推薦錯', features: ['planting', 'planter'], status: '開放但定義不清', agency: '新工處', when: '100 天' },
  { field: '樹穴空置狀態（有樹、空穴、已封穴）', why: '推薦種樹點現在只能用樹點和樹穴比對推測', features: ['planting'], status: '未公開', agency: '新工處、公園處', when: '中期' },
  { field: '樹穴位置的地下管線與可用土體', why: '表面有洞不代表根有地方長', features: ['planting'], status: '部分公開', agency: '工務局、各管線單位', when: '中期', note: '公共管線圖資有數十份 XML 開放資料，本隊未比對' },
  { field: '修剪與養護紀錄（日期、方式、修剪比例）', why: '單棵樹的「前世今生」與樹冠變化要看得到', features: ['records', 'mine'], status: '未公開', agency: '公園處', when: '中期' },
  { field: '廠商履約紀錄（誤砍、違規、裁罰、補植存活）', why: '異常累積在契約與廠商上，才能納入下次評選', features: ['vendor-record'], status: '未公開', agency: '公園處、工務局', when: '中期', note: '目前只有個案新聞稿（例：東門案裁罰及求償）' },
  { field: '1999 樹木陳情分類（位置、類別、處理結果）', why: '知道哪裡的樹被市民在乎、快要吵起來', features: ['opinion-hotspot'], status: '待查', agency: '研考會（1999 市民當家熱線）', when: '中期' },
  { field: '校園樹木單株座標', why: '學校是一大片遮蔭資源，但不在市府樹籍', features: ['campus', 'jurisdiction'], status: '部分公開', agency: '教育局', when: '中期', note: '教育部校園樹木資訊平臺只有每校樹種統計' },
  { field: '樹木權責歸屬（公園處、新工處、教育局、私有地）', why: '民眾回報能自動分派給對的單位', features: ['jurisdiction'], status: '未公開', agency: '公園處、新工處、地政局', when: '中期' },
  { field: '人行道層級的行人流量', why: '「人多沒樹蔭」現在只能用捷運進出站當代理', features: ['shade-flow', 'shade-equity'], status: '未公開', agency: '交通局', when: '中期' },
  { field: '分里經濟弱勢資料', why: '樹蔭公平要對照最需要的人，不只是兒童與長者', features: ['shade-equity'], status: '待查', agency: '社會局', when: '中期' },
];

const STYLE = `<style>
.f-of .of-lead{font-size:15px;line-height:1.6;margin:8px 0}
.f-of .of-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}
.f-of select{font:inherit;font-size:14px;padding:4px 6px;border-radius:8px;border:1px solid var(--line);background:var(--card);max-width:100%}
.f-of .of-list{list-style:none;padding:0;margin:0}
.f-of .of-item{border-bottom:1px solid var(--line);padding:10px 0}
.f-of .of-item h4{font-size:15px;margin:0 0 3px;line-height:1.45}
.f-of .of-why{font-size:13px;color:var(--ink-2);margin:0}
.f-of .of-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;font-size:12px}
.f-of .of-chip{border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--ink-2);background:var(--card)}
.f-of .of-st{font-weight:600;border-width:1.5px}
.f-of .of-feat{font-size:12px;color:var(--ink-3);margin-top:4px}
.f-of .of-feat a{color:var(--leaf)}
.f-of .of-note{font-size:12px;color:var(--ink-3);margin-top:3px}
.f-of .of-agency{list-style:none;padding:0;margin:6px 0}
.f-of .of-agency li{display:grid;grid-template-columns:minmax(0,1fr) 90px 26px;gap:8px;align-items:center;font-size:13px;padding:3px 0}
.f-of .of-agency button{all:unset;cursor:pointer;color:var(--ink)}
.f-of .of-agency button:hover{text-decoration:underline}
.f-of .of-legend{font-size:12px;color:var(--ink-3);display:grid;gap:2px;margin:6px 0}
</style>`;

const splitAg = (s) => String(s).replace(/（.*?）/g, '').split('、').map((x) => x.trim()).filter(Boolean);

async function collect(ctx) {
  let FEATURES = [];
  try { ({ FEATURES } = await import('../index.js')); } catch (e) { console.warn('open-fields: 讀不到功能登錄表', e); }
  const title = new Map(FEATURES.map((f) => [f.id, f.title]));
  const T = ctx.trees || [];
  const q = {
    dbh0: T.filter((t) => t.dbh === 0).length,
    dbhBig: T.filter((t) => t.dbh > 300).length,
    noSurvey: T.filter((t) => !t.survey).length,
    old: T.filter((t) => t.survey && +t.survey.slice(0, 4) <= 2016).length,
  };
  const rows = new Map();
  const add = (r, fid) => {
    const key = r.field.trim();
    const cur = rows.get(key);
    if (cur) { for (const f of r.features || [fid]) if (f && !cur.features.includes(f)) cur.features.push(f); return; }
    rows.set(key, { field: key, why: r.why || '', features: [...(r.features || (fid ? [fid] : []))], status: STATUS[r.status] ? r.status : '待查', agency: r.agency || '待定', when: r.when || '中期', note: r.note || '' });
  };
  for (const r of CURATED(q)) add(r);
  for (const f of FEATURES) for (const r of Array.isArray(f.openFields) ? f.openFields : []) if (r && r.field) add(r, f.id);
  const order = Object.keys(STATUS);
  const list = [...rows.values()].sort((a, b) => (a.when === b.when ? order.indexOf(a.status) - order.indexOf(b.status) : a.when === '100 天' ? -1 : 1));
  return { list, title };
}

function csv(list, title) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['欄位名稱', '用途', '需要的功能', '目前狀態', '建議公開局處', '時程', '備註'];
  const lines = [head.map(cell).join(',')].concat(list.map((r) => [r.field, r.why, r.features.map((f) => title.get(f) || f).join('、'), r.status, r.agency, r.when, r.note].map(cell).join(',')));
  return '﻿' + lines.join('\r\n');
}

let state = null;

export default {
  id: 'open-fields',
  title: '公開欄位清單',
  oneLiner: '建議市府公開的欄位',
  audience: ['mayor', 'gov', 'public'],
  dataStatus: ['real'],
  maturity: 'stable',
  ready: true,
  demoValue: '網站每一個「市府未公開」的空格，匯成一張可以直接交給資訊局與公園處的資料需求表，一鍵匯出 CSV',
  problem: '做樹木決策工具時，最常卡住的不是程式，而是資料沒公開：逐樹移除紀錄、移植去向、核准文號、施工範圍……這些缺口散在各個功能裡。',
  howto: '打開獨立頁，可依局處、狀態、時程篩選；每一列寫清楚欄位、用途、哪些功能需要、目前狀態、建議由哪個局處公開。按「匯出 CSV」下載（Excel 可直接開）。',
  limits: '狀態是本隊 2026-10-13 至 10-23 查核的結果，可能已有變動；「待查」表示我們沒查到，不代表不存在。建議局處是本隊依權責推測，實際分工要由市府確認。各功能可在 manifest 加 openFields 自動併入這張表。',
  rollout: R100('資訊局（開放資料平台與格式）、公園處（樹籍與異動）、工務局（施工）、研考會（列管）', '本表即是資料需求：100 天內先公開標示「100 天」的欄位，其餘排入年度開放資料計畫', '情境試算：多數欄位已在既有業務系統裡，主要成本是去個資與格式整理，含在平台試辦 100–200 萬內', '公布在開放資料平台與本站，每季更新狀態，讓記者與議員追蹤'),
  sources: [
    { label: '臺北市行道樹及公園樹木分布圖（開放資料）', url: 'https://data.gov.tw/dataset/128274', date: '2026-10-13 下載' },
    { label: '臺北市 今日施工資訊（工務局）', url: 'https://data.gov.tw/dataset/145614', date: '2026-10-23 下載' },
    { label: '公園處 樹木移除計畫審查專區', url: 'https://pkl.gov.taipei/News.aspx?n=2939F8C5A5AFE474&sms=F8C3B4B0B10BF291', date: '2026-10-23 查閱' },
    { label: '公園處 2026-09-14 新聞稿（資訊網改版、改版前公告 115 年度異動資料）', url: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&sms=72544237BBE4C5F6&s=7A981D7DA6F441A1', date: '2026-09-14' },
  ],

  async page(ctx) {
    const e = ctx.esc;
    state = await collect(ctx);
    const { list } = state;
    const agencies = new Map();
    for (const r of list) for (const a of splitAg(r.agency)) agencies.set(a, (agencies.get(a) || 0) + 1);
    const ag = [...agencies.entries()].sort((a, b) => b[1] - a[1]);
    const max = ag[0]?.[1] || 1;
    const n100 = list.filter((r) => r.when === '100 天').length;
    return `${STYLE}<div class="f-of">
      <div class="facts">
        <div class="fact"><b>${list.length}</b><span>個欄位缺口</span></div>
        <div class="fact"><b>${n100}</b><span>個 100 天內</span></div>
        <div class="fact"><b>${ag.length}</b><span>個局處</span></div>
      </div>
      <h3 class="h3">依局處</h3>
      <ul class="of-agency">${ag.map(([a, n]) => `<li><button data-of-ag="${e(a)}">${e(a)}</button>${ctx.bar(n, max)}<span>${n}</span></li>`).join('')}</ul>
      <div class="of-filters">
        <select data-of="agency" aria-label="篩選局處"><option value="">全部局處</option>${ag.map(([a]) => `<option>${e(a)}</option>`).join('')}</select>
        <select data-of="status" aria-label="篩選狀態"><option value="">全部狀態</option>${Object.keys(STATUS).map((s) => `<option>${e(s)}</option>`).join('')}</select>
        <select data-of="when" aria-label="篩選時程"><option value="">全部時程</option><option>100 天</option><option>中期</option></select>
        <button class="btn primary mini" data-of-csv>匯出 CSV</button>
      </div>
      <p class="privacy" data-of-count></p>
      <ul class="of-list" data-of-list></ul>
      <details><summary>狀態定義</summary><div class="of-legend">${Object.entries(STATUS).map(([k, v]) => `<span><b style="color:${v.tone}">${e(k)}</b>：${e(v.hint)}</span>`).join('')}</div></details>
      <p class="privacy">本隊查核 2026-10-13～23・局處 ${ctx.badge('est')}</p>
    </div>`;
  },
  bindPage(root, ctx) {
    if (!state) return;
    const e = ctx.esc;
    const { list, title } = state;
    const sel = (k) => root.querySelector(`[data-of="${k}"]`);
    const filtered = () => list.filter((r) => (!sel('agency').value || splitAg(r.agency).includes(sel('agency').value)) && (!sel('status').value || r.status === sel('status').value) && (!sel('when').value || r.when === sel('when').value));
    const draw = () => {
      const rows = filtered();
      root.querySelector('[data-of-count]').textContent = rows.length === list.length ? `共 ${list.length} 項` : `${rows.length}／${list.length} 項`;
      root.querySelector('[data-of-list]').innerHTML = rows.map((r) => {
        const st = STATUS[r.status];
        const feats = r.features.map((f) => (title.has(f) ? `<a href="#/f/${e(f)}">${e(title.get(f))}</a>` : e(f))).join('、');
        return `<li class="of-item"><h4>${e(r.field)}</h4><p class="of-why">${e(r.why)}</p>
          <div class="of-meta"><span class="of-chip of-st" style="color:${st.tone};border-color:${st.tone}">${e(r.status)}</span><span class="of-chip">建議：${e(r.agency)}</span><span class="of-chip">${e(r.when)}</span></div>
          ${feats ? `<div class="of-feat">用於：${feats}</div>` : ''}${r.note ? `<div class="of-note">${e(r.note)}</div>` : ''}</li>`;
      }).join('') || '<li class="privacy">無符合項目</li>';
    };
    root.querySelectorAll('[data-of]').forEach((s) => s.addEventListener('change', draw));
    root.querySelectorAll('[data-of-ag]').forEach((b) => b.addEventListener('click', () => { sel('agency').value = b.dataset.ofAg; draw(); root.querySelector('[data-of-list]').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    root.querySelector('[data-of-csv]').addEventListener('click', () => {
      const blob = new Blob([csv(filtered(), title)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      const d = new Date();
      a.href = URL.createObjectURL(blob);
      a.download = `taipei-tree-open-fields-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      ctx.showToast('已匯出 CSV');
    });
    draw();
  },
};
