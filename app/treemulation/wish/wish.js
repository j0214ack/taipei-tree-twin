// 許願這裡有一棵樹：相機＋陀螺儀錨定＋分層 2D 樹長大＋合成照片上傳
import { SPECIES, speciesById, DEFAULT_LOC, WISH_POINTS, GOAL, CELL_M, postWish, getWishes, addPoints } from '../../features/wish-map/shared.js?v=20261024b';

const $ = (s) => document.querySelector(s);
const app = $('#app'), video = $('#video'), bg = $('#bg'), tv = $('#tv');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const GROW_MS = RM ? 900 : 4600; // 幾何樹（照片沒載入時的備援）
const POP_MS = RM ? 600 : 2500; // 照片樹只有成樹照：從 0.25 倍放大到 1 倍
const STAGE_MS = RM ? [250, 250, 250, 350] : [1000, 1000, 1100, 1500]; // 四階段：小苗→幼樹→中樹→成樹
const STAGE_YR = [[1, 2], [3, 5], [6, 9], [10, 10]]; // 各階段的年數標籤
const XF_MS = RM ? 80 : 250; // 換圖交叉淡入
const LONG_FOV = 63; // 手機主鏡頭錄影長邊視角（度），iPhone 約 63°

const S = {
  sp: 'luan', cam: false, loc: null, defaultLoc: false, geoDone: false,
  q: null, qT: null, F: 0, // 目前／目標裝置姿態（四元數 [w,x,y,z]）、投影焦距（px）
  tree: null, // { sx, sy, dir, h, t0, p, preview }
  parts: [], phase: 'intro', lastYear: 0,
};

/* ---------- 尺寸 ---------- */
let W = 0, H = 0, DPR = 1;
function resize() {
  const r = app.getBoundingClientRect(); W = r.width; H = r.height; DPR = Math.min(2, devicePixelRatio || 1);
  for (const c of [bg, tv]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  const x = bg.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0); drawStreet(x, W, H);
  calcF();
}
// 焦距要對上實際顯示的相機畫面（object-fit: cover），樹轉動的速度才會跟畫面一致
function calcF() {
  const vw = video.videoWidth, vh = video.videoHeight;
  let long = Math.max(W, H);
  if (S.cam && vw && vh) { const s = Math.max(W / vw, H / vh); long = Math.max(vw * s, vh * s); }
  S.F = long / 2 / Math.tan((LONG_FOV / 2) * Math.PI / 180);
}
video.addEventListener('loadedmetadata', calcF);
video.addEventListener('resize', calcF);
addEventListener('resize', resize);

/* ---------- 沒有相機時的街景替代背景 ---------- */
function drawStreet(x, w, h) {
  const hz = h * 0.52;
  let g = x.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, '#6cc8ff'); g.addColorStop(0.75, '#c9ecff'); g.addColorStop(1, '#eef9ff');
  x.fillStyle = g; x.fillRect(0, 0, w, hz);
  // 雲
  x.fillStyle = '#ffffffd0';
  for (const [cx, cy, s] of [[0.2, 0.12, 1], [0.72, 0.2, 0.8], [0.5, 0.06, 0.6]]) {
    const X = cx * w, Y = cy * h, R = 26 * s * (w / 390);
    x.beginPath(); x.arc(X, Y, R, 0, 7); x.arc(X + R, Y + 6, R * 0.8, 0, 7); x.arc(X - R, Y + 8, R * 0.7, 0, 7); x.fill();
  }
  // 樓
  const cols = ['#f6d7b0', '#d9e8f5', '#f3c4b5', '#e7ecd4', '#cfdcec', '#f8e3a8'];
  let bx = -10, i = 0;
  while (bx < w) {
    const bw = w * (0.14 + ((i * 37) % 10) / 70), bh = h * (0.12 + ((i * 53) % 9) / 40);
    x.fillStyle = cols[i % cols.length]; x.fillRect(bx, hz - bh, bw, bh);
    x.fillStyle = '#ffffff90';
    for (let wy = hz - bh + 12; wy < hz - 18; wy += 22) for (let wx = bx + 8; wx < bx + bw - 12; wx += 18) x.fillRect(wx, wy, 9, 12);
    bx += bw + 4; i++;
  }
  // 遠處矮樹籬
  x.fillStyle = '#7cc653';
  for (let k = 0; k < w; k += 26) { x.beginPath(); x.arc(k + 8, hz - 4, 16, Math.PI, 0); x.fill(); }
  // 人行道（透視）
  g = x.createLinearGradient(0, hz, 0, h);
  g.addColorStop(0, '#e9e2d4'); g.addColorStop(1, '#d6cbb6');
  x.fillStyle = g; x.fillRect(0, hz, w, h - hz);
  x.strokeStyle = '#c4b89f'; x.lineWidth = 1.5;
  for (let k = 1; k < 12; k++) { const t = k / 12, y = hz + (h - hz) * t * t; x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); }
  for (let k = -6; k <= 6; k++) { x.beginPath(); x.moveTo(w / 2 + k * w * 0.05, hz); x.lineTo(w / 2 + k * w * 0.32, h); x.stroke(); }
  // 路緣與馬路
  x.fillStyle = '#9aa3a8'; x.beginPath(); x.moveTo(0, hz + 4); x.lineTo(w * 0.18, hz); x.lineTo(0, h * 0.78); x.fill();
  x.fillStyle = '#b9c1c4'; x.beginPath(); x.moveTo(0, h * 0.78); x.lineTo(w * 0.18, hz); x.lineTo(w * 0.2, hz); x.lineTo(w * 0.04, h); x.lineTo(0, h); x.fill();
}

