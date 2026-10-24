// 比對臺北市行道樹三期快照，輸出前端用的差異點與統計。
// 用法：node scripts/tree-diff.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { twd97ToWgs84 } from './twd97.mjs';

const ROOT = '/Users/yo/workspace/shade-hackathon';
const RAW = path.join(ROOT, 'data/raw');
const OUT = new URL('../app/data/tree-diff.json', import.meta.url);
export const REID_RADIUS_M = 3;
export const EMPTY_RADIUS_M = 5;

const snapshots = [
  { key: '2022', date: '2022-10-15', file: path.join(RAW, '2022-10-15-wayback/TaipeiTree.xml'), format: 'xml', diameterScale: 100,
    source: 'https://web.archive.org/web/20221015231338id_/https://tppkl.blob.core.windows.net/blobfs/TaipeiTree.xml' },
  { key: '2024', date: '2024-11-21', file: path.join(RAW, '2024-11-21-wayback/TaipeiTree.csv'), format: 'csv', diameterScale: 1,
    source: 'https://web.archive.org/web/20241121065019id_/https://tppkl.blob.core.windows.net/blobfs/TaipeiTree.csv' },
  { key: '2026', date: '2026-10-13', file: path.join(RAW, '2026-10-13/TaipeiTree.csv'), format: 'csv', diameterScale: 1,
    source: 'https://tppkl.blob.core.windows.net/blobfs/TaipeiTree.csv' },
];
const archiveCheck = { key: '2026-09', date: '2026-09-19', file: path.join(RAW, '2026-09-19-wayback/TaipeiTree.xml'), format: 'xml', diameterScale: 1,
  source: 'https://web.archive.org/web/20260919232956id_/https://tppkl.blob.core.windows.net/blobfs/TaipeiTree.xml' };

function csvRows(text) {
  const rows = []; let row = [], field = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quote = false;
      else field += c;
    } else if (c === '"') quote = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map((x) => x.replace(/^\uFEFF/, '').trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (_, k) => k[0] === '#' ? String.fromCodePoint(k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)) : (entities[k] || _));
function xmlRows(text) {
  const out = [];
  for (const m of text.matchAll(/<Tree>([\s\S]*?)<\/Tree>/g)) {
    const r = {};
    for (const f of m[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) r[f[1]] = unescapeXml(f[2].trim());
    out.push(r);
  }
  return out;
}

function loadSnapshot(s) {
  const text = fs.readFileSync(s.file, 'utf8');
  const rows = s.format === 'xml' ? xmlRows(text) : csvRows(text);
  const trees = new Map(); let badCoordinates = 0, duplicateIds = 0;
  for (const r of rows) {
    const id = r.TreeID?.trim(), x = +(r.TWD97X || r.X), y = +(r.TWD97Y || r.Y);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) { badCoordinates++; continue; }
    if (trees.has(id)) duplicateIds++;
    const diameter = +(r.Diameter || 0) * s.diameterScale;
    trees.set(id, { id, dist: r.Dist || '', region: r.Region || '', remark: r.RegionRemark || '', species: r.TreeType || '未登錄',
      dbh: Number.isFinite(diameter) ? Math.round(diameter * 10) / 10 : null, height: +(r.TreeHeight || 0) || null,
      survey: (r.SurveyDate || '').slice(0, 10), x, y });
  }
  return { ...s, rows: rows.length, trees, badCoordinates, duplicateIds };
}

const cellKey = (x, y, size) => `${Math.floor(x / size)},${Math.floor(y / size)}`;
function gridOf(trees, size) {
  const g = new Map();
  for (const t of trees) { const k = cellKey(t.x, t.y, size); if (!g.has(k)) g.set(k, []); g.get(k).push(t); }
  return g;
}
function neighbors(grid, t, radius) {
  const cx = Math.floor(t.x / radius), cy = Math.floor(t.y / radius), out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const q of grid.get(`${cx + dx},${cy + dy}`) || []) {
      const d = Math.hypot(t.x - q.x, t.y - q.y); if (d <= radius) out.push([q, d]);
    }
  }
  return out.sort((a, b) => a[1] - b[1]);
}
const inc = (m, k) => m.set(k || '未登錄', (m.get(k || '未登錄') || 0) + 1);
const top = (m, n = 10) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant')).slice(0, n).map(([name, count]) => ({ name, count }));
const roundCoord = (n) => Math.round(n * 1e6) / 1e6;

