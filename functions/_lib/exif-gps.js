// 照片只保留 GPS（Yo 2026-10-24 13:44）：伺服器先剝掉所有 metadata（機型、序號、軟體、縮圖…），
// 只有通過「離樹 15 公尺內」比對的照片，才用比對過的座標寫回一個只含 GPS IFD 的最小 EXIF。
// 不寫 GPS 時間與高度。Node 與 Cloudflare Workers 共用，不依賴任何套件。

// 經緯度十進位 → 度分秒（RATIONAL×3）
function dms(v) {
  const a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60 * 10000);
  return [[d, 1], [m, 1], [s, 10000]];
}

// 回傳完整 APP1 區段（含 FFE1 標記與長度）
export function gpsApp1(lat, lng) {
  const tiff = new Uint8Array(140), dv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]); dv.setUint32(4, 8, true);           // 'II*\0'，IFD0 在 8
  dv.setUint16(8, 1, true);                                               // IFD0：1 筆（GPSInfo 指標）
  dv.setUint16(10, 0x8825, true); dv.setUint16(12, 4, true); dv.setUint32(14, 1, true); dv.setUint32(18, 26, true);
  dv.setUint32(22, 0, true);
  const ent = (o, tag, type, count, val) => { dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, count, true); val(o + 8); };
  dv.setUint16(26, 5, true);                                              // GPS IFD：5 筆
  ent(28, 0x0000, 1, 4, (o) => tiff.set([2, 3, 0, 0], o));                // GPSVersionID
  ent(40, 0x0001, 2, 2, (o) => tiff.set([lat >= 0 ? 0x4e : 0x53, 0], o)); // N／S
  ent(52, 0x0002, 5, 3, (o) => dv.setUint32(o, 92, true));                // GPSLatitude → 92
  ent(64, 0x0003, 2, 2, (o) => tiff.set([lng >= 0 ? 0x45 : 0x57, 0], o)); // E／W
  ent(76, 0x0004, 5, 3, (o) => dv.setUint32(o, 116, true));               // GPSLongitude → 116
  dv.setUint32(88, 0, true);
  const rat = (o, arr) => arr.forEach(([n, d], k) => { dv.setUint32(o + k * 8, n, true); dv.setUint32(o + k * 8 + 4, d, true); });
  rat(92, dms(lat)); rat(116, dms(lng));
  const len = 2 + 6 + tiff.length;
  const seg = new Uint8Array(2 + len);
  seg.set([0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]); // 'Exif\0\0'
  seg.set(tiff, 10);
  return seg;
}

// 剝掉 APP1–APP15 與註解；給座標時，在 SOI 後面插入只含 GPS 的 APP1。不是 JPEG 回傳 null。
export function stripKeepGps(buf, gps) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts = [buf.subarray(0, 2)];
  if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) parts.push(gpsApp1(gps.lat, gps.lng));
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xda) { parts.push(buf.subarray(i)); break; }
    const len = (buf[i + 2] << 8) | buf[i + 3];
    const isMeta = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMeta) parts.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// 測試用：讀回 GPS
export function readGps(buf) {
  for (let i = 2; i + 4 < buf.length;) {
    if (buf[i] !== 0xff) return null;
    const mk = buf[i + 1], len = (buf[i + 2] << 8) | buf[i + 3];
    if (mk === 0xe1 && buf[i + 4] === 0x45 && buf[i + 5] === 0x78) {
      const t = i + 10, dv = new DataView(buf.buffer, buf.byteOffset + t), le = buf[t] === 0x49;
      const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
      const ifd0 = u32(4); let g = 0;
      for (let k = 0; k < u16(ifd0); k++) if (u16(ifd0 + 2 + k * 12) === 0x8825) g = u32(ifd0 + 2 + k * 12 + 8);
      if (!g) return null;
      const r = {};
      for (let k = 0; k < u16(g); k++) {
        const e = g + 2 + k * 12, tag = u16(e);
        if (tag === 1 || tag === 3) r[tag] = String.fromCharCode(dv.getUint8(e + 8));
        if (tag === 2 || tag === 4) { const off = u32(e + 8); const v = [0, 1, 2].map((j) => u32(off + j * 8) / u32(off + j * 8 + 4)); r[tag] = v[0] + v[1] / 60 + v[2] / 3600; }
      }
      return { lat: (r[1] === 'S' ? -1 : 1) * r[2], lng: (r[3] === 'W' ? -1 : 1) * r[4] };
    }
    if (mk === 0xda) return null;
    i += 2 + len;
  }
  return null;
}