/* ---------- 樹 ---------- */
function shade(hex, a) { // a>0 變亮，a<0 變暗
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = a < 0 ? 0 : 255, p = Math.abs(a);
  r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
  return `rgb(${r},${g},${b})`;
}
// 樹冠分層：每層一組橢圓 [dx, dy, rx, ry]，單位＝樹高，原點在樹冠中心
const ROUND = [
  [[-0.21, 0.04, 0.2, 0.18], [0.21, 0.04, 0.2, 0.18], [0, -0.12, 0.26, 0.22]],
  [[-0.13, 0.07, 0.17, 0.15], [0.15, 0.05, 0.16, 0.14], [0, -0.06, 0.2, 0.17]],
  [[-0.12, -0.17, 0.13, 0.08], [0.06, -0.21, 0.1, 0.06], [0.2, -0.04, 0.07, 0.06]],
];
const SHAPES = {
  zhang: { cy: 0.64, layers: ROUND },
  luan: { cy: 0.64, layers: [
    [[-0.24, 0.05, 0.17, 0.15], [0.24, 0.03, 0.17, 0.15], [-0.08, -0.14, 0.2, 0.17], [0.12, -0.1, 0.18, 0.16]],
    [[-0.15, 0.06, 0.14, 0.12], [0.16, 0.07, 0.13, 0.11], [0.02, -0.06, 0.17, 0.14]],
    [[-0.13, -0.19, 0.12, 0.07], [0.04, -0.22, 0.09, 0.05], [0.22, -0.05, 0.07, 0.05]],
  ], dots: ['#f2b73a', '#e8792f', '#f5cf4a'] },
  jiadong: { cy: 0.66, layers: [
    [[-0.33, 0.05, 0.2, 0.11], [0.33, 0.05, 0.2, 0.11], [0, -0.04, 0.38, 0.15]],
    [[-0.19, 0.0, 0.22, 0.11], [0.2, 0.01, 0.2, 0.1], [0, -0.11, 0.25, 0.11]],
    [[-0.16, -0.15, 0.17, 0.06], [0.08, -0.17, 0.12, 0.05], [0.3, -0.04, 0.08, 0.04]],
  ] },
  guangla: { cy: 0.63, alpha: 0.82, layers: [
    [[-0.19, 0.05, 0.19, 0.17], [0.2, 0.02, 0.18, 0.17], [0, -0.13, 0.24, 0.2]],
    [[-0.11, 0.06, 0.15, 0.13], [0.14, 0.03, 0.14, 0.12], [0.02, -0.08, 0.17, 0.14]],
    [[-0.07, -0.14, 0.12, 0.09], [0.1, -0.18, 0.1, 0.08], [0.16, -0.02, 0.08, 0.06]],
  ], dots: ['#e6ffd0', '#fffbe0'] },
  shanlan: { cy: 0.6, layers: [
    [[0, 0.1, 0.25, 0.13], [0, -0.07, 0.2, 0.13], [0, -0.22, 0.14, 0.11], [0, -0.33, 0.08, 0.08]],
    [[0, 0.08, 0.19, 0.09], [0, -0.09, 0.15, 0.09], [0, -0.24, 0.1, 0.08]],
    [[-0.06, 0.0, 0.08, 0.05], [-0.05, -0.17, 0.06, 0.04]],
  ] },
  shuihuang: { cy: 0.64, layers: [
    [[-0.25, 0.05, 0.19, 0.15], [0.25, 0.05, 0.19, 0.15], [0, -0.1, 0.28, 0.19]],
    [[-0.14, 0.06, 0.16, 0.12], [0.16, 0.05, 0.15, 0.12], [0, -0.05, 0.2, 0.14]],
    [[-0.14, -0.15, 0.13, 0.07], [0.05, -0.19, 0.1, 0.05], [0.24, -0.02, 0.07, 0.05]],
  ], dots: ['#9a7fd1', '#b9a3ea', '#7f62c4'] },
};
function rng(seed) { let h = seed; return () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; }; }
const DOTS = {};
for (const [id, sh] of Object.entries(SHAPES)) {
  if (!sh.dots) continue;
  const r = rng(id.length * 7919 + id.charCodeAt(0)), L = sh.layers[1].concat(sh.layers[0]); DOTS[id] = [];
  for (let i = 0; i < 26; i++) {
    const b = L[Math.floor(r() * L.length)], a = r() * 6.283, d = Math.sqrt(r()) * 0.85;
    DOTS[id].push([b[0] + Math.cos(a) * b[2] * d, b[1] + Math.sin(a) * b[3] * d, sh.dots[i % sh.dots.length], 0.012 + r() * 0.01]);
  }
}
const clamp = (v) => Math.max(0, Math.min(1, v));
const elastic = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1);
const back = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// 在 (x, y)＝樹根，完整樹高 fullH，成長進度 p（0 幼苗 → 1 大樹）
function drawTree(x, X, Y, fullH, p, id) {
  const sp = speciesById(id), sh = SHAPES[sp.id] || SHAPES.zhang;
  const h = fullH * (0.16 + 0.84 * back(clamp(p / 0.75)));
  const ls = sh.layers.map((_, i) => elastic(clamp((p - 0.1 - i * 0.17) / 0.45)));
  const cx = X, cy = Y - h * sh.cy;
  // 地上陰影
  const sr = h * (sp.id === 'jiadong' ? 0.55 : 0.42) * (0.25 + 0.75 * Math.max(ls[0], 0.1));
  x.fillStyle = '#17405e33'; x.beginPath(); x.ellipse(X, Y, sr, sr * 0.22, 0, 0, 7); x.fill();
  // 樹幹
  const tw = Math.max(3, h * 0.065), top = Y - h * (sh.cy - 0.02);
  x.fillStyle = '#8a5a3b';
  x.beginPath(); x.moveTo(X - tw / 2, Y); x.quadraticCurveTo(X - tw * 0.3, (Y + top) / 2, X - tw * 0.22, top); x.lineTo(X + tw * 0.22, top); x.quadraticCurveTo(X + tw * 0.3, (Y + top) / 2, X + tw / 2, Y); x.fill();
  x.fillStyle = '#6e4429'; x.fillRect(X + tw * 0.05, top, tw * 0.17, Y - top);
  x.strokeStyle = '#8a5a3b'; x.lineCap = 'round'; x.lineWidth = Math.max(2, h * 0.022);
  const by = Y - h * (sh.cy * 0.55);
  x.beginPath(); x.moveTo(X, by); x.lineTo(X - h * 0.13 * ls[0], by - h * 0.14); x.moveTo(X, by - h * 0.05); x.lineTo(X + h * 0.12 * ls[0], by - h * 0.18); x.stroke();
  // 幼苗兩片葉
  const sprout = 1 - clamp(ls[0] * 1.6);
  if (sprout > 0) {
    x.fillStyle = shade(sp.leaf, 0.1);
    for (const s of [-1, 1]) { x.beginPath(); x.ellipse(X + s * h * 0.12, top - h * 0.02, h * 0.13 * sprout + 1, h * 0.06 * sprout + 1, s * -0.5, 0, 7); x.fill(); }
  }
  // 樹冠（後 → 前，暗 → 亮）
  const tones = [shade(sp.leaf, -0.3), sp.leaf, shade(sp.leaf, 0.16)];
  x.save(); if (sh.alpha) x.globalAlpha *= sh.alpha;
  sh.layers.forEach((L, i) => {
    const s = ls[i]; if (s <= 0.001) return;
    x.fillStyle = tones[i]; x.beginPath();
    for (const [dx, dy, rx, ry] of L) { const ex = cx + dx * h * s, ey = cy + dy * h * s; x.moveTo(ex + rx * h * s, ey); x.ellipse(ex, ey, rx * h * s, ry * h * s, 0, 0, 7); }
    x.fill();
  });
  x.restore();
  // 花點／透光點
  const ds = DOTS[sp.id], dp = clamp((p - 0.7) / 0.25);
  if (ds && dp > 0) {
    ds.forEach(([dx, dy, c, r], i) => {
      const k = clamp(dp * 1.6 - (i / ds.length) * 0.6); if (k <= 0) return;
      x.fillStyle = c; x.beginPath(); x.arc(cx + dx * h, cy + dy * h, r * h * elastic(k), 0, 7); x.fill();
    });
  }
}

