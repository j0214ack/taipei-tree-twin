// 樹冠負債計算器：砍一棵大樹＝欠多少樹蔭、要種幾棵、幾年還清。
// 樹冠是推估（胸徑→冠幅），補種是模擬（苗木規格、生長、存活率都是可調假設）。不寫金額、不寫該不該砍。
import * as M from './model.js';

const R100 = (agencies, data, budget, promo) => ({ agencies, data, budget, promo });
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('zh-TW', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');
const STATUS_TONE = { keep: 'var(--danger)', move: 'var(--warn)', remove: 'var(--ok)' };

const STYLE = `<style>
.f-cd .cd-lead{font-size:15px;line-height:1.6;margin:8px 0}
.f-cd .cd-lead b{font-size:17px}
.f-cd .facts{margin-top:10px}
.f-cd .fact b small{font-size:13px;font-family:inherit;color:var(--ink-3);font-weight:400}
.f-cd ul.cd-notes{margin:8px 0;padding-left:18px;font-size:14px;line-height:1.6}
.f-cd .cd-chart{margin:10px 0 4px}
.f-cd .cd-chart svg{width:100%;height:auto;display:block}
.f-cd .cd-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--ink-2)}
.f-cd .cd-legend i{display:inline-block;width:16px;height:0;border-top:2px solid;vertical-align:middle;margin-right:4px}
.f-cd details{margin:10px 0}
.f-cd details>summary{cursor:pointer;font-weight:500;font-size:14px}
.f-cd .sliders{margin-top:8px}
.f-cd .sliders label small{display:block;color:var(--ink-3);font-size:11px}
.f-cd .sliders output{font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}
.f-cd .sliders label{grid-template-columns:1fr 120px 40px}
.f-cd .cd-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:14px;margin:6px 0}
.f-cd select{font:inherit;padding:4px 6px;border-radius:8px;border:1px solid var(--line);background:var(--card);max-width:100%}
.f-cd .cd-formula{font-size:13px;line-height:1.7;color:var(--ink-2)}
.f-cd .cd-formula code{background:var(--paper);padding:1px 4px;border-radius:4px}
.f-cd .cd-tablewrap{overflow-x:auto}
.f-cd table.track td:nth-child(n+3){font-variant-numeric:tabular-nums}
.f-cd .cd-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}
.f-cd .cd-sec{margin-top:18px;padding-top:6px;border-top:1px solid var(--line)}
@media (max-width:420px){.f-cd .sliders label{grid-template-columns:1fr 100px 40px}}
</style>`;

// ---------- 假設面板 ----------
function slider(k, label, note, q, r, unit = '') {
  const [lo, hi, st] = r[k];
  return `<label><span>${label}${note ? `<small>${note}</small>` : ''}</span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${q[k]}" data-q="${k}" aria-label="${label}"><output data-o="${k}">${fmtQ(k, q[k])}${unit}</output></label>`;
}
const fmtQ = (k, v) => (k === 's' ? `${Math.round(v * 100)}%` : k === 'T' ? `${v}` : (+v).toFixed(k === 'wn' ? 2 : 1).replace(/\.0$/, ''));

function paramsPanel(ctx, q, open = false) {
  const e = ctx.esc, r = M.RANGES();
  const opts = [['auto', '同原樹種'], ...M.SAPLING_SPECIES.map((s) => [s, s]), ['pooled', '樹種未定']];
  return `<details class="cd-params" ${open ? 'open' : ''}><summary>補種假設 ${ctx.badge('sim')}</summary>
    <div class="cd-row">補種樹種 <select data-q="sp" aria-label="補種樹種">${opts.map(([v, l]) => `<option value="${e(v)}" ${q.sp === v ? 'selected' : ''}>${e(l)}</option>`).join('')}</select></div>
    <div class="sliders">
      ${slider('T', '幾年追平', '', q, r)}
      ${slider('d0', '苗木米徑（公分）', '', q, r)}
      ${slider('wn', '苗木冠幅（公尺）', '', q, r)}
      ${slider('lag', '建立期（年）', '', q, r)}
      ${slider('s', '年存活率', '', q, r)}
      ${slider('g', '胸徑年增量（公分／年）', '', q, r)}
    </div>
    <div class="cd-row"><label><input type="checkbox" data-q="rgr" ${q.rgr ? 'checked' : ''}> 茄苳／樟樹／楓香用台北實測式</label></div>
    <div class="cd-row">新樹樹冠上限 <select data-q="cap" aria-label="新樹樹冠上限">${[[0, '不設'], [16, '16 m²'], [25, '25 m²'], [36, '36 m²']].map(([v, l]) => `<option value="${v}" ${+q.cap === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <p class="privacy"><button class="btn mini" data-cd-reset>回到預設</button></p>
  </details>`;
}

// ---------- 圖：原樹冠 vs 補種後的期望總樹冠 ----------
function chart(A0, N, q, sp) {
  const W = 320, H = 150, L = 34, Rr = 8, T = 10, B = 22;
  const X = Math.max(20, q.T * 2);
  const c = M.curve(q, sp);
  const pts = [], one = [];
  let ymax = A0 * 1.25;
  for (let y = 0; y <= X; y += 0.5) {
    const a = N * c.at(y).A * q.s ** y, b = c.at(y).A * q.s ** y;
    pts.push([y, a]); one.push([y, b]);
    ymax = Math.max(ymax, a * 1.05);
  }
  const sx = (x) => L + (x / X) * (W - L - Rr), sy = (v) => T + (1 - v / ymax) * (H - T - B);
  const path = (arr) => arr.map(([x, v], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  const yt = [0, ymax / 2, ymax].map((v) => `<text x="${L - 4}" y="${sy(v) + 4}" text-anchor="end">${fmt(v)}</text><line x1="${L}" x2="${W - Rr}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line)" stroke-width="1"/>`).join('');
  const xs = [0, q.T, X].map((v, i) => `<text x="${sx(v)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}">${v} 年</text>`).join('');
  const hits = [];
  for (let y = 0; y <= X; y += 1) {
    const a = N * c.at(y).A * q.s ** y;
    hits.push(`<rect x="${sx(y) - (W - L - Rr) / X / 2}" y="${T}" width="${(W - L - Rr) / X}" height="${H - T - B}" fill="transparent"><title>第 ${y} 年：${N} 棵新苗期望總樹冠約 ${fmt(a)} 平方公尺／原樹冠約 ${fmt(A0)} 平方公尺</title></rect>`);
  }
  return `<div class="cd-chart" role="img" aria-label="原樹冠約 ${fmt(A0)} 平方公尺；種 ${N} 棵新苗，第 ${q.T} 年期望總樹冠約 ${fmt(N * c.at(q.T).A * q.s ** q.T)} 平方公尺">
    <div class="cd-legend"><span><i style="border-color:var(--ink-3);border-top-style:dashed"></i>原樹冠（推估）</span><span><i style="border-color:var(--leaf)"></i>種 ${N} 棵（模擬）</span><span><i style="border-color:var(--est)"></i>一換一（模擬）</span></div>
    <svg viewBox="0 0 ${W} ${H}" font-size="10" fill="var(--ink-3)">
      ${yt}${xs}
      <line x1="${sx(q.T)}" x2="${sx(q.T)}" y1="${T}" y2="${H - B}" stroke="var(--line)" stroke-dasharray="2 3"/>
      <line x1="${L}" x2="${W - Rr}" y1="${sy(A0)}" y2="${sy(A0)}" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="5 4"/>
      <path d="${path(one)}" fill="none" stroke="var(--est)" stroke-width="2"/>
      <path d="${path(pts)}" fill="none" stroke="var(--leaf)" stroke-width="2"/>
      <circle cx="${sx(q.T)}" cy="${sy(N * c.at(q.T).A * q.s ** q.T)}" r="4" fill="var(--leaf)" stroke="var(--card)" stroke-width="2"/>
      ${hits.join('')}
    </svg>
    <p class="privacy">樹冠 m²</p></div>`;
}

// ---------- 單棵結果 ----------
function result(ctx, species, dbh, q, { label = '少了這棵樹' } = {}) {
  const r = M.removed(species, dbh);
  const sp = M.saplingSpecies(q, species);
  const N = M.needN(r.A, q, sp);
  const [nlo, nhi] = M.needRange(r.A, q, sp);
  const c = M.curve(q, sp).at(q.T);
  const surv = q.s ** q.T;
  const o = M.oneToOne(r.A, q, sp);
  const gap = Number.isFinite(N) ? M.gapArea(r.A, N, q, sp) : NaN;
  const notes = [];
  if (r.allo.src === 'fallback') notes.push(`${species}：用合併式`);
  if (r.extrap) notes.push(`外推（擬合範圍 ${fmt(r.fit.lo, 1)}–${fmt(r.fit.hi, 1)} 公分）`);
  if (q.sp === 'auto' && !sp && NONEW_OR_UNKNOWN(species)) notes.push(M.NONEW.test(species) ? `${species}屬改種名單，補種用合併式` : `${species}無新苗參數，補種用合併式`);
  const spLabel = sp || '樹種未定';
  const oneTxt = o.alive == null ? `全活也 ${o.max} 年內補不回（推估，非結論）` : `全活需 ${fmt(o.alive)} 年`;
  const oneTxt2 = q.s < 1 ? (o.expect == null ? '；計死亡：補不回' : `；計死亡約 ${fmt(o.expect)} 年`) : '';
  return `<p class="cd-lead">${ctx.esc(label)}：樹冠 −<b>${fmt(r.A)} m²</b> ${ctx.badge('est')}（${fmt(r.lo)}–${fmt(r.hi)}）</p>
    <div class="facts">
      <div class="fact"><b>${fmt(r.W, 1)}<small> 公尺</small></b><span>冠幅</span></div>
      <div class="fact"><b>${fmt(r.A)}<small> m²</small></b><span>樹冠面積</span></div>
      <div class="fact"><b>${Number.isFinite(N) ? fmt(N) : '—'}<small> 棵</small></b><span>${q.T} 年追平需種（${fmt(nlo)}–${Number.isFinite(nhi) ? fmt(nhi) : '—'}）</span></div>
    </div>
    ${Number.isFinite(N) ? chart(r.A, N, q, sp) : ''}
    <ul class="cd-notes">
      <li>單株${ctx.esc(spLabel)}第 ${q.T} 年：胸徑 ${fmt(c.D, 1)} 公分・樹冠 ${fmt(c.A, 1)} m²・存活 ${Math.round(surv * 100)}% ${ctx.badge('sim')}</li>
      <li>一換一：${oneTxt}${oneTxt2}</li>
      ${Number.isFinite(gap) ? `<li>第 ${q.T} 年前累計缺口 ${fmt(gap)} m²·年（年均 ${fmt(gap / q.T)}）</li>` : ''}
      ${notes.map((n) => `<li>${ctx.esc(n)}</li>`).join('')}
    </ul>`;
}
const NONEW_OR_UNKNOWN = (s) => M.NONEW.test(s) || !M.SAPLING_SPECIES.includes(s);

function formula(ctx, species) {
  const P = M.params();
  const c = species ? M.alloFor(species) : P.fallback;
  return `<details><summary>公式</summary><div class="cd-formula">
    <p><b>冠幅</b> <code>W = a × D<sup>b</sup></code>、<code>A = π／4 × W²</code>　${species ? `${ctx.esc(species)}：a＝${c.a}、b＝${c.b}${c.src === 'fallback' ? '（合併式）' : ''}` : `合併式 a＝${P.fallback.a}、b＝${P.fallback.b}`}　${ctx.badge('est')}</p>
    <p><b>誤差</b> 冠幅 ±20% → 面積 ±44%；單株 ±30–40%</p>
    <p><b>新苗</b> <code>ΔD = a × D<sup>1+b</sup></code>（茄苳／樟樹／楓香），其他固定年增量</p>
    <p><b>追平</b> N × 單株樹冠 × 存活率<sup>年</sup> ≥ 原樹冠</p>
    <p>來源：<a href="https://data.gov.tw/dataset/108167" target="_blank" rel="noopener">臺中行道樹資料</a>、詹為巽 2024</p>
  </div></details>`;
}

// ---------- 綁事件（樹頁與獨立頁共用） ----------
function bindParams(root, ctx, rerender) {
  let q = M.loadUserParams(ctx.store);
  const sync = () => {
    root.querySelectorAll('[data-q]').forEach((el) => {
      const k = el.dataset.q;
      if (el.type === 'checkbox') el.checked = !!q[k]; else el.value = q[k];
      const out = root.querySelector(`[data-o="${k}"]`); if (out) out.textContent = fmtQ(k, q[k]);
    });
  };
  root.querySelectorAll('[data-q]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
    const k = el.dataset.q;
    q = { ...q, [k]: el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? (k === 'cap' ? +el.value : el.value) : +el.value };
    M.saveUserParams(ctx.store, q);
    const out = root.querySelector(`[data-o="${k}"]`); if (out) out.textContent = fmtQ(k, q[k]);
    rerender(q);
  }));
  root.querySelector('[data-cd-reset]')?.addEventListener('click', () => { q = M.defaults(); M.saveUserParams(ctx.store, q); sync(); rerender(q); });
  return q;
}

// ---------- 獨立頁：示範施工案加總 ----------
function orderTrees(ctx, id) {
  const out = [];
  for (const t of ctx.trees) { const w = ctx.workOrderFor(t); if (w && w.order.id === id) out.push({ t, w }); }
  return out;
}
function orderResult(ctx, id, withMove, q) {
  const e = ctx.esc;
  const all = orderTrees(ctx, id);
  const cnt = { keep: 0, move: 0, remove: 0 };
  for (const x of all) cnt[x.w.status]++;
  const pick = all.filter((x) => x.w.status === 'remove' || (withMove && x.w.status === 'move'));
  const ok = pick.filter((x) => M.dbhValid(x.t.dbh)).map((x) => ({ ...x, r: M.removed(x.t.species, x.t.dbh) }));
  const bad = pick.length - ok.length;
  const A0 = ok.reduce((s, x) => s + x.r.A, 0);
  const sp = q.sp === 'auto' ? null : M.saplingSpecies(q, '');
  const k = pick.length;
  if (!pick.length) return `<p class="privacy">無移除／移植</p>`;
  const N = M.needN(A0, q, sp);
  const [nlo, nhi] = M.needRange(A0, q, sp);
  const cover = A0 > 0 ? M.totalAt(k, q, sp, q.T) / A0 : 0;
  ok.sort((a, b) => b.r.A - a.r.A);
  const label = { keep: '保留', move: '移植', remove: '可移除' };
  return `<p class="cd-lead">可移除 <b>${cnt.remove}</b>・移植 <b>${cnt.move}</b>・保留 ${cnt.keep} 棵；${withMove ? '移除＋移植' : '移除'} ${k} 棵樹冠 <b>${fmt(A0)} m²</b> ${ctx.badge('est')}（${fmt(A0 * 0.64)}–${fmt(A0 * 1.44)}）</p>
    <div class="facts">
      <div class="fact"><b>${fmt(A0)}<small> m²</small></b><span>失去樹冠</span></div>
      <div class="fact"><b>${fmt(N)}<small> 棵</small></b><span>${q.T} 年追平需種（${fmt(nlo)}–${Number.isFinite(nhi) ? fmt(nhi) : '—'}）</span></div>
      <div class="fact"><b>${fmt(cover * 100)}<small>%</small></b><span>一換一（${k} 棵）第 ${q.T} 年補回</span></div>
    </div>
    ${chart(A0, N, q, sp)}
    <ul class="cd-notes">
      ${bad ? `<li>${bad} 棵胸徑異常，未計</li>` : ''}
      <li>補種：${e(sp || '樹種未定')}</li>
    </ul>
    <div class="cd-tablewrap"><table class="track"><thead><tr><th>樹籍編號</th><th>樹種</th><th>胸徑</th><th>推估樹冠</th><th>核定（模擬）</th></tr></thead><tbody>
      ${ok.slice(0, 12).map((x) => `<tr data-id="${e(x.t.id)}" tabindex="0"><td>${e(x.t.id)}</td><td>${e(x.t.species)}</td><td>${fmt(x.t.dbh)} 公分</td><td>${fmt(x.r.A)} m²</td><td><span class="cd-dot" style="background:${STATUS_TONE[x.w.status]}"></span>${label[x.w.status]}</td></tr>`).join('')}
    </tbody></table></div>
    ${ok.length > 12 ? `<p class="privacy">前 12／共 ${ok.length} 棵・點列開樹</p>` : '<p class="privacy">點列開樹</p>'}`;
}

export default {
  id: 'canopy-debt',
  title: '樹冠負債計算器',
  oneLiner: '砍一棵樹欠多少樹蔭',
  audience: ['gov', 'plan', 'mayor', 'public'],
  dataStatus: ['est', 'sim'],
  maturity: 'stable',
  ready: true,
  demoValue: '把「移除 3,164、種 42,250」翻成同一個單位：一棵胸徑 40 公分的茄苳，10 年內要種約 20 棵小苗才補得回樹冠（區間 5–26）',
  problem: '市府用「株數」報成績，但一棵大樹和一棵小苗的樹蔭差幾十倍；砍一棵、種一棵，帳面打平，路上的樹蔭卻少了。',
  howto: '點地圖上任一棵樹，詳細頁下方會出現「樹冠負債」區塊；獨立頁可以選一個示範施工案，把核定移除＋移植的樹加總。苗木規格、生長量、存活率、目標年數都能拖滑桿調整。',
  limits: '樹冠是推估：胸徑→冠幅的係數用臺中開放資料自行擬合（台灣查不到本土係數），冠幅高估 20%，面積就高估 44%。補種是模擬：台北補植苗木規格與新植存活率都查不到，改用外縣市個案與國外研究；只有茄苳、樟樹、楓香有台北實測生長量。只算樹冠投影面積，不等於行人實際走到的陰影；沒算修剪、颱風、樹穴大小。不寫金額，也不判斷任何一棵樹該不該砍。施工案、核定處置都是模擬。',
  rollout: R100('公園處（補植規格、存活追蹤）、各工程主辦機關（移除申請附樹冠負債試算）、研考會（列管）', '補植苗木規格表、新植存活率（1／3／5 年）、抽 30–50 棵台北行道樹實量冠幅重擬係數、逐樹移除紀錄', '情境試算：含在平台試辦 100–200 萬內；冠幅實測可由公園處既有巡查人力順帶量', '移除公告同時公布「欠多少樹蔭、補幾棵、幾年追平」，議會質詢與記者可直接引用'),
  sources: [
    { label: '詹為巽（2024）臺北市都市樹木重要效益評估之研究（台北茄苳、樟樹、楓香胸徑年生長）', url: 'https://tdr.lib.ntu.edu.tw/handle/123456789/92929', date: '2024' },
    { label: '臺中市主要道路喬木植栽開放資料（冠幅式擬合來源）', url: 'https://data.gov.tw/dataset/108167', date: '2026-08-13 更新' },
    { label: '臺中市建設局 補植計畫書（苗木米徑 5–8 公分實例）', url: 'https://www.construction.taichung.gov.tw/media/1454877/1150807-%E5%8C%97%E5%B1%AF%E5%8D%80-%E8%BB%8D%E5%8A%9F%E8%B7%AF%E4%B8%80%E6%AE%B5-%E6%9D%B1%E5%B1%B1%E8%B7%AF-%E5%A4%AA%E5%8E%9F%E8%B7%AF-23%E6%A0%AA%E9%BB%91%E6%9D%BF%E6%A8%B9%E7%A7%BB%E9%99%A4%E8%A3%9C%E6%A4%8D%E8%A8%88%E7%95%AB%E6%9B%B8-87%E6%A0%AA%E6%8B%86%E5%88%86-%E8%AA%AA%E6%98%8E%E6%9B%B8.pdf', date: '2026-08-07' },
    { label: 'Roman & Scatena 2011 行道樹存活率統合分析（年存活 94.9–96.5%）', url: 'https://earth.sas.upenn.edu/content/street-tree-survival-rates-meta-analysis-previous-studies-and-application-field-survey', date: '2011' },
    { label: '公園處 行道樹樹種選擇原則（缺株補植改種他種名單）', url: 'https://pkl.gov.taipei/cp.aspx?n=7400D752A0FBE09F', date: '2026-05-21 更新' },
  ],
  openFields: [
    { field: '補植苗木規格表（樹種、米徑、樹高、冠幅、土球）', why: '樹冠負債要從真實的苗木大小起算，現在只能用臺中個案', status: '未公開', agency: '公園處', when: '100 天' },
    { field: '新植／補植存活追蹤（1／3／5 年存活、補植次數）', why: '「要種幾棵」對存活率最敏感，現在用國外研究', status: '未公開', agency: '公園處', when: '100 天' },
    { field: '台北本土胸徑—冠幅實測（依樹種，抽樣即可）', why: '樹冠面積推估的誤差主要來自冠幅式', status: '未公開', agency: '公園處', when: '中期' },
  ],

  async onTree(ctx, tree) {
    await M.loadParams(ctx);
    const e = ctx.esc;
    const wo = ctx.workOrderFor(tree);
    const label = { keep: '保留', move: '移植', remove: '可移除' };
    const ctxLine = wo
      ? `<p class="privacy">${ctx.badge('sim')} ${e(wo.order.name)}：${label[wo.status]}・非處置建議</p>`
      : `<p class="privacy">${ctx.badge('real')} 樹籍・非處置建議</p>`;
    if (!M.dbhValid(tree.dbh)) {
      return `${STYLE}<div class="f-cd">${ctxLine}<div class="alert warn"><p>胸徑「${e(String(tree.dbh ?? '空白'))}」，無法推估（全市 9 千多棵胸徑為 0）</p><p><button class="btn mini" data-go="#/f/open-fields">看缺哪些欄位</button></p></div></div>`;
    }
    const q = M.loadUserParams(ctx.store);
    return `${STYLE}<div class="f-cd">${ctxLine}
      <div data-cd-res>${result(ctx, tree.species, tree.dbh, q)}</div>
      ${paramsPanel(ctx, q)}
      ${formula(ctx, tree.species)}
      <p class="privacy"><a href="#/f/canopy-debt">開計算器</a></p></div>`;
  },
  bindTree(root, ctx, tree) {
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.go(b.dataset.go)));
    if (!M.params() || !M.dbhValid(tree.dbh)) return;
    const box = root.querySelector('[data-cd-res]');
    bindParams(root, ctx, (q) => { box.innerHTML = result(ctx, tree.species, tree.dbh, q); });
  },

  async page(ctx) {
    await M.loadParams(ctx);
    const e = ctx.esc;
    const q = M.loadUserParams(ctx.store);
    const orders = ctx.WORK_ORDERS;
    const spList = [...Object.keys(M.params().allo), '黑板樹', '白千層', '大花紫薇', '水黃皮'];
    const cs = ctx.store.get('canopy-debt.custom', { sp: '茄苳', dbh: 40 });
    if (!spList.includes(cs.sp)) cs.sp = '茄苳';
    if (!(cs.dbh >= 10 && cs.dbh <= 120)) cs.dbh = 40;
    return `${STYLE}<div class="f-cd">
      <p class="privacy">樹冠 ${ctx.badge('est')}　補種 ${ctx.badge('sim')}</p>
      ${paramsPanel(ctx, q, true)}
      <section class="cd-sec" ${orders.length ? '' : 'hidden'}>
        <h3 class="h3">施工案加總 ${ctx.badge('sim')}</h3>
        <div class="cd-row"><select data-cd-order aria-label="選擇示範施工案">${orders.map((o) => `<option value="${e(o.id)}">${e(o.name)}</option>`).join('')}</select>
          <label><input type="checkbox" data-cd-move checked> 含移植</label></div>
        <div data-cd-order-res></div>
      </section>
      <section class="cd-sec">
        <h3 class="h3">自己算一棵 ${ctx.badge('est')}</h3>
        <div class="cd-row">樹種 <select data-cd-sp aria-label="樹種">${spList.map((s) => `<option ${s === cs.sp ? 'selected' : ''}>${e(s)}</option>`).join('')}</select></div>
        <div class="sliders"><label><span>胸徑（公分）</span><input type="range" min="10" max="120" step="1" value="${cs.dbh}" data-cd-dbh aria-label="胸徑"><output data-cd-dbh-o>${cs.dbh}</output></label></div>
        <div data-cd-custom-res></div>
      </section>
      ${formula(ctx, null)}
    </div>`;
  },
  bindPage(root, ctx) {
    if (!M.params()) return;
    const selO = root.querySelector('[data-cd-order]'), chk = root.querySelector('[data-cd-move]');
    const selS = root.querySelector('[data-cd-sp]'), rng = root.querySelector('[data-cd-dbh]');
    const outO = root.querySelector('[data-cd-order-res]'), outC = root.querySelector('[data-cd-custom-res]');
    let q = M.loadUserParams(ctx.store);
    const prev = ctx.store.get('canopy-debt.order', '');
    if (prev && [...selO.options].some((o) => o.value === prev)) selO.value = prev;
    const drawO = () => {
      if (!selO.value) { outO.innerHTML = ''; return; }
      outO.innerHTML = orderResult(ctx, selO.value, chk.checked, q);
      outO.querySelectorAll('tr[data-id]').forEach((tr) => {
        const open = () => ctx.go(`#/tree/${tr.dataset.id}`);
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
      });
    };
    const drawC = () => {
      root.querySelector('[data-cd-dbh-o]').textContent = rng.value;
      outC.innerHTML = result(ctx, selS.value, +rng.value, q, { label: `胸徑 ${rng.value} 公分${selS.value}` });
    };
    q = bindParams(root, ctx, (nq) => { q = nq; drawO(); drawC(); });
    selO.addEventListener('change', () => { ctx.store.set('canopy-debt.order', selO.value); drawO(); });
    chk.addEventListener('change', drawO);
    const saveC = () => ctx.store.set('canopy-debt.custom', { sp: selS.value, dbh: +rng.value });
    selS.addEventListener('change', () => { saveC(); drawC(); });
    rng.addEventListener('input', () => { saveC(); drawC(); });
    drawO(); drawC();
  },
};
