# 功能模組介面（給寫新功能的人）

每個功能一個資料夾 `app/features/<id>/index.js`，`export default` 一份 manifest。登錄在 `app/features/index.js`（已預先登記 10 個新功能，不用改那個檔）。程式本體在 `app/js/app.js`，**新功能不要改 app.js、roles.js、css**；需要的樣式寫在自己的 HTML 裡（inline style 或在 page 回傳的字串加 `<style>` 並用 `.f-<id>` 前綴）。

## manifest 欄位

| 欄位 | 必填 | 說明 |
|---|---|---|
| id, title, oneLiner | ✓ | id 與資料夾同名 |
| audience | ✓ | `['public','gov','vendor','esg','plan','mayor']` 的子集；決定哪些角色預設開啟 |
| dataStatus | ✓ | `real` 真實／`est` 推估／`sim` 模擬／`live` 本站回報 |
| maturity | ✓ | `stable` 穩定／`exp` 實驗中 |
| ready | ✓ | `false` 就預設關閉（目錄頁仍列出） |
| demoValue | ✓ | demo 價值一句話（Yo 用來挑功能） |
| problem, howto, limits | ✓ | 獨立頁「產品說明」 |
| rollout | ✓ | `{ agencies, data, budget, promo }`：100 天落地四塊（局處／資料／經費／推廣），一兩句即可，經費寫「情境試算」 |
| sources | | `[{ label, url, date }]` |
| page(ctx) | | async，回傳 HTML 字串（獨立頁 `/f/<id>` 的主體） |
| bindPage(root, ctx) | | 綁事件；root 是 page HTML 的容器 |
| onTree(ctx, tree) | | async，回傳 HTML 字串或空字串；會出現在單棵樹詳細頁下方一個區塊 |
| bindTree(root, ctx, tree) | | 綁事件 |
| chipDefs | | `{ key: { label, dot, colorBy? } }` 新圖層按鈕；`colorBy:true` 表示它決定點的顏色（同時只能開一個） |
| chips | | 這個功能擁有的圖層按鈕 key 陣列 |
| init(ctx) | | 地圖載入後呼叫一次：`ctx.map.addSource / addLayer`，圖層預設 `visibility:'none'` |
| apply(ctx, layers, on) | | 每次圖層狀態改變時呼叫：依 `on && layers[key]` 設定可見度 |
| nav | | 擁有的導覽項 key（例如首長儀表板的 `'mayor'`） |
| route | | hash 路由名，例如 `'mayor'` → `#/mayor` 時把 page 當作角色首頁顯示 |

## ctx（app.js 提供的工具箱）

- 資料：`ctx.trees`（16 萬筆：`{ id, lng, lat, species, dbh 公分, height 公尺, survey 'YYYY-MM-DD'|'', dist, place, remark, kind 0行道/1公園, rv 複查分數, rl 複查等級 }`）、`ctx.treeFromId(id)`、`await ctx.loadShade()`（捷運站 GeoJSON：name, daily, canopy_pct, gap_score, rank）、`await ctx.loadPlant()`（推薦種樹點 GeoJSON：dist, road, sw_width, status, ctx, score）、`await ctx.getAllEvents()`（本站回報：treeId, role citizen/vendor, kind photo/report/precheck/alarm/review, result, at, pts, verify, photo）、`ctx.fetchJSON('/data/xxx.json')`。
- 模擬：`ctx.WORK_ORDERS`、`ctx.workOrderFor(tree)`（`{order, status keep/move/remove, permit}`）、`ctx.STATUS`、`ctx.COMPANIES`（虛構企業）、`ctx.adoptionFor(tree)`。
- 畫面：`ctx.esc(s)`（**所有插進 HTML 的字串都要 esc**）、`ctx.badge('real'|'est'|'sim'|'live')`、`ctx.bar(value, max, color)`（橫條）、`ctx.fmtDate(iso)`、`ctx.go('#/tree/ID')`、`ctx.showToast(msg)`、`ctx.select(tree)`、`ctx.flyTo(tree, zoom)`、`ctx.map`（MapLibre）、`ctx.distM(lat1,lng1,lat2,lng2)`、`ctx.store.get/set`（localStorage）。
- 既有 CSS class 可直接用：`.facts .fact`（數字卡，`<b>` 大數字、`<span>` 說明）、`.list` `.list.dist`（清單）、`.alert.ok/.warn/.danger`、`.btn .btn.primary .btn.mini`、`.privacy`（小字說明）、`.h3`、`table.track`、`.sliders label`（滑桿列）。

## 紅線

- 模擬的負面事件（病況、異常、移除）只能出現在示範區（`ctx.workOrderFor(tree)` 有值的樹）。
- 真實樹上只能放真實欄位與推估；不寫「該不該砍」、不寫金額。
- 企業、廠商一律虛構（用 ctx.COMPANIES、sim.js 的 VENDORS）。
- 沒有正面證據的結論用假說語態；數字附來源；每個功能都標資料狀態。
