// 把行道樹＋公園樹 CSV 壓成前端用的欄式 JSON（app/data/trees.json）。
// 用法：node scripts/build-trees.mjs [原始資料目錄]
import fs from 'node:fs';
import path from 'node:path';
import { twd97ToWgs84 } from './twd97.mjs';

const RAW = process.argv[2] || '/Users/yo/workspace/shade-hackathon/data/raw/2026-10-13';
const OUT = new URL('../app/data/trees.json', import.meta.url);

function readCsv(file) {
  const text = fs.readFileSync(path.join(RAW, file), 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? '').trim()]));
  });
}

const dict = { species: [], dists: [], places: [], remarks: [] };
const idx = {};
function intern(key, v) {
  idx[key] ??= new Map();
  if (!idx[key].has(v)) { idx[key].set(v, dict[key].length); dict[key].push(v); }
  return idx[key].get(v);
}
const num = (v) => (v === '' || isNaN(+v) ? null : +v);
const date = (v) => (!v || v.startsWith('1899') || v.startsWith('1900') ? '' : v);

const rows = [];
let bad = 0;
for (const [file, kind] of [['TaipeiTree.csv', 0], ['TaipeiParkTree.csv', 1]]) {
  for (const r of readCsv(file)) {
    const x = num(r.TWD97X), y = num(r.TWD97Y);
    if (!x || !y || x < 280000 || x > 330000 || y < 2750000 || y > 2800000) { bad++; continue; }
    const [lng, lat] = twd97ToWgs84(x, y);
    rows.push([
      r.TreeID,
      Math.round(lng * 1e6) / 1e6,
      Math.round(lat * 1e6) / 1e6,
      intern('species', r.TreeType || '未登錄'),
      num(r.Diameter),
      num(r.TreeHeight),
      date(r.SurveyDate),
      intern('dists', r.Dist || ''),
      intern('places', (kind ? r.ParkName : r.Region) || ''),
      intern('remarks', kind ? '' : r.RegionRemark || ''),
      kind,
    ]);
  }
}
const out = {
  generated: new Date().toISOString(),
  source: 'data.gov.tw/dataset/128274（TaipeiTree.csv、TaipeiParkTree.csv，2026-10-13 下載）',
  cols: ['id', 'lng', 'lat', 'species', 'dbh', 'height', 'survey', 'dist', 'place', 'remark', 'kind'],
  ...dict,
  rows,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`trees: ${rows.length}, skipped(bad coords): ${bad}, species: ${dict.species.length}, places: ${dict.places.length}`);
