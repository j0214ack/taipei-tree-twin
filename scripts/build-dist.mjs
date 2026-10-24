// 產生要部署到 Cloudflare Pages 的 dist/：複製 app/、資產網址加內容雜湊（Pages 會快取 js／json）、
// 以及 Functions 用的示範區樹籍清單（functions/_lib/wo-ids.js）。
// 用法：node scripts/build-dist.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { workOrderFor } from '../app/js/sim.js';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const APP = path.join(ROOT, 'app'), DIST = path.join(ROOT, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(APP, DIST, { recursive: true });

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
const jsDir = path.join(DIST, 'js');
const v = (rel) => `${rel}?v=${hash(path.join(DIST, rel))}`;

// 1) 被 app.js 引用的模組與資料檔先算雜湊
let app = fs.readFileSync(path.join(jsDir, 'app.js'), 'utf8');
for (const f of fs.readdirSync(jsDir).filter((f) => f !== 'app.js')) app = app.replaceAll(`'./${f}'`, `'./${f}?v=${hash(path.join(jsDir, f))}'`);
for (const f of fs.readdirSync(path.join(DIST, 'data')).filter((f) => fs.statSync(path.join(DIST, 'data', f)).isFile())) app = app.replaceAll(`'/data/${f}'`, `'/${v(`data/${f}`)}'`);
// 樹木分塊：index 帶版本號，分塊檔用 index 裡的 v 當版本
if (fs.existsSync(path.join(DIST, 'data/trees/index.json'))) app = app.replaceAll(`'/data/trees/index.json'`, `'/${v('data/trees/index.json')}'`);
fs.writeFileSync(path.join(jsDir, 'app.js'), app);

// 2) index.html 指到版本化的 css／js
let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
for (const rel of ['css/app.css', 'js/app.js', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css']) html = html.replace(`"/${rel}"`, `"/${v(rel)}"`);
fs.writeFileSync(path.join(DIST, 'index.html'), html);

// 3) 角色路徑（/gov 等）由 functions/gov.js 等回傳首頁，_redirects 的 200 改寫在 Pages 會被轉成 308

// 4) 示範區（模擬施工案）樹籍編號：Functions 只接受這些樹的廠商回報
const d = JSON.parse(fs.readFileSync(path.join(APP, 'data/trees.json'), 'utf8'));
const ids = d.rows.filter((r) => workOrderFor({ id: r[0], lng: r[1], lat: r[2], kind: r[10], place: d.places[r[8]] })).map((r) => r[0]);
fs.writeFileSync(path.join(ROOT, 'functions/_lib/wo-ids.js'), `// 由 scripts/build-dist.mjs 產生，勿手改\nexport const WO_IDS = new Set(${JSON.stringify(ids)});\n`);
console.log(`dist ready; demo-zone trees: ${ids.length}`);
