import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { ADOPTIONS, COMPANIES, adoptionFor, seeded } from '../app/js/sim.js';

async function loadArtifactTool() {
  try { return await import('@oai/artifact-tool'); }
  catch {
    const bundled = process.env.ARTIFACT_TOOL_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs');
    return import(pathToFileURL(bundled).href);
  }
}
const { SpreadsheetFile, Workbook } = await loadArtifactTool();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app/downloads/esg');
const TMP = path.join(ROOT, 'tmp/pdfs/esg');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CUTOFF = '2026-10-24';
const PERIOD = '2026-01-01 至 2026-10-24';
const PLATFORM = 'https://preview.taipei-tree-twin.pages.dev/esg';
const REMINDER = '自願保育行動，不能算減排，也不是碳權。';
const FILES = {
  c1: 'c1-yesi-solar-esg-pack',
  c2: 'c2-green-corridor-life-esg-pack',
  c3: 'c3-under-tree-books-esg-pack',
};
const AMOUNTS = { c1: 2_480_000, c2: 3_260_000, c3: 180_000 };
const REDEEMED = { c1: 328, c2: 412, c3: 48 };
const SOURCE_URL = 'https://data.gov.tw/dataset/128274';

const treesData = JSON.parse(await fs.readFile(path.join(ROOT, 'app/data/trees.json'), 'utf8'));
const trees = treesData.rows.map((r, i) => ({
  i, id: r[0], lng: r[1], lat: r[2], species: treesData.species[r[3]], dbh: r[4], height: r[5], survey: r[6],
  dist: treesData.dists[r[7]], place: treesData.places[r[8]], remark: treesData.remarks[r[9]], kind: r[10],
}));

function dateMinus(days) {
  const d = new Date(`${CUTOFF}T00:00:00+08:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function twd97(lng, lat) {
  const a = 6378137.0, b = 6356752.314245;
  const lng0 = 121 * Math.PI / 180, k0 = 0.9999, dx = 250000;
  const lon = lng * Math.PI / 180, phi = lat * Math.PI / 180;
  const e = Math.sqrt(1 - (b * b) / (a * a));
  const e2 = e * e / (1 - e * e);
  const n = (a - b) / (a + b);
  const nu = a / Math.sqrt(1 - e * e * Math.sin(phi) ** 2);
  const p = lon - lng0;
  const A = a * (1 - n + 5 / 4 * (n ** 2 - n ** 3) + 81 / 64 * (n ** 4 - n ** 5));
  const B = 3 * a * n / 2 * (1 - n + 7 / 8 * (n ** 2 - n ** 3) + 55 / 64 * (n ** 4 - n ** 5));
  const C = 15 * a * n ** 2 / 16 * (1 - n + 3 / 4 * (n ** 2 - n ** 3));
  const D = 35 * a * n ** 3 / 48 * (1 - n + 11 / 16 * (n ** 2 - n ** 3));
  const E = 315 * a * n ** 4 / 512 * (1 - n);
  const S = A * phi - B * Math.sin(2 * phi) + C * Math.sin(4 * phi) - D * Math.sin(6 * phi) + E * Math.sin(8 * phi);
  const K1 = S * k0;
  const K2 = k0 * nu * Math.sin(2 * phi) / 4;
  const K3 = k0 * nu * Math.sin(phi) * Math.cos(phi) ** 3 / 24 * (5 - Math.tan(phi) ** 2 + 9 * e2 * Math.cos(phi) ** 2 + 4 * e2 ** 2 * Math.cos(phi) ** 4);
  const y = K1 + K2 * p ** 2 + K3 * p ** 4;
  const K4 = k0 * nu * Math.cos(phi);
  const K5 = k0 * nu * Math.cos(phi) ** 3 / 6 * (1 - Math.tan(phi) ** 2 + e2 * Math.cos(phi) ** 2);
  const x = dx + K4 * p + K5 * p ** 3;
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
}

function recordsFor(company) {
  return trees.filter((t) => adoptionFor(t)?.company.id === company.id).map((t) => {
    const adoption = adoptionFor(t);
    const random = seeded(`esg-${company.id}-${t.id}`);
    const statusRoll = random();
    const status = statusRoll < 0.92 ? '存活' : statusRoll < 0.97 ? '待確認' : statusRoll < 0.99 ? '死亡' : '移除';
    const photoTotal = Math.floor(random() * 4);
    const photos = [];
    for (let i = 0; i < photoTotal; i++) {
      const distance = Math.round(random() * 220) / 10;
      const source = random() < 0.68 ? '市民照片' : '企業志工';
      const date = dateMinus(5 + Math.floor(random() * 240));
      photos.push({ date, source, status, distance, result: distance <= 15 ? '通過' : '待人工審核', link: `${PLATFORM}/#/tree/${t.id}?photo=${i + 1}` });
    }
    const valid = photos.filter((p) => p.result === '通過');
    const last = valid.map((p) => p.date).sort().at(-1) || '';
    const [x, y] = twd97(t.lng, t.lat);
    return { t, adoption, status, photos, valid, last, x, y };
  });
}

