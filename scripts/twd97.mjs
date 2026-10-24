// TWD97 TM2（中央經線 121°E）→ WGS84 經緯度。GRS80 橢球；TWD97 與 WGS84 差異在公分級，demo 用可忽略。
const a = 6378137.0, f = 1 / 298.257222101, b = a * (1 - f);
const e2 = 1 - (b * b) / (a * a), ep2 = e2 / (1 - e2);
const k0 = 0.9999, lon0 = (121 * Math.PI) / 180, dx = 250000;
export function twd97ToWgs84(x, y) {
  x -= dx;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const fp = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(fp) ** 2, T1 = Math.tan(fp) ** 2;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * Math.sin(fp) ** 2, 1.5);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(fp) ** 2);
  const D = x / (N1 * k0);
  const lat = fp - ((N1 * Math.tan(fp)) / R1) * (D * D / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(fp);
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}
