// 樹木碳儲存與年吸存估算。輸入：胸徑 D（cm）、樹高 H（m）。
// AGB：Chave et al. 2014, Global Change Biology 20:3177–3190, Eq. 4
// https://doi.org/10.1111/gcb.12629
// AGB(kg) = 0.0673 × (rho × D² × H)^0.976
//
// 木材密度為 Zanne et al. 2009 Global Wood Density Database（Dryad 10.5061/dryad.234）
// 的物種紀錄算術平均（oven dry mass / fresh volume，g/cm³）。2026-10-24 由原始 XLS 實算。
// 榕樹採資料庫中的同物異名 Ficus retusa（現接受名 Ficus microcarpa）。
// 臺灣欒樹等找不到同種紀錄者不借用近緣種，一律使用 0.6 預設值。
//
// 地下部：root:shoot = 0.24；碳含量 0.47。來源：IPCC 2006 Guidelines for National
// Greenhouse Gas Inventories, Vol. 4, Ch. 4（熱帶預設係數）。CO2e = C × 44/12。

export const DEFAULT_WOOD_DENSITY = 0.6;
export const ROOT_SHOOT_RATIO = 0.24;
export const CARBON_FRACTION = 0.47;
export const CO2_C_RATIO = 44 / 12;

export const WOOD_DENSITY = Object.freeze({
  茄苳: 0.601664,       // Bischofia javanica, n=10
  光蠟樹: 0.6,         // Fraxinus griffithii, n=1
  榕樹: 0.542208,       // Ficus retusa (= Ficus microcarpa), n=5
  垂榕: 0.459461,       // Ficus benjamina, n=3
  苦楝: 0.437713,       // Melia azedarach, n=9
  黃連木: 0.684649,     // Pistacia chinensis, n=2
  樟樹: 0.487403,       // Cinnamomum camphora, n=5
  楓香: 0.488814,       // Liquidambar formosana, n=6
  白千層: 0.640229,     // Melaleuca leucadendra, n=6
  小葉欖仁: 0.569015,   // Terminalia mantaly, n=5
  水黃皮: 0.594648,     // Pongamia pinnata, n=4
  大花紫薇: 0.595,      // Lagerstroemia speciosa, n=2
  阿勃勒: 0.7982,       // Cassia fistula, n=6
  鳳凰木: 0.578625,     // Delonix regia, n=4
  黑板樹: 0.382079,     // Alstonia scholaris, n=10
  木棉: 0.313535,       // Bombax ceiba, n=4
  印度紫檀: 0.636303,   // Pterocarpus indicus, n=4
  大葉欖仁: 0.477939,   // Terminalia catappa, n=7
  黃槐: 0.565,          // Peltophorum pterocarpum, n=2
  芒果: 0.552532,       // Mangifera indica, n=6
});

// 詹為巽（2024）臺北市都市樹木重要效益評估之研究，表 4.16、4.17、4.20。
// RGR = a·D^b，換成年胸徑增量：delta D = a·D^(1+b)。D < 5 cm 不套用。
export const RGR = Object.freeze({
  茄苳: Object.freeze({ a: 1.4437, b: -1.266 }),
  樟樹: Object.freeze({ a: 1.5650, b: -1.379 }),
  楓香: Object.freeze({ a: 2.2842, b: -1.427 }),
});

export function woodDensityFor(species) {
  const value = WOOD_DENSITY[species];
  return Number.isFinite(value)
    ? { value, source: 'species', isDefault: false }
    : { value: DEFAULT_WOOD_DENSITY, source: 'default', isDefault: true };
}

export function annualDbhIncrement(species, dbhCm) {
  const d = Number(dbhCm);
  if (!Number.isFinite(d) || d < 5) return null;
  const rgr = RGR[species];
  return rgr ? rgr.a * Math.pow(d, 1 + rgr.b) : 0.8;
}

export function validDimensions(tree) {
  const dbh = Number(tree?.dbh);
  const height = Number(tree?.height);
  if (!Number.isFinite(dbh) || dbh <= 0) return { ok: false, reason: 'missingDbh' };
  if (dbh < 5) return { ok: false, reason: 'smallDbh' };
  if (dbh > 300) return { ok: false, reason: 'abnormalDbh' };
  if (!Number.isFinite(height) || height <= 0) return { ok: false, reason: 'missingHeight' };
  if (height > 80) return { ok: false, reason: 'abnormalHeight' };
  return { ok: true, dbh, height };
}

export function carbonAtDiameter(dbhCm, heightM, density) {
  const agbKg = 0.0673 * Math.pow(density * dbhCm * dbhCm * heightM, 0.976);
  const totalBiomassKg = agbKg * (1 + ROOT_SHOOT_RATIO);
  const carbonKg = totalBiomassKg * CARBON_FRACTION;
  return carbonKg * CO2_C_RATIO;
}

export function estimateTreeCarbon(tree) {
  const dims = validDimensions(tree);
  if (!dims.ok) return { ok: false, reason: dims.reason };
  const density = woodDensityFor(tree.species);
  const increment = annualDbhIncrement(tree.species, dims.dbh);
  const storedKgCo2e = carbonAtDiameter(dims.dbh, dims.height, density.value);
  const nextKgCo2e = carbonAtDiameter(dims.dbh + increment, dims.height, density.value);
  return {
    ok: true,
    storedKgCo2e,
    annualKgCo2e: Math.max(0, nextKgCo2e - storedKgCo2e),
    density: density.value,
    densitySource: density.source,
    densityDefault: density.isDefault,
    dbhIncrementCm: increment,
  };
}

export function summarizeCarbon(trees) {
  const skipped = { missingDbh: 0, smallDbh: 0, abnormalDbh: 0, missingHeight: 0, abnormalHeight: 0 };
  let used = 0;
  let defaultDensity = 0;
  let storedKgCo2e = 0;
  let annualKgCo2e = 0;
  for (const tree of trees || []) {
    const estimate = estimateTreeCarbon(tree);
    if (!estimate.ok) { skipped[estimate.reason]++; continue; }
    used++;
    if (estimate.densityDefault) defaultDensity++;
    storedKgCo2e += estimate.storedKgCo2e;
    annualKgCo2e += estimate.annualKgCo2e;
  }
  return {
    total: (trees || []).length,
    used,
    skipped,
    skippedTotal: (trees || []).length - used,
    defaultDensity,
    storedKgCo2e,
    annualKgCo2e,
    storedTCo2e: storedKgCo2e / 1000,
    annualTCo2e: annualKgCo2e / 1000,
    avgStoredKgCo2e: used ? storedKgCo2e / used : 0,
    avgAnnualKgCo2e: used ? annualKgCo2e / used : 0,
  };
}