function draftRows(company, list) {
  const ads = ADOPTIONS.filter((a) => a.company === company.id);
  const since = ads.map((a) => a.since).sort()[0] || '—';
  const where = ads.map((a) => (a.type === 'zone' ? a.label : '單棵認養行道樹')).join('、');
  const dists = [...new Set(list.map((r) => r.t.dist))].join('、');
  const valid = list.reduce((n, r) => n + r.valid.length, 0);
  return [
    ['額外保育行動', 'GRI 101-2-a-v、SDG 15', `本公司自 ${since} 起與臺北市政府公園處合作，自願認養${where}共 ${list.length.toLocaleString()} 株樹木，負擔養護經費。此為與第三方合作的額外保育行動，不用來管理本公司營運造成的生物多樣性衝擊。每株樹都有市府樹籍編號，養護與照片紀錄可逐株查核。`],
    ['自願保育與復育', 'TNFD A24、SDG 15', `認養範圍共 ${list.length.toLocaleString()} 株，位於${dists}。平台以逐棵樹籍編號、日期與照片追蹤成果；本期共有 ${valid.toLocaleString()} 張照片通過位置規則。額外保育行動投入金額為新臺幣 ${AMOUNTS[company.id].toLocaleString()} 元（模擬）。`],
    ['氣候調適與社區投資', 'GRI 413-1、GRI 201-1、SDG 11、13', `認養樹位於${dists}的人行道與公園，提供行人遮蔭，作為都市熱環境調適的質性行動。本期由市民與企業志工上傳照片並留下可追溯紀錄，投入金額可列為社區投資。`],
  ];
}

const COLORS = { dark: '#174936', green: '#2E7356', mint: '#E8F2ED', amber: '#F5E7C8', line: '#D8E2DD', text: '#173029', muted: '#61736C', white: '#FFFFFF' };
const FONT = 'Arial';

function styleTable(sheet, range, headerRange) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  range.format.font = { name: FONT, size: 10, color: COLORS.text };
  range.format.verticalAlignment = 'center';
  headerRange.format = { fill: COLORS.dark, font: { name: FONT, size: 10, bold: true, color: COLORS.white }, verticalAlignment: 'center', horizontalAlignment: 'center', wrapText: true, borders: { preset: 'outside', style: 'thin', color: COLORS.dark } };
  headerRange.format.rowHeight = 30;
}