/* ---------- 真的樹照片（去背 PNG，../wish-trees.json） ---------- */
// 成樹高度比例：茄苳、樟樹最高，水黃皮最矮
const SP_H = { jiadong: 1, zhang: 1, luan: 0.92, guangla: 0.88, shanlan: 0.85, shuihuang: 0.78 };
const PHOTO = {}; // id → { img, rootX }
fetch('../wish-trees.json').then((r) => (r.ok ? r.json() : [])).then((list) => {
  for (const t of list || []) {
    if (!t || !t.id || !t.file) continue;
    const img = new Image();
    img.onload = () => { PHOTO[t.id] = { img, rootX: Number.isFinite(+t.rootX) ? +t.rootX : 0.5 }; };
    img.src = '../' + String(t.file).replace(/^\.?\//, '');
  }
}).catch(() => {});
// 沒有陀螺儀時的樹高（螢幕固定）：依樹種成樹高度，錨點越靠畫面下方（越近）越大
function treeH(T) {
  const d = clamp((T.sy - H * 0.45) / (H * 0.5));
  return Math.min(T.sy * 0.92, H * 0.62 * (SP_H[S.sp] || 0.9) * (0.55 + 0.45 * d));
}
const popEase = (t) => { const c1 = 0.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }; // ease-out＋落定輕彈
// 前三階段通用圖（../wish-stages.json）；三張都載入才用，否則退回只用成樹照
const STAGES = [];
fetch('../wish-stages.json').then((r) => (r.ok ? r.json() : [])).then((list) => {
  const want = (list || []).filter((t) => t && t.file && +t.heightM > 0).sort((a, b) => a.stage - b.stage).slice(0, 3);
  if (want.length < 3) return;
  const got = [];
  want.forEach((t, i) => {
    const img = new Image();
    img.onload = () => { got[i] = { img, rootX: Number.isFinite(+t.rootX) ? +t.rootX : 0.5, m: +t.heightM }; if (got.filter(Boolean).length === 3) STAGES.push(...got); };
    img.src = '../' + String(t.file).replace(/^\.?\//, '');
  });
}).catch(() => {});
const staged = () => STAGES.length === 3 && !!PHOTO[S.sp];
const STAGE_TOTAL = STAGE_MS.reduce((a, b) => a + b, 0);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
function drawImg(x, X, Y, h, img, rootX, a) {
  const w = h * (img.naturalWidth / img.naturalHeight);
  x.save(); x.globalAlpha *= a; x.drawImage(img, X - rootX * w, Y - h, w, h); x.restore();
  return w;
}
// 四階段長大：ms＝按快門後經過時間；pxPerM＝這個距離下每公尺幾 px
function drawStaged(x, X, Y, pxPerM, ms) {
  const ph = PHOTO[S.sp], segs = [...STAGES, { img: ph.img, rootX: ph.rootX, m: TREE_M[S.sp] || 8 }];
  let i = 0, t0 = 0;
  while (i < segs.length - 1 && ms >= t0 + STAGE_MS[i]) { t0 += STAGE_MS[i]; i++; }
  const u = clamp((ms - t0) / STAGE_MS[i]), last = i === segs.length - 1;
  const from = i === 0 ? segs[0].m * 0.3 : segs[i - 1].m, to = segs[i].m;
  const h = (from + (to - from) * (last ? popEase(u) : easeOut(u))) * pxPerM;
  const k = i > 0 ? clamp((ms - t0) / XF_MS) : 1;
  const w = h * (segs[i].img.naturalWidth / segs[i].img.naturalHeight);
  x.fillStyle = '#17405e2e'; x.beginPath(); x.ellipse(X, Y, w * 0.36, w * 0.07, 0, 0, 7); x.fill();
  if (k < 1) drawImg(x, X, Y, h, segs[i - 1].img, segs[i - 1].rootX, 1 - k); // 上一張以相同螢幕高度淡出
  drawImg(x, X, Y, h, segs[i].img, segs[i].rootX, k);
  const [y0, y1] = STAGE_YR[i];
  return Math.round(y0 + (y1 - y0) * u);
}
function drawPhoto(x, X, Y, h, s, ph) {
  const iw0 = ph.img.naturalWidth, ih0 = ph.img.naturalHeight;
  let ih = h * s, iw = ih * (iw0 / ih0);
  x.fillStyle = '#17405e2e'; x.beginPath(); x.ellipse(X, Y, iw * 0.36, iw * 0.07, 0, 0, 7); x.fill();
  x.drawImage(ph.img, X - ph.rootX * iw, Y - ih, iw, ih);
}
// 畫一棵樹：有照片畫照片（p＝放大進度），沒有就退回幾何樹（p＝成長進度）
function drawAny(x, X, Y, h, p) {
  const ph = PHOTO[S.sp];
  if (ph) drawPhoto(x, X, Y, h, 0.25 + 0.75 * popEase(p), ph);
  else drawTree(x, X, Y, h, p, S.sp);
}

/* ---------- 姿態：四元數，W3C deviceorientation 的 Z-X'-Y'' ---------- */
const D2R = Math.PI / 180;
const qMul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
const qAxis = (ax, deg) => { const h = deg * D2R / 2, s = Math.sin(h); return [Math.cos(h), ax === 0 ? s : 0, ax === 1 ? s : 0, ax === 2 ? s : 0]; };
function qEuler(a, b, g) {
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  return qMul(qMul(qMul(qAxis(2, a), qAxis(0, b)), qAxis(1, g)), qAxis(2, -ang));
}
function qRot(q, v) { // q v q*
  const [w, x, y, z] = q, [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const qConj = (q) => [q[0], -q[1], -q[2], -q[3]];
function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) { const r = a.map((v, i) => v + (b[i] - v) * t), n = Math.hypot(...r); return r.map((v) => v / n); }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + b[i] * wb);
}
// 空間模型：世界座標 x 東、y 北、z 上，手機在原點、離地 1.5 m；樹是地面上一點，畫成直立看板
const CAM_H = 1.5, NEAR = 6, FAR = 20, MID = 10;
const TREE_M = { jiadong: 9, zhang: 9, luan: 8, guangla: 7.5, shanlan: 7, shuihuang: 6.5 }; // 成樹高度（公尺）
const toDir = (sx, sy) => qRot(S.q, [sx - W / 2, -(sy - H / 2), -S.F]);
// 螢幕點的射線打地面：打不到（抬頭）或超過 20 m 就放正前方 10 m，太近夾到 6 m
function groundFrom(sx, sy) {
  const d = toDir(sx, sy), n = Math.hypot(d[0], d[1], d[2]), u = d.map((v) => v / n);
  let hx = u[0], hy = u[1], hz = Math.hypot(hx, hy);
  if (hz < 0.05) { const f = qRot(S.q, [0, 1, 0]); hx = f[0]; hy = f[1]; hz = Math.hypot(hx, hy) || 1; } // 正對地面或天空：用手機上緣方向
  let dist = u[2] < -0.01 ? (CAM_H * hz) / -u[2] : MID;
  if (dist > FAR) dist = MID;
  dist = Math.max(NEAR, dist);
  return [(hx / hz) * dist, (hy / hz) * dist, -CAM_H];
}
function anchor(sx, sy, auto) { const T = S.tree; T.sx = sx; T.sy = sy; T.auto = !!auto; T.g = S.q ? groundFrom(auto ? W / 2 : sx, auto ? H / 2 : sy) : null; }
// 回傳樹根的螢幕位置與樹的螢幕高度；在背後就回 null
function treePos() {
  const T = S.tree;
  if (S.q && !T.g) T.g = groundFrom(T.auto ? W / 2 : T.sx, T.auto ? H / 2 : T.sy); // 陀螺儀比樹晚到：補錨定
  if (!T.g) return { x: T.sx, y: T.sy, h: treeH(T) };
  const c = qRot(qConj(S.q), T.g), depth = -c[2];
  if (depth < 0.5) return null;
  return { x: W / 2 + (S.F * c[0]) / depth, y: H / 2 - (S.F * c[1]) / depth, h: (S.F * (TREE_M[S.sp] || 8)) / depth };
}

/* ---------- 繪製迴圈 ---------- */
const tx = tv.getContext('2d');
let lastNow = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - (lastNow || now)) / 1000); lastNow = now;
  if (S.qT) { const had = !!S.q; S.q = had ? qSlerp(S.q, S.qT, Math.min(1, dt * 10)) : S.qT; if (!had) badges(); }
  tx.setTransform(DPR, 0, 0, DPR, 0, 0); tx.clearRect(0, 0, W, H);
  const T = S.tree; if (!T) return;
  const P = treePos(); if (!P) return;
  const X = P.x, Y = P.y;
  if (T.preview) { tx.globalAlpha = 0.5; drawAny(tx, X, Y, P.h, 1); tx.globalAlpha = 1; return; }
  let yr;
  if (staged()) {
    T.p = clamp((now - T.t0) / STAGE_TOTAL);
    yr = drawStaged(tx, X, Y, P.h / (TREE_M[S.sp] || 8), now - T.t0);
  } else {
    T.p = clamp((now - T.t0) / (PHOTO[S.sp] ? POP_MS : GROW_MS));
    drawAny(tx, X, Y, P.h, T.p);
    yr = 1 + Math.floor(T.p * 9.999);
  }
  // 年數
  if (yr !== S.lastYear) { S.lastYear = yr; const el = $('#year'); el.innerHTML = `第<b>${yr}</b>年<i class="sy">示意</i>`; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }
  // 落葉與光點
  if (!RM && T.p > 0.45 && Math.random() < (T.p < 1 ? 0.35 : 0.06)) {
    const leaf = Math.random() < 0.6, sp = speciesById(S.sp);
    S.parts.push({ x: (Math.random() - 0.5) * P.h * 0.6, y: -P.h * (0.5 + Math.random() * 0.35), vx: (Math.random() - 0.5) * 0.4, vy: leaf ? 0.6 + Math.random() * 0.5 : -0.3 - Math.random() * 0.4, r: Math.random() * 6.28, life: 1, leaf, c: leaf ? sp.leaf : '#fff7c2' });
  }
  for (const q of S.parts) {
    q.x += q.vx + (q.leaf ? Math.sin(now / 300 + q.r) * 0.6 : 0); q.y += q.vy; q.r += 0.04; q.life -= q.leaf ? 0.006 : 0.015;
    if (q.leaf && q.y > 0) { q.y = 0; q.vy = 0; q.vx = 0; }
    tx.globalAlpha = Math.max(0, Math.min(1, q.life * 1.5));
    tx.fillStyle = q.c;
    tx.beginPath();
    if (q.leaf) tx.ellipse(X + q.x, Y + q.y, 5, 2.4, q.r, 0, 7); else tx.arc(X + q.x, Y + q.y, 2.2 + Math.sin(now / 120 + q.r) * 1, 0, 7);
    tx.fill();
  }
  tx.globalAlpha = 1;
  S.parts = S.parts.filter((q) => q.life > 0).slice(-80);
  if (T.p >= 1 && S.phase === 'grow') { S.phase = 'shot'; shoot(P); }
}

