// 既有功能的 manifest：只描述它擁有哪些圖層按鈕（chips）、導覽項（nav）、詳細頁分頁（treeTabs）、
// 其他畫面零件（parts），程式本體仍在 app.js。關掉功能＝這些零件全部隱藏。
const R100 = (agencies, data, budget, promo) => ({ agencies, data, budget, promo });

export default [
  {
    id: 'citizen-report', core: true, title: '民眾照片回報', oneLiner: '對某棵樹拍照、回報狀況，先比對定位再去個資',
    audience: ['public', 'gov', 'esg', 'plan', 'mayor'], dataStatus: ['live'], maturity: 'stable', ready: true,
    demoValue: '民眾一張照片，直接變成主管的待辦',
    problem: '樹況回報散在 1999 與臉書社團，沒有對到哪一棵樹。', howto: '點樹 →「上傳照片／回報」→ 拍照，系統先比對照片位置是不是這棵。',
    limits: '示範站照片公開；沒有真實帳號與審核；GPS 有 5–20 公尺誤差。',
    rollout: R100('公園處受理、資訊局帳號與資安', '樹籍編號＋回報事件格式', '含在平台試辦 100–200 萬內', '樹牌 QR、里長與學校'),
  },
  {
    id: 'stale-points', title: '多久沒人拍＋巡樹點數', oneLiner: '越久沒人拍的樹分數越高，引導大家補齊樹況',
    audience: ['public'], dataStatus: ['sim', 'live'], maturity: 'stable', ready: true, chips: ['stale'], nav: ['rank'],
    demoValue: '把「巡樹」變成大家願意做的事，而且先補缺資料的樹',
    problem: '樹籍調查多在 2022–2024 年，之後的樹況沒人更新。', howto: '打開「多久沒人拍」圖層，紅色的最划算；排行頁有里程碑與各區缺資料比例。',
    limits: '天數為模擬；點數未經審核；造假預防只有規劃。',
    rollout: R100('公園處、研考會', '照片事件與審核紀錄', '贈品由企業 ESG 贊助', '學校、社區巡樹志工'),
  },
  {
    id: 'planting', title: '推薦種樹點', oneLiner: '用樹穴圖找出最可能是空的樹穴，依人行道寬度建議種什麼',
    audience: ['public', 'gov', 'plan', 'mayor'], dataStatus: ['real', 'est'], maturity: 'stable', ready: true, chips: ['plant'],
    demoValue: '「把三千棵樹種回來」：光是一排缺一棵的空穴就有七千多處',
    problem: '不知道哪裡還能種。', howto: '打開「推薦種樹點」圖層，點任一點看理由與可種樹型。',
    limits: '未現勘；樹穴與樹木資料調查時間不同；人行道寬度是否為淨寬未確認。',
    rollout: R100('新工處、公園處', '樹穴空置狀態、地下管線', '現勘人力', '里長提報'),
  },
  { id: 'planter', title: '移動植栽', oneLiner: '人行道太窄種不了樹的地方，先放可移動的綠', audience: ['public', 'plan'], dataStatus: ['sim'], maturity: 'exp', ready: true, chips: ['planter'], demoValue: '種不了樹也有替代方案', problem: '人行道不到 2 公尺依原則不補種喬木。', howto: '打開「移動植栽」圖層。', limits: '植栽、企業、移動紀錄全為模擬。', rollout: R100('新工處、公園處', '植栽位置與養護', '企業認養', '商圈') },
  { id: 'esg', title: '企業 ESG 認養', oneLiner: '企業認養一棵或一段林蔭道，負責養護經費', audience: ['public', 'esg'], dataStatus: ['sim'], maturity: 'stable', ready: true, chips: ['adopt'], nav: ['esg'], parts: ['adopt-card'], demoValue: '企業出錢、民眾出眼睛、市府出資料', problem: '養護經費不足。', howto: '打開「企業認養」圖層或到認養總覽。', limits: '企業全為虛構；認養不排他。', rollout: R100('公園處、研考會', '認養區與經費', '企業出資', '企業永續報告') },
  { id: 'shade-flow', title: '樹蔭×人流', oneLiner: '捷運站周邊人多但樹冠少的地方', audience: ['gov', 'plan', 'esg', 'mayor'], dataStatus: ['real', 'est'], maturity: 'stable', ready: true, chips: ['shade'], demoValue: '南港展覽館、南京復興最缺樹蔭', problem: '不知道哪裡最多人曬太陽。', howto: '打開「樹蔭×人流」圖層，點站看數字。', limits: '樹冠為推估；捷運人次不等於人行道人流。', rollout: R100('交通局、公園處', '人流、樹冠', '分析人力', '公開地圖') },
  { id: 'imagery', title: '歷年影像對照', oneLiner: '用國土測繪中心歷年航照看大樹還在不在', audience: ['public', 'gov', 'plan'], dataStatus: ['real'], maturity: 'exp', ready: true, treeTabs: ['aerial'], parts: ['img-markers'], demoValue: '同一個位置，2014 到現在的樹冠變化', problem: '樹被移走後無從對照。', howto: '點地圖上的「📷 歷年影像」。', limits: '只有 5 棵示範樹；圖層年份不等於拍攝年份。', rollout: R100('地政局、公園處', '歷年正射影像', '影像授權', '公開對照') },
  { id: 'review', title: '複查優先序', oneLiner: '只用真實欄位排「先去看哪棵」，不是病況診斷', audience: ['gov', 'mayor'], dataStatus: ['real', 'est'], maturity: 'stable', ready: true, chips: ['review'], treeTabs: ['risk'], demoValue: '十年沒調查的大榕樹先去看', problem: '巡查人力有限。', howto: '主管機關版預設開啟，可調權重。', limits: '權重是管理選擇；不是病況。', rollout: R100('公園處', '調查日期、胸徑、樹種', '既有巡查人力', '內部') },
  { id: 'vendor-check', hidden: true, title: '廠商施工查核', oneLiner: '施工前核對樹牌、看到保留／移植警示，回報不符就停工', audience: ['vendor'], dataStatus: ['sim'], maturity: 'stable', ready: false, nav: ['vendor'], demoValue: '東門茄苳最可能斷在這一步（假說）', problem: '核定移植的樹被誤砍。', howto: '廠商版輸入樹牌編號。', limits: '施工案、文號、廠商全為模擬。', rollout: R100('公園處、工程主辦機關', '核准文號對到樹籍編號', '契約條款', '寫進驗收') },
  { id: 'gov-dash', title: '管理總覽', oneLiner: '民眾回報、複查優先、資料品質一頁看', audience: ['gov', 'mayor'], dataStatus: ['real', 'est', 'sim', 'live'], maturity: 'stable', ready: true, nav: ['dash'], demoValue: '資料品質卡等於給公園處改版的建議清單', problem: '待辦散在各系統。', howto: '主管機關版首頁。', limits: '施工案為模擬。', rollout: R100('公園處', '事件、樹籍', '平台內', '內部') },
  { id: 'plan-weights', title: '補種規劃', oneLiner: '三個權重滑桿排出下一棵種哪裡', audience: ['plan', 'gov', 'mayor'], dataStatus: ['real', 'est'], maturity: 'stable', ready: true, nav: ['plan'], demoValue: '權重是政策選擇，拖滑桿即時重排', problem: '補種位置憑感覺。', howto: '規劃版首頁。', limits: '代理指標；未現勘。', rollout: R100('公園處、都發局', '人口、地表溫度', '分析人力', '公開討論權重') },
  { id: 'nonew', title: '不再新植樹種', oneLiner: '公園處列為不再新植的樹種分布', audience: ['plan'], dataStatus: ['real'], maturity: 'stable', ready: true, chips: ['nonew'], demoValue: '補種時不選，不代表要移除', problem: '補種重複選到問題樹種。', howto: '打開圖層。', limits: '名單依公園處公告（原件 7 類，榕樹另列不畫以免蓋滿全市；仁愛路四段菩提樹例外）；多數是缺株改種他種，不是絕對禁種。', rollout: R100('公園處', '樹種名單', '無', '設計準則') },
  { id: 'campus', title: '校園樹木', oneLiner: '教育部平臺每校樹種統計，連回平臺看照片', audience: ['plan'], dataStatus: ['real'], maturity: 'exp', ready: true, parts: ['campus'], demoValue: '學校也是一大片遮蔭資源', problem: '校園樹木不在市府樹籍。', howto: '規劃版最下方。', limits: '只有每校統計，沒有單株座標；授權未標示。', rollout: R100('教育局', '單株座標', '無', '學校') },
  { id: 'records', title: '公開紀錄', oneLiner: '移除彙總、富民與東門時間線、移除與補種對帳', audience: ['public'], dataStatus: ['real', 'sim'], maturity: 'stable', ready: true, nav: ['records'], demoValue: '不用等質詢，市民當天就看得到', problem: '紀錄散在新聞稿與 PDF。', howto: '民眾版「公開紀錄」。', limits: '對帳卡為模擬。', rollout: R100('公園處、研考會', '逐樹移除紀錄', '無', '公開') },
  { id: 'cases', title: '示範案例：東門、富民', oneLiner: '東門茄苳誤砍與富民公園逐株改方案的真實時間線', audience: ['public', 'gov', 'mayor'], dataStatus: ['real'], maturity: 'stable', ready: true, parts: ['demos'], demoValue: '真實事件帶出系統價值', problem: '個案經過難以追溯。', howto: '左上兩顆示範按鈕。', limits: '東門樹位為推定位置。', rollout: R100('公園處', '個案文件', '無', '公開') },
  { id: 'near', title: '我附近', oneLiner: '附近 500 公尺有幾棵樹、哪些待更新', audience: ['public'], dataStatus: ['real', 'sim', 'est'], maturity: 'stable', ready: true, parts: ['near'], demoValue: '打開就知道身邊的樹需不需要你', problem: '不知道從哪裡開始。', howto: '左上「我附近」。', limits: '定位只在手機上使用。', rollout: R100('公園處', '無', '無', '樹牌 QR') },
  { id: 'mine', title: '我的樹', oneLiner: '關心幾棵樹，看它們的前世今生', audience: ['public'], dataStatus: ['live'], maturity: 'stable', ready: true, nav: ['mine'], demoValue: '跟一棵樹建立關係', problem: '民眾很難在施工前知道一棵樹要被怎麼處置。', howto: '樹頁按「關心這棵樹」。', limits: '存在瀏覽器。', rollout: R100('公園處', '通知', '無', '社群') },
];
