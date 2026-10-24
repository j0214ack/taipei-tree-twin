// 模擬資料：時間軸、施工案、企業認養、點數。全部是示範用虛構資料，畫面上一律標「模擬」。
// 同一棵樹每次產生的結果都一樣（用樹的編號當亂數種子）。

export function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 粗估樹齡：胸徑每年約長 1.2–2 公分（依樹種差很多），只拿來排時間軸示意。
export function estPlantYear(dbh, surveyYear) {
  if (!dbh) return null;
  const age = Math.max(2, Math.round(dbh / 1.6));
  return surveyYear - age;
}

const PRUNE = ['例行修剪（疏枝）', '颱風前修剪', '修剪下垂枝（影響行人）', '修剪遮蔽號誌枝條'];
const PEST = ['褐根病疑似病徵，追蹤觀察', '介殼蟲，噴藥防治', '白蟻蛀蝕，處理後追蹤', '葉斑病，加強通風'];
const STORM = ['颱風後巡查：部分斷枝已清除', '颱風後巡查：樹體傾斜，已扶正加支架'];

export function timeline(tree) {
  const r = seeded(tree.id);
  const now = 2026;
  const surveyYear = tree.survey ? +tree.survey.slice(0, 4) : 2023;
  const plant = estPlantYear(tree.dbh, surveyYear);
  const ev = [];
  if (plant) ev.push({ year: plant, date: `${plant}`, kind: 'plant', title: '種植（推估年份）', body: '推估種植年', tag: 'est' });
  // 政治紅線：模擬的修剪、病蟲害、颱風紀錄只出現在「示範區」（模擬施工案範圍）內的樹，其他真實樹只放真實欄位與推估
  const demo = !!workOrderFor(tree);
  let y = Math.max(plant ?? 2005, 2005) + 2 + Math.floor(r() * 3);
  while (demo && y <= now) {
    const roll = r();
    const m = String(1 + Math.floor(r() * 12)).padStart(2, '0');
    if (roll < 0.55) ev.push({ year: y, date: `${y}-${m}`, kind: 'prune', title: PRUNE[Math.floor(r() * PRUNE.length)], body: '養護廠商作業紀錄。', tag: 'sim' });
    else if (roll < 0.7) ev.push({ year: y, date: `${y}-${m}`, kind: 'pest', title: PEST[Math.floor(r() * PEST.length)], body: '樹醫巡查紀錄。', tag: 'sim' });
    else if (roll < 0.8) ev.push({ year: y, date: `${y}-${m}`, kind: 'storm', title: STORM[Math.floor(r() * STORM.length)], body: '災後巡查紀錄。', tag: 'sim' });
    y += 2 + Math.floor(r() * 3);
  }
  if (tree.survey) ev.push({ year: surveyYear, date: tree.survey, kind: 'survey', title: '樹籍調查', body: `量測胸徑 ${tree.dbh ?? '—'} 公分、樹高 ${tree.height ?? '—'} 公尺。`, tag: 'real' });
  if (tree.place === FUMIN.park) ev.push(...FUMIN.events);
  const wo = workOrderFor(tree);
  if (wo) ev.push({ year: 2026, date: wo.order.noticeDate, kind: 'notice', title: `施工通報：${wo.order.name}`, body: `本樹處置：${STATUS[wo.status].label}${wo.permit ? `（核准文號 ${wo.permit}）` : ''}。`, tag: 'sim' });
  return ev.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---- 富民生態公園整建：公園層級的真實事件（依公園處移除計畫公告與報導整理，見 research/10；部分日期待核原件）----
const FUMIN_SRC = 'https://pkl.gov.taipei/News_Content.aspx?n=2939F8C5A5AFE474&s=D13E810EB14DD7D8&sms=F8C3B4B0B10BF291';
export const FUMIN = {
  park: '富民生態公園',
  src: FUMIN_SRC,
  events: [
    { date: '2025-09-11', kind: 'pest', title: '公園：樹木安全評估', body: '初期 8 株建議移除，其中 4 株評估表記載與過去截幹、修剪不當有關。', tag: 'real', src: FUMIN_SRC },
    { date: '2025-09-27', kind: 'notice', title: '公園：整建說明會', body: '說明約移除 12 株、移植 6 株。', tag: 'real', src: FUMIN_SRC },
    { date: '2025-12', kind: 'notice', title: '公園：移除計畫送審', body: '送審版移除 11 株、移植 6 株。', tag: 'real', src: FUMIN_SRC },
    { date: '2026-07-06', kind: 'survey', title: '公園：專家會勘改方案', body: '1 株榕樹改保留、2 株阿勃勒改移植；07-14 再有 1 株陰香改保留、07-29 1 株白千層（腐朽率約 41%）改保留。', tag: 'real', src: FUMIN_SRC },
    { date: '2026-08-10', kind: 'notice', title: '公園：開工', body: '決標約 4,763 萬元，預定 2027 年 6 月完工。', tag: 'real', src: FUMIN_SRC },
    { date: '2026-09-23', kind: 'notice', title: '公園：更新計畫，預定移除縮為 6 株', body: '從最初約 12 株一路改到 6 株：這就是逐株公開、會勘後能改的價值。', tag: 'real', src: FUMIN_SRC },
  ],
};

// ---- 東門市場茄苳示範案例：事件依 research/03（市府新聞稿與媒體報導），位置為推測 ----
export const DONGMEN = {
  id: 'DEMO-DONGMEN',
  species: '茄苳',
  dbh: null,
  height: null,
  survey: '',
  dist: '中正區',
  place: '金山南路一段東門市場前（推定）',
  remark: '',
  kind: 0,
  lng: 121.527226,
  lat: 25.034695,
  imagery: 'JJ0263131034',
  hypothesis: '推定位置：2024-11-21 網路存檔的行道樹資料有一棵茄苳 JJ0263131034（胸徑 56.3 公分、樹高 12.6 公尺），位在東門市場正前方，2026-10-13 的官方資料已經沒有這個編號。最可能就是被誤砍的那棵，但未經市府確認。',
  demo: true,
  timeline: [
    { date: '約 1986', kind: 'plant', title: '種植（推估）', body: '報導描述為「約 40 年」老樹；正式樹齡未取得。', tag: 'est' },
    { date: '2026-04-23', kind: 'notice', title: '會勘：決定移植', body: '公園處稱已會勘，原處置為移植到適合綠地（理由：樹穴太小影響生長）。日期依聯合報轉述。', tag: 'real', src: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&s=28831B7E8102EB08&sms=72544237BBE4C5F6' },
    { date: '2026-05', kind: 'removed', title: '施工時被移除（應為移植）', body: '市府稱施工者未依原要求、監造不周。確切砍除日不明。', tag: 'real', src: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&s=CB71C5F458062BF7&sms=72544237BBE4C5F6' },
    { date: '2026-05-05', kind: 'notice', title: '施工廠商承認疏失', body: '依公園處 9/22 說明・承認日期', tag: 'real', src: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&s=CB71C5F458062BF7&sms=72544237BBE4C5F6' },
    { date: '2026-09-21', kind: 'notice', title: '議員揭露、市府公開承認疏失', body: '公園處稱裁罰與求償合計 325,210 元。', tag: 'real', src: 'https://udn.com/news/story/7323/9768138' },
    { date: '2026-09-22', kind: 'notice', title: '終止施工契約、政風調查', body: '公園處表示終止契約並啟動政風調查（調查尚未結案）。', tag: 'real', src: 'https://www.gov.taipei/News_Content.aspx?n=74806083EBDF5A03&s=CB71C5F458062BF7&sms=72544237BBE4C5F6' },
    { date: '2026-11', kind: 'notice', title: '臨時植栽補位', body: '原樹穴先放大型移動植栽，避免這段路從有樹蔭直接變全曬。', tag: 'sim' },
    { date: '2027-03', kind: 'plant', title: '補種新樹', body: '依人行道寬度選樹種補種，沿用原樹 ID 記錄「這裡曾有一棵 40 年茄苳」。', tag: 'sim' },
    { date: '未來', kind: 'survey', title: '新樹長成、重新有樹蔭', body: '成蔭年數依樹種而定', tag: 'est' },
  ],
};

// ---- 施工案（模擬）----
export function inDemoZone(tree) { return !!workOrderFor(tree); }

export const STATUS = {
  keep: { label: '保留', tone: 'danger', warn: '本樹必須保留，禁止移除、禁止修剪主幹。' },
  move: { label: '移植', tone: 'warn', warn: '本樹須依移植計畫移植，禁止砍除。' },
  remove: { label: '可移除', tone: 'ok', warn: '已核准移除，請依文號辦理並回報。' },
};

export const VENDORS = [
  { id: 'v1', name: '青禾景觀工程（虛構）', account: 'qinghe' },
  { id: 'v2', name: '綠格子工程（虛構）', account: 'lvgezi' },
  { id: 's1', name: '虛構工程顧問（監造）', account: 'supervisor', supervisor: true },
];

// 模擬施工案已拿掉（Yo 2026-10-24 12:42：看不懂、沒意義）。清單留空，依賴它的示範區、核定處置、施工查核都不再出現
export const WORK_ORDERS = [];

function distM(a, b) {
  const dx = (a[0] - b[0]) * 101000, dy = (a[1] - b[1]) * 111000;
  return Math.hypot(dx, dy);
}

const woCache = new Map();
export function workOrderFor(tree) {
  if (woCache.has(tree.id)) return woCache.get(tree.id);
  let res = null;
  if (tree.id === DONGMEN.id) res = null;
  else if (tree.kind === 0) {
    for (const o of WORK_ORDERS) {
      if (!o.places.includes(tree.place)) continue;
      if (distM([tree.lng, tree.lat], o.center) > o.radius) continue;
      const r = seeded(tree.id + o.id)();
      const status = r < 0.62 ? 'keep' : r < 0.85 ? 'move' : 'remove';
      const n = Math.floor(seeded(tree.id)() * 9000 + 1000);
      const permit = status === 'keep' ? '' : `示範文號 DEMO-1150${n}（虛構）`;
      res = { order: o, status, permit, moveTo: status === 'move' ? o.moveTo : '' };
      break;
    }
  }
  woCache.set(tree.id, res);
  return res;
}

// ---- 企業 ESG 認養（虛構企業、自製 logo）----
const logo = (bg, fg, glyph) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${bg}"/>${glyph(fg)}</svg>`)}`;
export const COMPANIES = [
  { id: 'c1', name: '葉隙光電（虛構企業）', color: '#d9822b', logo: logo('#d9822b', '#fff', (f) => `<circle cx="32" cy="28" r="12" fill="none" stroke="${f}" stroke-width="5"/><path d="M14 50h36" stroke="${f}" stroke-width="5" stroke-linecap="round"/>`) },
  { id: 'c2', name: '綠廊人壽（虛構企業）', color: '#3d7ea6', logo: logo('#3d7ea6', '#fff', (f) => `<path d="M32 12c10 8 14 18 0 40C18 30 22 20 32 12z" fill="${f}"/>`) },
  { id: 'c3', name: '蔭下書屋（虛構企業）', color: '#8a5a9e', logo: logo('#8a5a9e', '#fff', (f) => `<path d="M14 18h16v30H14zM34 18h16v30H34z" fill="none" stroke="${f}" stroke-width="4"/>`) },
];
// 贊助新聞：企業與新聞都是虛構的，只連到站內示意頁（#/news/<企業 id>），不連任何真實網站
export const NEWS = {
  c1: { date: '2026-03-18', title: '葉隙光電認養仁愛路四段林蔭道，三年負擔修剪與病蟲害巡查', body: ['虛構企業葉隙光電宣布認養仁愛路四段（大安區段）林蔭道，三年內負擔修剪、病蟲害巡查與颱風前加固的經費。', '認養不代表企業擁有這些樹：處置仍由公園處決定，企業只出錢；市民在這個平台上的照片回報，企業與公園處會同時收到。', '企業表示，會把「認養區民眾回報幾件、處理幾件」寫進年度永續報告。'] },
  c2: { date: '2025-11-06', title: '綠廊人壽認養大安森林公園東側樹群，每季公開養護紀錄', body: ['虛構企業綠廊人壽認養大安森林公園東側樹群，每季在每棵樹的頁面上公開養護紀錄。', '公園處仍負責所有處置決定；企業的角色是補足養護經費，並承諾認養區有異常回報時 7 天內回覆處理進度。', '企業另外提撥一半經費，給樹蔭較少的社區補種，避免認養只集中在熱門地段。'] },
  c3: { date: '2026-06-02', title: '蔭下書屋發起「一店一樹」，認養敦化南路二段行道樹', body: ['虛構企業蔭下書屋在敦化南路二段發起「一店一樹」，每家門市認養門口的一棵行道樹。', '店員每月拍一張照片上傳到平台，讓這棵樹的樹況不會停在多年前的調查。', '認養期間樹若需要移植或移除，仍依公園處核定辦理，平台會在樹頁上公開。'] },
};

export const ADOPTIONS = [
  { company: 'c1', type: 'zone', label: '仁愛路四段（大安區段）林蔭道', match: { dist: '大安區', place: '仁愛路四段' }, since: '2026-03' },
  { company: 'c2', type: 'zone', label: '大安森林公園東側樹群', match: { place: '大安森林公園', lngMin: 121.5365 }, since: '2025-11' },
  { company: 'c3', type: 'tree', label: '單棵認養', ids: [], pick: { place: '敦化南路二段', every: 97 }, since: '2026-06' },
];

export function adoptionFor(tree) {
  for (const a of ADOPTIONS) {
    if (a.type === 'zone') {
      const m = a.match;
      if (m.dist && tree.dist !== m.dist) continue;
      if (tree.place !== m.place) continue;
      if (m.lngMin && tree.lng < m.lngMin) continue;
      return { ...a, company: COMPANIES.find((c) => c.id === a.company) };
    }
    if (a.type === 'tree' && tree.place === a.pick.place) {
      const n = parseInt(tree.id.replace(/\D/g, '').slice(-4), 10);
      if (n % a.pick.every === 0) return { ...a, company: COMPANIES.find((c) => c.id === a.company) };
    }
  }
  return null;
}

// ---- 點數與排行（模擬）----
export const POINTS = { base: 10, perDays: 10, bonusCap: 40, never: 50, report: 5 };
// 「多久沒人拍」：demo 用模擬天數（約三成從沒人拍過），真的有人在本站上傳後就歸零
export function staleDays(id) {
  const r = seeded('photo' + id)();
  if (r < 0.3) return -1;
  return Math.floor(((r - 0.3) / 0.7) ** 1.6 * 900);
}
// 越久沒人拍，上傳照片分數越高；從沒人拍過給最高檔
export function photoPoints(days) {
  if (days < 0) return POINTS.never;
  return POINTS.base + Math.min(POINTS.bonusCap, Math.floor(days / POINTS.perDays));
}
export const SIM_USERS = [
  ['榕樹下的貓', 420], ['騎腳踏車的阿伯', 365], ['欒樹季節', 310], ['大安巡樹員', 275], ['早餐店老闆娘', 240],
  ['士林小學生', 190], ['路過的樟樹粉', 160], ['夜跑的人', 120], ['南港新住民', 95], ['茄苳守護者', 80],
].map(([name, pts]) => ({ name, pts, sim: true }));
export const REWARDS = [
  { name: '樹苗認領券（台灣原生種）', cost: 100, sponsor: 'c2' },
  { name: '環保隨行杯', cost: 150, sponsor: 'c1' },
  { name: '蔭下書屋咖啡兌換券', cost: 60, sponsor: 'c3' },
  { name: '和樹醫一起巡樹半日體驗', cost: 300, sponsor: null },
];

const NICK_A = ['路過的', '愛散步的', '騎車的', '帶小孩的', '早起的'];
const NICK_B = ['樟樹粉', '欒樹迷', '榕樹控', '茄苳友', '樹蔭獵人'];
export function randomNick() {
  return NICK_A[Math.floor(Math.random() * NICK_A.length)] + NICK_B[Math.floor(Math.random() * NICK_B.length)] + '#' + Math.floor(Math.random() * 900 + 100);
}
