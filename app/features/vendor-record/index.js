// 廠商履約紀錄：每家虛構廠商一張卡。案件數來自示範施工案（模擬），通報次數來自本站回報，補植存活率是模擬。
// 紅線：只用 sim.js 的虛構廠商，不放任何真實營造廠名稱。
import { VENDORS, seeded } from '../../js/sim.js';

// 補植存活率（模擬）：用廠商編號當亂數種子，每次都一樣
function survival(v) {
  const r = seeded('survival' + v.id);
  const planted = 20 + Math.floor(r() * 60);
  const alive = Math.round(planted * (0.68 + r() * 0.27));
  return { planted, alive, pct: Math.round((alive / planted) * 100) };
}

function stats(ctx, ev) {
  const treesBy = new Map();
  for (const t of ctx.trees) {
    const w = ctx.workOrderFor(t); if (!w) continue;
    treesBy.set(w.order.vendor, (treesBy.get(w.order.vendor) || 0) + 1);
  }
  return VENDORS.map((v) => {
    const orders = v.supervisor ? ctx.WORK_ORDERS : ctx.WORK_ORDERS.filter((o) => o.vendor === v.id);
    const mine = ev.filter((e) => e.role === 'vendor' && e.vendor === v.name);
    const alarms = mine.filter((e) => e.kind === 'alarm').sort((a, b) => (a.at < b.at ? 1 : -1));
    return {
      v, orders,
      trees: v.supervisor ? [...treesBy.values()].reduce((a, b) => a + b, 0) : treesBy.get(v.id) || 0,
      prechecks: mine.filter((e) => e.kind === 'precheck').length,
      reviews: mine.filter((e) => e.kind === 'review').length,
      alarms,
      surv: v.supervisor ? null : survival(v),
    };
  });
}

const STYLE = `<style>
.f-vendor-record .vr-card{border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0;background:#fff}
.f-vendor-record .vr-card header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.f-vendor-record .vr-card header b{font-size:16px}
.f-vendor-record .vr-row{display:flex;align-items:center;font-size:13px;color:var(--ink-2);margin:6px 0}
.f-vendor-record .vr-row span:first-child{width:10.5em;flex:none;white-space:nowrap}
.f-vendor-record .vr-row em{font-style:normal;min-width:4.5em;text-align:right;color:var(--ink)}
.f-vendor-record ul{margin:6px 0 0;padding-left:18px;font-size:13px;color:var(--ink-2)}
.f-vendor-record .vr-future{border:1px dashed var(--sim);background:var(--sim-bg);border-radius:12px;padding:12px 14px;margin:14px 0;font-size:14px;color:#3f3456}
</style>`;

function card(ctx, s, maxAlarm) {
  const e = ctx.esc, v = s.v;
  return `<article class="vr-card">
    <header><b>${e(v.name)}</b><span>${v.supervisor ? '<span class="badge kind">監造</span>' : '<span class="badge kind">施工</span>'} ${ctx.badge('sim')}</span></header>
    <div class="vr-row"><span>施工案 ${ctx.badge('sim')}</span><em>${s.orders.length} 件</em></div>
    <ul>${s.orders.map((o) => `<li>${e(o.id)} ${e(o.name)}</li>`).join('')}</ul>
    <div class="vr-row"><span>涉及行道樹</span><em>${s.trees} 棵</em></div>
    <div class="vr-row"><span>樹牌核對 ${ctx.badge('live')}</span><em>${s.prechecks} 次</em></div>
    ${v.supervisor ? `<div class="vr-row"><span>監造複核 ${ctx.badge('live')}</span><em>${s.reviews} 次</em></div>` : ''}
    <div class="vr-row"><span>異常通報 ${ctx.badge('live')}</span>${ctx.bar(s.alarms.length, maxAlarm, 'var(--danger)')}<em>${s.alarms.length} 次</em></div>
    ${s.surv ? `<div class="vr-row"><span>補植存活率 ${ctx.badge('sim')}</span>${ctx.bar(s.surv.pct, 100, 'var(--leaf)')}<em>${s.surv.pct}%</em></div>
      <p class="privacy">補植 ${s.surv.planted}｜一年存活 ${s.surv.alive}</p>` : ''}
    ${s.alarms.length ? `<p class="privacy" style="margin-top:8px">最近通報</p>
      <ul>${s.alarms.slice(0, 4).map((a) => `<li><a href="#/tree/${encodeURIComponent(a.treeId)}">${e(a.treeId)}</a>｜${e(a.result || '異常')}｜${e(ctx.fmtDate(a.at))}</li>`).join('')}</ul>` : ''}
  </article>`;
}

