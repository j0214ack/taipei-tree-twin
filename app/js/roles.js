// 角色設定：每個角色（網址路徑）有哪些用途按鈕、側欄有哪些功能、首頁面板是什麼。
// 要加角色或調整圖層組合，只改這個檔。

export const CHIPS = {
  street: { label: '行道樹', dot: '#2f7a45' },
  park: { label: '公園樹', dot: '#8fae3a' },
  stale: { label: '多久沒人拍', dot: '#c2362b', colorBy: true },
  plant: { label: '推薦種樹點', dot: '#e07a1f' },
  planter: { label: '移動植栽', dot: '#8a5a9e' },
  adopt: { label: '企業認養', dot: 'conic-gradient(#d9822b 0 33%, #3d7ea6 0 66%, #8a5a9e 0)' },
  shade: { label: '樹蔭×人流', dot: '#b2182b' },
  campus: { label: '校園樹木', dot: '#2b6cb0' },
  review: { label: '複查優先序', dot: '#c2362b', colorBy: true },
  nonew: { label: '不再新植樹種', dot: '#4a5a50' },
};

// 地圖左上的「用途按鈕」：每個角色最多 4 顆，同時只開一顆（決定地圖上色的模式只有一個）。
// layer＝打開哪個圖層（擁有它的功能關掉時按鈕自動消失）；action＝不是圖層、是一段示範。
export const PURPOSES = {
  stale: { icon: '📷', name: '多久沒人拍', hint: '標出最久沒人拍的樹', layer: 'stale' },
  plant: { icon: '🌱', name: '哪裡還能種', hint: '標出空樹穴', layer: 'plant' },
  adopt: { icon: '🏢', name: '企業認養', hint: '標出認養的樹', layer: 'adopt' },
  dongmen: { icon: '📍', name: '東門市場', hint: '看茄苳砍前砍後', action: 'dongmen' },
  review: { icon: '🩺', name: '先去看哪棵', hint: '看該先複查的樹', layer: 'review' },
  shade: { icon: '☀️', name: '人多沒樹蔭', hint: '看人多沒樹蔭的站', layer: 'shade' },
  nonew: { icon: '🚫', name: '不再新植', hint: '看不再新植的樹種', layer: 'nonew' },
  planter: { icon: '🪴', name: '移動植栽', hint: '看移動植栽在哪', layer: 'planter' },
  wish: { icon: '🙋', name: '民眾許願', hint: '標出民眾想種樹的地方', layer: 'wish' },
};

export const NAV = {
  mine: { label: '我的樹', hash: '#/mine' },
  records: { label: '公開紀錄', hash: '#/records' },
  rank: { label: '排行', hash: '#/rank' },
  vendor: { label: '施工查核', hash: '#/vendor' },
  dash: { label: '管理總覽', hash: '#/dash' },
  esg: { label: '認養總覽', hash: '#/esg' },
  esgreport: { label: '報告書素材', hash: '#/f/esg-report' },
  plan: { label: '規劃總覽', hash: '#/plan' },
  mayor: { label: '首長儀表板', hash: '#/mayor' },
  about: { label: '資料說明', hash: '#/about' },
  features: { label: '功能', hash: '#/features' },
};

// 主管機關、規劃、首長合併成「市府」（Yo 2026-10-24）：aud＝這個角色看得到哪些功能的 audience
export const ROLES = {
  public: { path: '/', label: '民眾', purposes: ['stale', 'plant', 'adopt', 'dongmen'], focus: null, nav: ['mine', 'records', 'rank', 'about'], home: null, demos: true },
  gov: { path: '/gov', label: '市府', aud: ['gov', 'plan', 'mayor'], purposes: ['wish', 'shade', 'plant', 'dongmen'], focus: null, tab: 'risk', nav: ['dash', 'plan', 'mayor', 'about'], home: 'dash', demos: true },
  esg: { path: '/esg', label: '企業認養', purposes: ['adopt', 'shade', 'plant', 'planter'], focus: 'adopt', nav: ['esg', 'esgreport', 'rank', 'about'], home: 'esg', demos: false },
};
// 舊網址 /plan、/mayor 併到市府
const ALIAS = { '/plan': '/gov', '/mayor': '/gov', '/vendor': '/' };

export function roleFromPath(pathname) {
  let seg = '/' + (pathname.split('/').filter(Boolean)[0] || '');
  seg = ALIAS[seg] || seg;
  return Object.entries(ROLES).find(([, r]) => r.path === seg)?.[0] || 'public';
}
