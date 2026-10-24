// 模擬許願：約 300 筆，固定種子，每次產生的結果都一樣。畫面一律標「模擬」。
// 集中在東門市場街區（最密）、和平東路一段沿線、四個捷運站周邊。
const KX = 100850, KY = 110900;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 樹種權重：臺灣欒樹與茄苳較多
const WEIGHTS = [['luan', 3.2], ['jiadong', 3], ['zhang', 1.4], ['guangla', 1], ['shanlan', 0.7], ['shuihuang', 1.2]];
const WSUM = WEIGHTS.reduce((s, w) => s + w[1], 0);

// spot：中心點周圍常態分布（sigma 公尺）；band：沿東西向帶狀
const CLUSTERS = [
  { name: '東門市場', lat: 25.0347, lng: 121.527, n: 120, sigma: 85 },
  { name: '和平東路一段', band: [121.5225, 121.534], lat: 25.0262, n: 70, sigma: 14 },
  { name: '捷運古亭站', lat: 25.0263, lng: 121.5229, n: 28, sigma: 75 },
  { name: '捷運東門站', lat: 25.0339, lng: 121.5287, n: 27, sigma: 75 },
  { name: '捷運台電大樓站', lat: 25.0207, lng: 121.5283, n: 28, sigma: 75 },
  { name: '捷運大安森林公園站', lat: 25.0331, lng: 121.5355, n: 27, sigma: 75 },
];

let cache = null;
export function simWishes() {
  if (cache) return cache;
  const r = mulberry32(20261024);
  const gauss = () => { const u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pick = () => { let x = r() * WSUM; for (const [id, w] of WEIGHTS) { if ((x -= w) <= 0) return id; } return WEIGHTS[0][0]; };
  const out = [];
  for (const c of CLUSTERS) {
    for (let i = 0; i < c.n; i++) {
      const lng = c.band ? c.band[0] + r() * (c.band[1] - c.band[0]) : c.lng + (gauss() * c.sigma) / KX;
      const lat = c.lat + (gauss() * c.sigma) / KY;
      out.push({ id: `sim-${out.length}`, lat: +lat.toFixed(6), lng: +lng.toFixed(6), species: pick(), photo: r() < 0.35, src: 'sim' });
    }
  }
  return (cache = out);
}