/* ---------- 徽章、提示 ---------- */
function badges() {
  const b = [];
  if (!S.cam) b.push('<span class="badge sim">模擬</span>');
  if (S.defaultLoc) b.push('<span class="badge">預設位置</span>');
  if (S.q && (S.phase === 'pick' || S.phase === 'grow')) b.push('<span class="badge">站著別走，轉手機看</span>');
  $('#badges').innerHTML = S.phase === 'intro' ? '' : b.join('');
}
let hintT = 0;
function hint(t, ms = 2600) { const h = $('#hint'); h.textContent = t; h.classList.add('show'); clearTimeout(hintT); if (ms) hintT = setTimeout(() => h.classList.remove('show'), ms); }

/* ---------- 樹種卡片 ---------- */
function icon(sp) {
  const dots = SHAPES[sp.id] && SHAPES[sp.id].dots;
  const d = dots ? `<circle cx="18" cy="22" r="3" fill="${dots[0]}"/><circle cx="33" cy="16" r="3" fill="${dots[1]}"/><circle cx="35" cy="28" r="3" fill="${dots[0]}"/>` : '';
  const crown = sp.id === 'shanlan'
    ? `<path d="M26 4 C34 14 40 24 40 34 Q26 40 12 34 C12 24 18 14 26 4Z" fill="${sp.leaf}"/>`
    : sp.id === 'jiadong'
      ? `<ellipse cx="26" cy="22" rx="23" ry="12" fill="${sp.leaf}"/><ellipse cx="22" cy="17" rx="10" ry="5" fill="#ffffff40"/>`
      : `<circle cx="16" cy="26" r="11" fill="${sp.leaf}"/><circle cx="36" cy="26" r="11" fill="${sp.leaf}"/><circle cx="26" cy="16" r="13" fill="${sp.leaf}"/><circle cx="22" cy="12" r="5" fill="#ffffff40"/>`;
  return `<svg viewBox="0 0 52 52" aria-hidden="true"><ellipse cx="26" cy="48" rx="16" ry="3" fill="#17405e22"/><rect x="23.5" y="28" width="5" height="20" rx="2" fill="#8a5a3b"/>${crown}${d}</svg>`;
}
function renderCards() {
  $('#cards').innerHTML = SPECIES.map((sp) => `<button class="card" type="button" role="option" data-id="${sp.id}" aria-selected="${sp.id === S.sp}">${icon(sp)}<b>${sp.name}</b><small>${sp.note}</small></button>`).join('');
}
$('#cards').addEventListener('click', (e) => {
  const c = e.target.closest('.card'); if (!c) return;
  S.sp = c.dataset.id;
  for (const k of document.querySelectorAll('.card')) k.setAttribute('aria-selected', k.dataset.id === S.sp);
});

