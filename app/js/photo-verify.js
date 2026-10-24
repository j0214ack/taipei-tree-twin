// 照片定位比對：上傳前先讀 EXIF 裡的 GPS（只在瀏覽器裡讀），拿來判斷是不是拍這棵樹；
// 讀完之後照片會重新編碼，存檔與公開的版本不含任何 EXIF。

export const MATCH_RADIUS_M = 15; // 照片位置要在樹的登錄座標幾公尺內才算（城市裡手機 GPS 誤差常有 5–20 m）
export const CANDIDATE_RADIUS_M = 40;

export function distM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 只解析 JPEG 的 EXIF GPS（緯度、經度）；讀不到就回傳 null
export async function readExifGps(file) {
  const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (buf.byteLength < 4 || buf.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 < buf.byteLength) {
    const marker = buf.getUint16(off);
    const len = buf.getUint16(off + 2);
    if (marker === 0xffe1 && buf.getUint32(off + 4) === 0x45786966) return parseTiff(buf, off + 10);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    off += 2 + len;
  }
  return null;
}

function parseTiff(v, t) {
  try {
    const le = v.getUint16(t) === 0x4949;
    const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
    const ifd0 = u32(4);
    let gpsOff = null;
    for (let i = 0, n = u16(ifd0); i < n; i++) {
      const e = ifd0 + 2 + i * 12;
      if (u16(e) === 0x8825) gpsOff = u32(e + 8);
    }
    if (gpsOff == null) return null;
    const tags = {};
    for (let i = 0, n = u16(gpsOff); i < n; i++) {
      const e = gpsOff + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (type === 2) tags[tag] = String.fromCharCode(v.getUint8(t + e + 8));
      else if (type === 5 && count === 3) {
        const p = u32(e + 8);
        tags[tag] = [0, 1, 2].map((k) => u32(p + k * 8) / (u32(p + k * 8 + 4) || 1));
      }
    }
    if (!tags[2] || !tags[4]) return null;
    const deg = ([d, m, s]) => d + m / 60 + s / 3600;
    let lat = deg(tags[2]), lng = deg(tags[4]);
    if (tags[1] === 'S') lat = -lat;
    if (tags[3] === 'W') lng = -lng;
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
    return { lat, lng };
  } catch { return null; }
}

export function browserLocation(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

export function nearbyTrees(trees, lat, lng, r = CANDIDATE_RADIUS_M) {
  const dLat = r / 111000, dLng = r / 101000;
  const out = [];
  for (const t of trees) {
    if (Math.abs(t.lat - lat) > dLat || Math.abs(t.lng - lng) > dLng) continue;
    const d = distM(lat, lng, t.lat, t.lng);
    if (d <= r) out.push({ t, d });
  }
  return out.sort((a, b) => a.d - b.d);
}