async function makeWorkbook(company, list) {
  const wb = Workbook.create();
  const summary = wb.worksheets.add('摘要');
  const detail = wb.worksheets.add('逐棵明細');
  const inventory = wb.worksheets.add('盤點紀錄');
  const gri = wb.worksheets.add('GRI 對照');
  const drafts = wb.worksheets.add('報告書段落');
  const method = wb.worksheets.add('方法與限制');
  const lastDetail = list.length + 1;
  const photoRows = list.flatMap((r) => [
    ...(r.t.survey ? [[r.t.survey, r.t.id, '公園處普查', '樹籍在冊', '', '', '原始樹籍紀錄', '真實']] : []),
    ...r.photos.map((p) => [p.date, r.t.id, p.source, p.status, p.link, p.distance, p.result, '模擬']),
  ]);
  const validPhotos = list.reduce((n, r) => n + r.valid.length, 0);
  const citizenPhotos = list.reduce((n, r) => n + r.valid.filter((p) => p.source === '市民照片').length, 0);

  summary.getRange('A1:C14').values = [
    ['項目', '數值', '資料標示'],
    ['企業', company.name, '模擬'],
    ['報告期間', PERIOD, '模擬'],
    ['資料截止日', CUTOFF, '固定日期'],
    ['認養棵數', null, '樹籍真實；認養模擬'],
    ['樹種數', new Set(list.map((r) => r.t.species)).size, '真實樹籍'],
    ['存活棵數', null, '模擬'],
    ['存活率', null, '公式：存活／認養'],
    ['有效照片數', validPhotos, '模擬'],
    ['市民有效照片數', citizenPhotos, '模擬'],
    ['企業志工有效照片數', validPhotos - citizenPhotos, '模擬'],
    ['贊助獎品兌換數', REDEEMED[company.id], '模擬'],
    ['投入金額', AMOUNTS[company.id], '模擬'],
    ['揭露邊界', REMINDER, '固定文字'],
  ];
  summary.getRange('B5').formulas = [[`=COUNTA('逐棵明細'!A2:A${lastDetail})`]];
  summary.getRange('B7').formulas = [[`=COUNTIF('逐棵明細'!N2:N${lastDetail},"存活")`]];
  summary.getRange('B8').formulas = [['=IF(B5=0,0,B7/B5)']];
  styleTable(summary, summary.getRange('A1:C14'), summary.getRange('A1:C1'));
  summary.getRange('A2:A14').format.font = { name: FONT, bold: true, color: COLORS.text };
  summary.getRange('B8').format.numberFormat = '0.0%';
  summary.getRange('B13').format.numberFormat = 'NT$#,##0';
  summary.getRange('A14:C14').format.fill = COLORS.amber;
  summary.getRange('A1:C14').format.wrapText = true;
  summary.getRange('A1:A14').format.columnWidth = 22;
  summary.getRange('B1:B14').format.columnWidth = 58;
  summary.getRange('C1:C14').format.columnWidth = 24;

  const detailHeaders = ['樹籍編號', '樹種', '行政區', '路段／公園', '經度', '緯度', 'TWD97 X', 'TWD97 Y', '胸徑（公分）', '樹高（公尺）', '認養起日（模擬）', '最近照片日（模擬）', '照片數（模擬）', '狀態（模擬）', '最近照片連結（模擬）', '公園處最近調查日'];
  detail.getRange('A1').write([detailHeaders, ...list.map((r) => [r.t.id, r.t.species, r.t.dist, r.t.place, r.t.lng, r.t.lat, r.x, r.y, r.t.dbh, r.t.height, r.adoption.since, r.last, r.valid.length, r.status, r.last ? `${PLATFORM}/#/tree/${r.t.id}` : '', r.t.survey])]);
  styleTable(detail, detail.getRange(`A1:P${lastDetail}`), detail.getRange('A1:P1'));
  detail.getRange(`E2:H${lastDetail}`).format.numberFormat = '0.000000';
  detail.getRange(`I2:J${lastDetail}`).format.numberFormat = '0.0';
  detail.getRange(`A1:P${lastDetail}`).format.autofitColumns();
  for (const col of ['A','B','C','D','K','L','N','P']) detail.getRange(`${col}1:${col}${lastDetail}`).format.columnWidth = Math.min(detail.getRange(`${col}1:${col}${lastDetail}`).format.columnWidth || 16, col === 'D' ? 28 : 20);
  detail.getRange(`O1:O${lastDetail}`).format.columnWidth = 36;

  const invHeaders = ['日期', '樹籍編號', '來源', '狀態', '照片連結', '照片與樹的距離（公尺）', '審核結果', '資料標示'];
  inventory.getRange('A1').write([invHeaders, ...photoRows]);
  const invLast = photoRows.length + 1;
  styleTable(inventory, inventory.getRange(`A1:H${invLast}`), inventory.getRange('A1:H1'));
  inventory.getRange(`A1:H${invLast}`).format.autofitColumns();
  inventory.getRange(`E1:E${invLast}`).format.columnWidth = 38;
  inventory.getRange(`F2:F${invLast}`).format.numberFormat = '0.0';

  const griRows = [
    ['GRI 101-2-a-v', '額外保育行動', '逐棵樹籍、認養期間、照片與盤點紀錄', '額外保育行動段落', ''],
    ['TNFD A24.1', '自願復育專案', '株數、期間、監測頻率', '自願保育與復育段落', ''],
    ['TNFD A24.2', '額外保育行動投入', '投入金額（模擬）', '自願保育與復育段落', ''],
    ['GRI 413-1', '當地社區參與', '市民與企業志工照片紀錄', '氣候調適與社區投資段落', ''],
    ['GRI 201-1', '社區投資', '投入金額（模擬）', '氣候調適與社區投資段落', ''],
  ];
  gri.getRange('A1').write([['揭露編號', '標題', '本平台提供的資料', '報告書可引用段落', '確信狀態（企業填）'], ...griRows]);
  styleTable(gri, gri.getRange('A1:E6'), gri.getRange('A1:E1'));
  gri.getRange('A1:E6').format.wrapText = true;
  gri.getRange('A1:A6').format.columnWidth = 20; gri.getRange('B1:B6').format.columnWidth = 24; gri.getRange('C1:D6').format.columnWidth = 44; gri.getRange('E1:E6').format.columnWidth = 24;
  gri.getRange('E2:E6').format.fill = '#FFF3C4';

  const draftData = draftRows(company, list);
  drafts.getRange('A1').write([['段落', '對應項目', '報告書草稿'], ...draftData]);
  styleTable(drafts, drafts.getRange('A1:C4'), drafts.getRange('A1:C1'));
  drafts.getRange('A1:C4').format.wrapText = true;
  drafts.getRange('A1:A4').format.columnWidth = 28; drafts.getRange('B1:B4').format.columnWidth = 34; drafts.getRange('C1:C4').format.columnWidth = 100;
  drafts.getRange('A2:C4').format.rowHeight = 82;

  const methodRows = [
    ['資料截止日', CUTOFF],
    ['真實資料', '樹籍編號、樹種、行政區、路段、公園、經緯度、胸徑、樹高、公園處最近調查日。'],
    ['真實資料來源', `${treesData.source}；${SOURCE_URL}`],
    ['模擬資料', '企業、認養起日、照片、盤點紀錄、狀態、投入金額、獎品兌換。'],
    ['存活率算法', '狀態為「存活」的認養樹棵數 ÷ 認養棵數。摘要分頁以 Excel 公式計算。'],
    ['照片審核規則', '照片位置在樹籍座標 15 公尺內列為通過；超過 15 公尺列為待人工審核。'],
    ['有效照片', '審核結果為「通過」的模擬照片。'],
    ['TWD97', '由真實經緯度轉換為 TWD97 / TM2 zone 121，單位為公尺。'],
    ['狀態限制', '狀態是模擬盤點結果，不代表公園處判定。'],
    ['揭露邊界', REMINDER],
    ['碳吸存', '本素材包不提供數字。'],
    ['使用方式', '企業可依實際期間、金額與確信範圍更新黃底欄位。'],
  ];
  method.getRange('A1').write([['項目', '方法與限制'], ...methodRows]);
  styleTable(method, method.getRange('A1:B13'), method.getRange('A1:B1'));
  method.getRange('A1:B13').format.wrapText = true;
  method.getRange('A1:A13').format.columnWidth = 24; method.getRange('B1:B13').format.columnWidth = 100;
  method.getRange('A11:B11').format.fill = COLORS.amber;

  wb.recalculate();
  const errorScan = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 100 }, summary: `${company.id} formula error scan` });
  if (errorScan.ndjson.includes('"matchCount":') && !errorScan.ndjson.includes('"matchCount":0')) throw new Error(errorScan.ndjson);
  const output = await SpreadsheetFile.exportXlsx(wb);
  await output.save(path.join(OUT, `${FILES[company.id]}.xlsx`));
  return { summary: 13, detail: list.length, inventory: photoRows.length, gri: griRows.length, drafts: draftData.length, method: methodRows.length };
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function reportHtml(company, list) {
  const counts = Object.fromEntries(['存活', '待確認', '死亡', '移除'].map((s) => [s, list.filter((r) => r.status === s).length]));
  const valid = list.reduce((n, r) => n + r.valid.length, 0);
  const minLng = Math.min(...list.map((r) => r.t.lng)), maxLng = Math.max(...list.map((r) => r.t.lng));
  const minLat = Math.min(...list.map((r) => r.t.lat)), maxLat = Math.max(...list.map((r) => r.t.lat));
  const dots = list.slice(0, 800).map((r) => {
    const x = 24 + ((r.t.lng - minLng) / Math.max(maxLng - minLng, 0.0001)) * 552;
    const y = 238 - ((r.t.lat - minLat) / Math.max(maxLat - minLat, 0.0001)) * 204;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.1" fill="${company.color}" fill-opacity=".72"/>`;
  }).join('');
  const bars = Object.entries(counts).map(([label, value]) => `<div class="bar"><span>${label}</span><i><b style="width:${(value / list.length * 100).toFixed(1)}%"></b></i><strong>${value.toLocaleString()}</strong></div>`).join('');
  const topSpecies = [...new Map([...new Set(list.map((r) => r.t.species))].map((s) => [s, list.filter((r) => r.t.species === s).length])).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><style>
  @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#173029;font-family:"Noto Sans TC","PingFang TC",Arial,sans-serif;font-size:10.5pt}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #174936;padding-bottom:8px}.brand{display:flex;gap:10px;align-items:center}.logo{width:42px;height:42px;border-radius:12px;background:${company.color};display:grid;place-items:center;color:#fff;font-size:21px;font-weight:800}.eyebrow{font-size:9pt;color:#61736c}.title{font-size:21pt;font-weight:800;letter-spacing:.02em}.badge{background:#f5e7c8;border-radius:99px;padding:5px 10px;font-weight:700}.period{margin-top:10px;color:#61736c}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.kpi{padding:12px;border:1px solid #d8e2dd;border-radius:12px;background:#f8fbf9}.kpi b{display:block;font-size:19pt;color:#174936}.kpi span{font-size:9pt;color:#61736c}.grid{display:grid;grid-template-columns:1.05fr .95fr;gap:12px}.card{border:1px solid #d8e2dd;border-radius:14px;padding:12px;break-inside:avoid}.card h2{font-size:12pt;margin:0 0 9px}.map{width:100%;height:250px;background:#eef4f1;border-radius:10px;border:1px solid #d8e2dd}.bar{display:grid;grid-template-columns:45px 1fr 48px;gap:8px;align-items:center;margin:11px 0}.bar i{height:10px;background:#e8f2ed;border-radius:9px;overflow:hidden}.bar b{display:block;height:100%;background:#2e7356}.bar strong{text-align:right}.note{margin:13px 0;padding:10px 12px;background:#f5e7c8;border-radius:10px;font-weight:800}.method{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px}.method p{margin:4px 0;line-height:1.55}.link{word-break:break-all;color:#2e7356}.page2{page-break-before:always}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:8px;border-bottom:1px solid #d8e2dd;text-align:left}.table th{background:#174936;color:white}.draft{margin:10px 0;padding:12px;border-left:4px solid #2e7356;background:#f8fbf9;border-radius:0 10px 10px 0;line-height:1.65}.draft h3{margin:0 0 5px;font-size:11pt}footer{position:fixed;bottom:0;left:0;right:0;text-align:center;color:#7a8b84;font-size:8.5pt;border-top:1px solid #d8e2dd;padding-top:4px}
  </style></head><body><header><div class="brand"><div class="logo">樹</div><div><div class="eyebrow">${esc(company.name)}</div><div class="title">認養成果摘要</div></div></div><div class="badge">模擬資料</div></header><div class="period">報告期間 ${PERIOD}　資料截止日 ${CUTOFF}</div>
  <section class="kpis"><div class="kpi"><b>${list.length.toLocaleString()}</b><span>認養棵數</span></div><div class="kpi"><b>${new Set(list.map((r) => r.t.species)).size}</b><span>樹種數</span></div><div class="kpi"><b>${(counts['存活'] / list.length * 100).toFixed(1)}%</b><span>存活率（模擬）</span></div><div class="kpi"><b>${valid.toLocaleString()}</b><span>有效照片（模擬）</span></div></section>
  <section class="grid"><div class="card"><h2>認養範圍</h2><svg class="map" viewBox="0 0 600 260" role="img" aria-label="認養樹位置分布"><path d="M18 55H582M18 105H582M18 155H582M18 205H582M120 20V242M240 20V242M360 20V242M480 20V242" stroke="#d8e2dd" stroke-width="1"/>${dots}</svg><p class="eyebrow">點位依真實樹籍座標；底圖為示意。</p></div><div class="card"><h2>逐棵狀態</h2>${bars}<h2 style="margin-top:22px">主要樹種</h2>${topSpecies.map(([s,n])=>`<div class="bar"><span>${esc(s)}</span><i><b style="width:${(n/topSpecies[0][1]*100).toFixed(1)}%;background:${company.color}"></b></i><strong>${n.toLocaleString()}</strong></div>`).join('')}</div></section>
  <div class="note">${REMINDER}</div><section class="method"><div class="card"><h2>方法</h2><p>逐棵樹籍串接認養與照片紀錄；照片在樹籍座標 15 公尺內列為有效。</p><p>狀態、照片、金額與認養資料均為模擬。</p></div><div class="card"><h2>查看逐棵紀錄</h2><p class="link">${PLATFORM}</p><p>Excel 附逐棵明細、盤點紀錄與揭露對照。</p></div></section>
  <section class="page2"><header><div><div class="eyebrow">${esc(company.name)}</div><div class="title">報告書引用段落</div></div><div class="badge">草稿</div></header>${draftRows(company,list).map(([t,tag,text])=>`<article class="draft"><h3>${esc(t)}｜${esc(tag)}</h3>${esc(text)}</article>`).join('')}<table class="table"><thead><tr><th>資料範圍</th><th>標示</th></tr></thead><tbody><tr><td>樹籍編號、樹種、位置、胸徑、樹高、調查日</td><td>真實開放資料</td></tr><tr><td>企業、認養、照片、盤點、狀態、金額</td><td>模擬</td></tr></tbody></table></section><footer>平台產出・模擬資料</footer></body></html>`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { stdio: 'inherit' });
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(TMP, { recursive: true });
const qa = {};
for (const company of COMPANIES) {
  const list = recordsFor(company);
  qa[company.id] = { company: company.name, counts: await makeWorkbook(company, list) };
  const htmlPath = path.join(TMP, `${FILES[company.id]}.html`);
  const pdfPath = path.join(OUT, `${FILES[company.id]}.pdf`);
  await fs.writeFile(htmlPath, reportHtml(company, list));
  await run(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`]);
}
await fs.writeFile(path.join(TMP, 'qa-counts.json'), JSON.stringify(qa, null, 2));
console.log(JSON.stringify(qa, null, 2));
