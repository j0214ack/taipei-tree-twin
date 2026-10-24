// 複查優先序：只用真實欄位算的「排複查順序」推估，不是病況診斷。
// 三項：久未調查（調查日期 ≤ 2016、空白或異常）、大胸徑（≥ 80 公分示意門檻）、褐根病常見寄主（榕樹）。

export const DEFAULT_W = { old: 40, big: 35, host: 25 };
export const LEVELS = [
  { label: '一般', color: '#9fb0a5' },
  { label: '優先 4', color: '#f2c14e' },
  { label: '優先 3', color: '#e8862b' },
  { label: '優先 2', color: '#c2362b' },
  { label: '優先 1（前 50 株）', color: '#6e0d0d' },
];

export function factors(t) {
  const year = t.survey ? +t.survey.slice(0, 4) : 0;
  return {
    old: !year || year <= 2016 ? 1 : 0,
    big: t.dbh >= 80 ? Math.min(1, 0.6 + (t.dbh - 80) / 200) : 0,
    host: t.species === '榕樹' ? 1 : 0,
    year,
  };
}

export function score(t, w) {
  const f = factors(t);
  const sum = w.old + w.big + w.host || 1;
  return Math.round((100 * (f.old * w.old + f.big * w.big + f.host * w.host)) / sum);
}

// 依名次分級：前 50 株、前 1%、前 5%、前 15%（且分數 > 0）
export function rankLevels(trees) {
  const idx = trees.map((t, i) => i).filter((i) => trees[i].rv > 0).sort((a, b) => trees[b].rv - trees[a].rv || (trees[b].dbh || 0) - (trees[a].dbh || 0));
  const n = trees.length, cut = [50, n * 0.01, n * 0.05, n * 0.15];
  for (const t of trees) t.rl = 0;
  idx.forEach((i, r) => { trees[i].rl = r < cut[0] ? 4 : r < cut[1] ? 3 : r < cut[2] ? 2 : r < cut[3] ? 1 : 0; });
  return idx;
}

export const daysSince = (survey) => (survey ? Math.floor((Date.now() - new Date(survey).getTime()) / 86400000) : null);
