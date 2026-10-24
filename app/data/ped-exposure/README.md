# 網站整合說明：捷運站周邊「人多又曬」逐時圖層

給網站 thread（`wt/tree-twin`，MapLibre）直接載入用。方法與限制全文在 `research/15-pedestrian-flow-sim.md`。

## 一句話

每個捷運站周邊 500 m，把人行路徑切成 ≤40 m 的小段，每段有 07:00–19:00 每小時三個數字：**推估走過的人次**、**遮蔭比例**、**曬到太陽的人次**。用時間滑桿切小時，線的顏色＝曬到的人次。

## 檔案

```
out/web/ped-exposure/
  index.json          站清單、每站中心點、檔名、每小時全站曬到的人·分鐘、最曬時段
  <站名>.geojson       該站 500 m 內的路段（LineString，WGS84）
```

- 涵蓋臺北市 74 個捷運站（站名清單同網站 `shade-flow.json`）；由 `scripts/run_city.sh`（全市版 `s2b_city.py`→`s5_export_web.py --src city`）產生。
- 站名檔名是中文（例如 `南京復興.geojson`），fetch 時用 `encodeURIComponent`；站名有 `/` 的換成 `-`（`台北101-世貿.geojson`、`廣慈-奉天宮.geojson`）。**一律用 index.json 的 `file` 欄位**，不要自己拼。
- 單站檔 53–485 KB（中位數約 300 KB），**點站才載入**，不要一次全載。超過 500 KB 的檔會自動把座標降到小數 5 位（`coord_dp`）。

### index.json

```json
{
  "generated": "2026-10-23",
  "hours": [7, 8, ..., 18],            // 陣列第 0 格＝07:00–08:00，第 11 格＝18:00–19:00
  "day": "2026 年 8 月平日（捷運資料月份）；太陽位置取 8 月 15 日",
  "status": {"ped": "模擬…", "shade": "推估…", "exp": "模擬×推估"},
  "license": "…",
  "areas": [
    {"station": "南京復興", "file": "南京復興.geojson", "center": [121.543, 25.052],
     "radius_m": 500, "segments": 1082,
     "exp_person_min": [ … 12 格 … ],   // 全站每小時曬到的人·分鐘（給排行或小長條圖）
     "peak_hour": 8, "bytes": 340579,
     "coord_dp": 6,                      // 座標小數位數
     "sun_share_0719": 0.395}            // 07–18 時人·公尺加權「走在太陽下」比例（全市版才有）
  ]
}
```

### `<站名>.geojson` 每個 Feature 的 properties

| 欄位 | 型別 | 意思 | 資料狀態 |
|---|---|---|---|
| `n` | 字串 | 路名（人行道沒有名字時借最近的道路名；可能空白） | OSM |
| `len` | 整數 | 這段長度（公尺） | OSM |
| `p` | 12 個整數 | 每小時走過這段的人次（人次／時） | **模擬** |
| `s` | 12 個整數 | 這段行走面被遮住的比例（%，樹＋建物；太陽下山＝100） | **推估** |
| `t` | 12 個整數 | 其中樹影的部分（%） | **推估** |
| `e` | 12 個整數 | 曬到太陽的人次＝`p × (1 − s/100)` | **模擬×推估** |

## MapLibre 範例

```js
const idx = await (await fetch('/data/ped-exposure/index.json')).json();
async function showStation(name) {
  const a = idx.areas.find(x => x.station === name);
  const gj = await (await fetch('/data/ped-exposure/' + encodeURIComponent(a.file))).json();
  if (map.getSource('ped')) map.getSource('ped').setData(gj);
  else {
    map.addSource('ped', { type: 'geojson', data: gj });
    map.addLayer({ id: 'ped-exp', type: 'line', source: 'ped',
      paint: { 'line-width': 3, 'line-color': expColor(1) } });   // 預設 08:00
  }
}
// h = 0..11 對應 07..18 時
function expColor(h) {
  return ['step', ['at', h, ['get', 'e']],
    '#e3e1dc', 1, '#fbd5c0', 25, '#f5a77f', 50, '#ef8452', 100, '#eb6834', 200, '#b9431a', 400, '#7a2a0e'];
}
slider.oninput = e => map.setPaintProperty('ped-exp', 'line-color', expColor(+e.target.value));
```

點路段的提示框建議寫：「08:00–09:00 推估約 1,466 人次走過，遮蔭 0%，曬到約 1,466 人次（模擬）」。

## 圖例（照抄）

- 標題：「每小時經過、而且曬到太陽的人次（模擬）」
- 色階：1–25、25–50、50–100、100–200、200–400、400 以上（淺橘到深褐），0 用淺灰。
- 標章：人次＝模擬；遮蔭＝推估；捷運進出站＝真實。

## 警語（畫面上一定要有，可以摺疊）

1. 只算**搭捷運的人**從出口走到附近建物（或反過來）的路線，公車族、住戶、上班族午餐、觀光客都沒算，所以是下限，不是全部行人。
2. 人走哪條路是**模擬**：假設走最短路、往樓地板面積大的地方去、越遠越少人去。沒有實際軌跡。
3. 遮蔭是**推估**：樹冠由胸徑／樹高推估；建物高度用 OpenStreetMap，全市約三分之二建物沒有樓層資料，用 5 層假設。**騎樓、遮雨棚、高架橋下、捷運出入口雨遮都沒算**，所以騎樓多的街實際會比圖上涼。
4. 人次不是人數；8 月平日平均；太陽取 8 月中。
5. 這是「哪裡最值得優先種樹或加遮蔭」的排序參考，不是實測。
6. **台北車站一帶（台北車站、台大醫院、善導寺、北門、西門）最可能高估**：很多人走地下街或在站內轉乘台鐵高鐵，模型全放在地面；對照交工處 2024 年忠孝西路／中山南路口實測，模型高出數倍。一般街區對照南京東路／建國北路口（2017），模型約是實測的三到七成。

## 資料來源與授權

- 臺北捷運每日分時各站 OD 流量（2026 年 8 月）、臺北捷運車站出入口座標：臺北大眾捷運公司，政府資料開放授權條款第 1 版。
- 行道樹、公園樹、人行道範圍：臺北市政府工務局公園路燈工程管理處、新建工程處，政府資料開放授權條款第 1 版。
- 步行路網與建物：© OpenStreetMap contributors，ODbL 1.0（畫面要標「© OpenStreetMap contributors」）。