/* ---------- 開始：方向權限（同步）、相機、GPS ---------- */
// 只聽 deviceorientation 一個來源，兩個來源交替餵值會抖
function onOri(e) { if (e.alpha == null) return; S.qT = qEuler(e.alpha, e.beta || 0, e.gamma || 0); }
$('#go').addEventListener('click', () => {
  // iOS：requestPermission 必須在這次點擊裡同步呼叫，排在任何 await 之前
  let pOri = null;
  try { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') pOri = DeviceOrientationEvent.requestPermission(); } catch (e) { pOri = null; }
  let pCam = null;
  if (window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    pCam = navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = p.coords.latitude, lng = p.coords.longitude;
        // 不在台北市就改用預設位置，上傳才不會被後端擋
        const inTaipei = lat > 24.95 && lat < 25.22 && lng > 121.45 && lng < 121.67;
        S.loc = inTaipei ? { lat, lng } : { ...DEFAULT_LOC }; S.defaultLoc = !inTaipei; S.geoDone = true; badges();
      },
      () => { S.loc = { ...DEFAULT_LOC }; S.defaultLoc = true; S.geoDone = true; badges(); },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 });
  } else { S.loc = { ...DEFAULT_LOC }; S.defaultLoc = true; S.geoDone = true; }
  toPick();
  (async () => {
    if (pOri) { try { await pOri; } catch (e) {} }
    if (window.DeviceOrientationEvent) addEventListener('deviceorientation', onOri);
    if (pCam) {
      try { const st = await pCam; video.srcObject = st; await video.play().catch(() => {}); S.cam = true; app.classList.add('cam'); calcF(); } catch (e) { S.cam = false; }
    }
    badges();
  })();
});