export default {
  id: 'vendor-record',
  title: '廠商履約紀錄',
  oneLiner: '每家廠商的異常紀錄',
  audience: ['gov', 'mayor'],
  dataStatus: ['sim', 'live'],
  maturity: 'exp',
  ready: false, hidden: true,
  demoValue: '誤砍不再是一次性的新聞：通報會跟著廠商走，下次評選看得到',
  problem: '誤砍或違規之後，處分與求償通常只留在單一案件裡；下一次招標時，評選委員很難看到這家廠商過去的樹木保護紀錄。',
  howto: '每家廠商一張卡：示範施工案件數、涉及的樹、施工前樹牌核對次數、本站異常通報次數、補植存活率。到「施工查核」用廠商帳號回報異常，這裡的數字會跟著變。',
  limits: '廠商與施工案全部虛構；異常通報是本站示範回報（任何人都能送出，沒有身分驗證）；補植存活率是模擬數字。目前沒有把履約紀錄納入評選的制度，這是未來規劃。',
  rollout: {
    agencies: '工務局（公園處、新工處）、採購單位、政風',
    data: '核准文號對到樹籍編號、施工異常與監造複核紀錄、補植一年後存活檢查',
    budget: '情境試算：沿用本站事件資料，主要是契約條款修訂與資料串接人力',
    promo: '寫進施工契約與驗收規定；在評選須知加入「樹木保護履約紀錄」為參考項（需法制評估）',
  },
  sources: [
    { label: '東門市場茄苳案：公園處說明（施工未依要求、監造不周、終止契約）', url: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&s=CB71C5F458062BF7&sms=72544237BBE4C5F6', date: '2026-09-22' },
  ],

  async page(ctx) {
    const ev = await ctx.getAllEvents().catch(() => []);
    const S = stats(ctx, ev);
    const maxAlarm = Math.max(1, ...S.map((s) => s.alarms.length));
    const total = S.reduce((a, s) => a + s.alarms.length, 0);
    return `${STYLE}<div class="f-vendor-record">
      <p class="privacy">${ctx.badge('sim')}${ctx.badge('live')} 異常通報共 ${total} 次</p>
      ${S.map((s) => card(ctx, s, maxAlarm)).join('')}
      <div class="vr-future"><b>規劃</b>：納入評選（未實施）</div>
      <div class="actions"><button class="btn" data-go="#/vendor">到施工查核</button></div>
    </div>`;
  },

  async onTree(ctx, tree) {
    const wo = ctx.workOrderFor(tree);
    if (!wo) return '';
    const v = VENDORS.find((x) => x.id === wo.order.vendor);
    if (!v) return '';
    const ev = await ctx.getAllEvents().catch(() => []);
    const s = stats(ctx, ev).find((x) => x.v.id === v.id);
    const e = ctx.esc;
    return `<p class="privacy">廠商：${e(v.name)} ${ctx.badge('sim')}</p>
      <div class="facts">
        <div class="fact"><b>${s.orders.length}</b><span>施工案</span></div>
        <div class="fact"><b>${s.alarms.length}</b><span>異常通報</span></div>
        <div class="fact"><b>${s.surv ? s.surv.pct + '%' : '—'}</b><span>補植存活率 ${ctx.badge('sim')}</span></div>
      </div>
      <div class="actions"><button class="btn mini" data-go="#/f/vendor-record">看全部廠商</button></div>`;
  },
  bindTree(root, ctx) {
    root?.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.go(b.dataset.go)));
  },
};
