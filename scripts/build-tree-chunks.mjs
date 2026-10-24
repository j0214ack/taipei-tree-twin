// 把 app/data/trees.json（約 12 MB）切成格網分塊，讓首屏只載眼前那幾塊、其餘在背景載完。
// 輸出 app/data/trees/index.json（字典＋每塊範圍與棵數＋全市總數）與 app/data/trees/c_<x>_<y>.json。
// 原本的 trees.json 保留（模樹 nearby.js、collect.html 直接讀它）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'app/data/trees.json');
const OUT = path.join(ROOT, 'app/data/trees');
const CELL = 0.02; // 約 2 公里一格

const d = JSON.parse(fs.readFileSync(SRC, 'utf8'));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const cells = new Map();
for (const r of d.rows) {
  const x = Math.floor(r[1] / CELL), y = Math.floor(r[2] / CELL);
  const k = `${x}_${y}`;
  (cells.get(k) || cells.set(k, []).get(k)).push([r[0], +r[1].toFixed(5), +r[2].toFixed(5), ...r.slice(3)]);
}
const chunks = [];
for (const [k, rows] of cells) {
  const [x, y] = k.split('_').map(Number);
  const f = `c_${k}.json`;
  fs.writeFileSync(path.join(OUT, f), JSON.stringify({ rows }));
  chunks.push({ f, bbox: [+(x * CELL).toFixed(2), +(y * CELL).toFixed(2), +((x + 1) * CELL).toFixed(2), +((y + 1) * CELL).toFixed(2)], n: rows.length });
}
chunks.sort((a, b) => b.n - a.n);
const v = crypto.createHash('sha256').update(JSON.stringify(d.rows)).digest('hex').slice(0, 10);
const index = { v, generated: d.generated, source: d.source, cols: d.cols, species: d.species, dists: d.dists, places: d.places, remarks: d.remarks, total: d.rows.length, cell: CELL, chunks };
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
console.log(`${chunks.length} chunks, ${d.rows.length} trees, index ${(fs.statSync(path.join(OUT, 'index.json')).size / 1024).toFixed(0)} KB`);