function toPick() {
  S.phase = 'pick'; S.parts = []; S.lastYear = 0;
  const sy = H * 0.62;
  S.tree = { p: 1, preview: true };
  anchor(W / 2, sy, true);
  app.className = 'pick' + (S.cam ? ' cam' : '');
  $('#year').classList.remove('show');
  badges(); renderCards();
  hint('點畫面移動樹，按快門種下', 0);
}

/* ---------- 預覽時點畫面換位置；按快門才長大 ---------- */
app.addEventListener('click', (e) => {
  if (S.phase !== 'pick') return;
  if (e.target.closest('#pick, button, a')) return;
  const r = app.getBoundingClientRect();
  const y = e.clientY - r.top;
  anchor(e.clientX - r.left, S.q ? y : Math.max(H * 0.45, y)); // 有陀螺儀就交給打地面的規則夾距離
});
$('#shut').addEventListener('click', (e) => {
  e.stopPropagation();
  if (S.phase !== 'pick' || !S.tree) return;
  S.phase = 'grow';
  app.classList.remove('pick');
  Object.assign(S.tree, { preview: false, p: 0, t0: performance.now() });
  $('#year').classList.add('show');
  $('#hint').classList.remove('show');
  badges();
});

/* ---------- 快門：相機畫面＋樹合成 ---------- */
function compose(longSide, q) {
  const k = longSide / Math.max(W, H), cw = Math.round(W * k), ch = Math.round(H * k);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d');
  if (S.cam && video.videoWidth) { // 跟 object-fit: cover 一樣的裁切
    const vw = video.videoWidth, vh = video.videoHeight, s = Math.max(cw / vw, ch / vh);
    x.drawImage(video, (cw - vw * s) / 2, (ch - vh * s) / 2, vw * s, vh * s);
  } else { x.setTransform(k, 0, 0, k, 0, 0); drawStreet(x, W, H); x.setTransform(1, 0, 0, 1, 0, 0); }
  const T = S.tree, P = treePos() || { x: T.sx, y: T.sy, h: treeH(T) };
  x.setTransform(k, 0, 0, k, 0, 0); drawAny(x, P.x, P.y, P.h, 1); x.setTransform(1, 0, 0, 1, 0, 0);
  // 浮水印
  const fs = Math.round(ch * 0.02), bh = fs * 2.4;
  x.fillStyle = '#ffffffd9'; x.fillRect(0, ch - bh, cw, bh);
  x.fillStyle = '#17405e'; x.font = `700 ${fs}px Huninn, "Noto Sans TC", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  const d = new Date(), ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  x.fillText(`許願這裡有一棵樹｜${speciesById(S.sp).name}｜${ds}`, cw / 2, ch - bh / 2);
  return c;
}
function jpeg(c, q, maxBytes) {
  let u = c.toDataURL('image/jpeg', q);
  while (maxBytes && u.length * 0.75 > maxBytes && q > 0.4) { q -= 0.1; u = c.toDataURL('image/jpeg', q); }
  return u;
}
const geoReady = () => new Promise((res) => { if (S.geoDone) return res(); const t0 = Date.now(); const iv = setInterval(() => { if (S.geoDone || Date.now() - t0 > 6500) { clearInterval(iv); res(); } }, 100); });

// 長大後自動拍：相機畫面＋實心樹合成、上傳
async function shoot() {
  const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  const big = compose(1280), photo = jpeg(big, 0.8, 500 * 1024);
  const thumb = jpeg(compose(360), 0.6);
  app.classList.remove('grown');
  hint('上傳中…', 0);
  await geoReady();
  if (!S.loc) { S.loc = { ...DEFAULT_LOC }; S.defaultLoc = true; }
  const ev = await postWish('../../', { lat: S.loc.lat, lng: S.loc.lng, species: S.sp, defaultLoc: S.defaultLoc, photo, thumb });
  const total = addPoints(WISH_POINTS);
  showDone(photo, ev, total);
}

/* ---------- 完成 ---------- */
const cellOf = (lat, lng) => Math.floor((lng * 100850) / CELL_M) + ',' + Math.floor((lat * 110900) / CELL_M);
async function showDone(photo, ev, total) {
  $('#hint').classList.remove('show');
  S.phase = 'done'; app.className = 'done' + (S.cam ? ' cam' : '');
  $('#photo').src = photo;
  const b = [];
  if (ev.src === 'local' || !S.cam) b.push('<span class="badge sim">模擬</span>');
  if (S.defaultLoc) b.push('<span class="badge">預設位置</span>');
  $('#dbadges').innerHTML = b.join('');
  $('#total').innerHTML = `共<b>${total}</b>點`;
  const g = $('#gain'); g.innerHTML = `<b>+${WISH_POINTS}</b> 點`; g.classList.remove('show'); void g.offsetWidth; g.classList.add('show');
  $('#pn').textContent = '…'; $('#pb').style.width = '0';
  let n = 1;
  try {
    const all = await getWishes('../../'), key = cellOf(+ev.lat || S.loc.lat, +ev.lng || S.loc.lng);
    n = Math.max(1, all.filter((w) => w && w.lat != null && cellOf(+w.lat, +w.lng) === key).length);
  } catch (e) {}
  $('#pn').textContent = `${Math.min(n, GOAL)} / ${GOAL}`;
  requestAnimationFrame(() => { $('#pb').style.width = Math.min(100, (n / GOAL) * 100) + '%'; });
}
$('#again').addEventListener('click', () => { $('#done').scrollTop = 0; toPick(); });

/* ---------- 啟動 ---------- */
resize();
requestAnimationFrame(loop);