function period(from, to) {
  const gone = [...from.trees.values()].filter((t) => !to.trees.has(t.id));
  const appeared = [...to.trees.values()].filter((t) => !from.trees.has(t.id));
  const newGrid3 = gridOf(appeared, REID_RADIUS_M);
  const candidates = [];
  for (const old of gone) for (const [fresh, distance] of neighbors(newGrid3, old, REID_RADIUS_M)) {
    if (old.species === fresh.species) candidates.push({ old, fresh, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const usedOld = new Set(), usedNew = new Set(), pairs = [];
  for (const c of candidates) if (!usedOld.has(c.old.id) && !usedNew.has(c.fresh.id)) {
    usedOld.add(c.old.id); usedNew.add(c.fresh.id); pairs.push(c);
  }

  const allTo5 = gridOf(to.trees.values(), EMPTY_RADIUS_M);
  const allFrom5 = gridOf(from.trees.values(), EMPTY_RADIUS_M);
  const removed = gone.filter((t) => !usedOld.has(t.id) && neighbors(allTo5, t, EMPTY_RADIUS_M).length === 0);
  const planted = appeared.filter((t) => !usedNew.has(t.id) && neighbors(allFrom5, t, EMPTY_RADIUS_M).length === 0);
  const districts = new Map(), regions = new Map();
  const bucket = (map, key) => { if (!map.has(key)) map.set(key, { disappeared: 0, appeared: 0, net: 0, suspectedRemoved: 0, suspectedNew: 0, suspectedRenumbered: 0 }); return map.get(key); };
  const add = (t, field, delta) => {
    for (const [m, k] of [[districts, t.dist || '未登錄'], [regions, `${t.dist || '未登錄'}｜${t.region || '未登錄'}`]]) {
      const b = bucket(m, k); b[field]++; b.net += delta;
    }
  };
  for (const t of gone) add(t, 'disappeared', -1);
  for (const t of appeared) add(t, 'appeared', 1);
  for (const t of removed) add(t, 'suspectedRemoved', 0);
  for (const t of planted) add(t, 'suspectedNew', 0);
  for (const { old } of pairs) add(old, 'suspectedRenumbered', 0);
  const speciesGone = new Map(), speciesNew = new Map(); gone.forEach((t) => inc(speciesGone, t.species)); appeared.forEach((t) => inc(speciesNew, t.species));
  const point = (t, type, extra = {}) => { const [lng, lat] = twd97ToWgs84(t.x, t.y); return { id: t.id, type, lng: roundCoord(lng), lat: roundCoord(lat), species: t.species, dbh: t.dbh, dist: t.dist, region: t.region, ...extra }; };
  const points = [
    ...removed.map((t) => point(t, 'suspected-removed')),
    ...planted.map((t) => point(t, 'suspected-new')),
    ...pairs.map(({ old, fresh, distance }) => point(old, 'suspected-renumbered', { newId: fresh.id, distance: Math.round(distance * 10) / 10 })),
  ];
  const rows = (m) => [...m].map(([name, x]) => ({ name, ...x })).sort((a, b) => b.disappeared + b.appeared - (a.disappeared + a.appeared) || a.name.localeCompare(b.name, 'zh-Hant'));
  return {
    id: `${from.key}-${to.key}`, from: from.key, to: to.key,
    summary: { continued: from.trees.size - gone.length, disappeared: gone.length, appeared: appeared.length, net: appeared.length - gone.length,
      suspectedRemoved: removed.length, suspectedNew: planted.length, suspectedRenumbered: pairs.length,
      disappearedNearOtherTree: gone.length - removed.length - pairs.length, appearedNearOtherTree: appeared.length - planted.length - pairs.length },
    districts: rows(districts), regions: rows(regions),
    species: { disappeared: top(speciesGone), appeared: top(speciesNew) }, points,
  };
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeWaybackManifest(s, count) {
  if (!s.file.includes('-wayback/')) return;
  const st = fs.statSync(s.file), manifest = path.join(path.dirname(s.file), 'manifest.json');
  const body = { downloaded: st.birthtime.toISOString(), files: [{ file: path.basename(s.file), source: s.source,
    original_url: 'https://tppkl.blob.core.windows.net/blobfs/TaipeiTree.xml', bytes: st.size, sha256: sha256(s.file), rows: count }] };
  fs.writeFileSync(manifest, JSON.stringify(body, null, 2) + '\n');
}

const data = snapshots.map(loadSnapshot);
for (const s of data) writeWaybackManifest(s, s.trees.size);
const check = loadSnapshot(archiveCheck);
writeWaybackManifest(check, check.trees.size);
const periods = [period(data[0], data[1]), period(data[1], data[2])];
const history = {};
const ids = new Set(data.flatMap((s) => [...s.trees.keys()]));
for (const id of ids) {
  const mask = data.reduce((m, s, i) => m | (s.trees.has(id) ? 1 << i : 0), 0);
  (history[mask] ||= []).push(id);
}
const output = {
  generated: new Date().toISOString(),
  sourceLine: '資料：臺北市行道樹開放資料，歷年版本取自網路時光機',
  thresholds: { reidentifiedSameSpeciesM: REID_RADIUS_M, noTreeNearbyM: EMPTY_RADIUS_M },
  snapshots: data.map((s) => ({ key: s.key, date: s.date, count: s.trees.size, rawRows: s.rows, duplicateIds: s.duplicateIds, badCoordinates: s.badCoordinates, source: s.source })),
  archiveCheck: { key: check.key, date: check.date, count: check.trees.size, source: check.source,
    sameIdsAs2026October: [...check.trees.keys()].filter((id) => data[2].trees.has(id)).length },
  periods, history,
};
fs.writeFileSync(OUT, JSON.stringify(output));
for (const p of periods) console.log(p.id, p.summary);
console.log('output', OUT.pathname, fs.statSync(OUT).size, 'bytes');
