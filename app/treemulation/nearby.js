/* nearby.js — 依手機位置拿到附近的行道樹（一般 script，掛 window.Nearby）
 *
 *   Nearby.load({lat, lng, acc}) → Promise<{trees, home, pos, source, simulated}>
 *   - 沒位置或 acc ≥ 25 m：用 home（./trees.json 的 home）當位置，simulated:true
 *   - 好位置且在精簡檔任一棵樹 300 m 內：source:'local'
 *   - 好位置但在精簡檔範圍外：抓 ../data/trees.json（主站完整樹籍，只抓一次），source:'full'；失敗或 300 m 內沒樹就退回 home
 *   trees：{id, lat, lng, species, dbh, height, survey, dist, place, kind, days, pts, m}，m＝離 pos 公尺，依 m 由近到遠排序
 *   days／pts 一律用主站 sim.js 的 staleDays()／photoPoints() 公式重算（模擬資料），不採用 json 裡的 days 欄。
 */
(function (global) {
  'use strict';

  var RADIUS = 300;          // 公尺
  var GOOD_ACC = 25;         // acc 小於這個才算好位置
  var LOCAL_URL = './trees.json';
  var FULL_URL = '../data/trees.json';
  // 台北以外的示範區（樹資料可能是虛構示範）：有位置時若在示範區內就用它；網址加 ?demo=taoyuan 可在家預覽（以示範區的 home 當模擬位置）
  var DEMO_URLS = ['./trees-taoyuan.json'];
  // 網址加 &fix：示範區一律用 home 當位置（錄影對準用，不讓 GPS 飄動）
  var FIX = (function () { try { return /[?&]fix(=|&|$)/.test(location.search); } catch (e) { return false; } })();
  var FORCE_DEMO = (function () { try { var m = /[?&]demo=([a-z]+)/.exec(location.search); return m ? './trees-' + m[1] + '.json' : null; } catch (e) { return null; } })();
  var R_EARTH = 6371008.8;
  var RAD = Math.PI / 180;

  // ---- 照抄主站 wt/tree-twin/app/js/sim.js 的 seeded()／staleDays()，不要改 ----
  function seeded(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () {
      h += 0x6d2b79f5;
      var t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function staleDays(id) {
    var r = seeded('photo' + id)();
    if (r < 0.3) return -1;
    return Math.floor(Math.pow((r - 0.3) / 0.7, 1.6) * 900);
  }
  // 主站 photoPoints：never 50、base 10、bonusCap 40、每 10 天 +1
  function photoPoints(days) {
    if (days < 0) return 50;
    return 10 + Math.min(40, Math.floor(days / 10));
  }

  // ---- 距離／方位（等距圓柱近似，300 m 內誤差可忽略）----
  function distance(a, b) {
    var x = (b.lng - a.lng) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
    var y = (b.lat - a.lat) * RAD;
    return Math.sqrt(x * x + y * y) * R_EARTH;
  }
  // 度，北＝0、順時針，0–360
  function bearing(a, b) {
    var x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * RAD);
    var y = b.lat - a.lat;
    var deg = Math.atan2(x, y) / RAD;
    return (deg + 360) % 360;
  }

  // ---- 資料 ----
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
      return r.json(); // 不是 JSON 會在這裡 reject
    });
  }

  var localP = null;
  var fullP = null;
  function loadLocal() {
    if (!localP) localP = getJSON(LOCAL_URL).catch(function (e) { localP = null; throw e; });
    return localP;
  }
  // 完整檔只抓一次；失敗也快取（避免手機反覆下載 12 MB），重新整理頁面才會再試
  function loadFull() {
    if (!fullP) fullP = getJSON(FULL_URL).then(function (d) {
      if (!d || !Array.isArray(d.rows) || !Array.isArray(d.cols)) throw new Error('完整檔格式不對');
      return d;
    });
    return fullP;
  }

  var demoP = {};
  function loadDemo(url) {
    if (!demoP[url]) demoP[url] = getJSON(url).catch(function () { return null; });
    return demoP[url];
  }
  function loadDemos() { return Promise.all(DEMO_URLS.map(loadDemo)); }

  function colIndex(d) {
    var c = {};
    d.cols.forEach(function (name, i) { c[name] = i; });
    return c;
  }
  // 原始值可能是索引（數字）或字串
  function lookup(arr, v) {
    if (typeof v === 'number' && arr && v >= 0 && v < arr.length) return arr[v];
    return v == null ? '' : v;
  }

  // 濾出 pos 周圍 radius 內的樹（先用經緯度方框粗篩，再算距離）
  function around(d, pos, radius) {
    var c = colIndex(d);
    var dLat = radius / (R_EARTH * RAD);
    var dLng = dLat / Math.cos(pos.lat * RAD);
    var out = [];
    var rows = d.rows;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var lat = r[c.lat], lng = r[c.lng];
      if (lat < pos.lat - dLat || lat > pos.lat + dLat || lng < pos.lng - dLng || lng > pos.lng + dLng) continue;
      var m = distance(pos, { lat: lat, lng: lng });
      if (m > radius) continue;
      var id = r[c.id];
      // 示範區（id 不是台北樹籍格式）用檔案裡的 days；台北樹一律用主站公式
      var days = (d.demo && c.days != null && isFinite(r[c.days])) ? r[c.days] : staleDays(id);
      out.push({
        id: id, lat: lat, lng: lng,
        species: lookup(d.species, r[c.species]),
        dbh: r[c.dbh], height: r[c.height], survey: r[c.survey],
        dist: lookup(d.dists, r[c.dist]),
        place: lookup(d.places, r[c.place]),
        kind: r[c.kind],
        days: days, pts: photoPoints(days),
        m: Math.round(m),
        demo: !!d.demo,
      });
    }
    out.sort(function (a, b) { return a.m - b.m; });
    return out;
  }

  function anyWithin(d, pos, radius) {
    var c = colIndex(d);
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      if (distance(pos, { lat: r[c.lat], lng: r[c.lng] }) <= radius) return true;
    }
    return false;
  }

  function load(opts) {
    if (FORCE_DEMO) {
      return loadDemo(FORCE_DEMO).then(function (dm) {
        if (!dm) return loadAll(opts);
        dm.demo = true;
        var hp = { lat: dm.home.lat, lng: dm.home.lng };
        var o = opts || {};
        var good = !FIX && isFinite(o.lat) && isFinite(o.lng) && o.lat !== null && o.acc != null && o.acc < GOOD_ACC && anyWithin(dm, { lat: +o.lat, lng: +o.lng }, RADIUS);
        var pos = good ? { lat: +o.lat, lng: +o.lng } : hp;
        return { trees: around(dm, pos, RADIUS), home: dm.home, pos: pos, source: 'demo', simulated: !good, demo: true, reason: good ? 'in-demo' : 'demo-preview' };
      });
    }
    return loadAll(opts);
  }

  function loadAll(opts) {
    return loadLocal().then(function (local) {
      var home = local.home;
      var homePos = { lat: home.lat, lng: home.lng };
      function fallback(reason) {
        return { trees: around(local, homePos, RADIUS), home: home, pos: homePos, source: 'local', simulated: true, reason: reason };
      }
      var o = opts || {};
      var hasPos = isFinite(o.lat) && isFinite(o.lng) && o.lat !== null && o.lng !== null;
      // acc 沒給（null）也當作不夠準
      var goodAcc = o.acc !== null && o.acc !== undefined && isFinite(o.acc) && o.acc < GOOD_ACC;
      if (!hasPos) return fallback('no-position');
      if (!goodAcc) return fallback('low-accuracy');
      var pos = { lat: +o.lat, lng: +o.lng };
      if (anyWithin(local, pos, RADIUS)) {
        return { trees: around(local, pos, RADIUS), home: home, pos: pos, source: 'local', simulated: false, reason: 'in-local' };
      }
      return loadDemos().then(function (demos) {
        for (var i = 0; i < demos.length; i++) {
          var dm = demos[i];
          if (dm && Array.isArray(dm.rows) && anyWithin(dm, pos, RADIUS)) {
            dm.demo = true;
            return { trees: around(dm, pos, RADIUS), home: home, pos: pos, source: 'demo', simulated: false, demo: true, reason: 'in-demo' };
          }
        }
        return loadFull().then(function (full) {
        var trees = around(full, pos, RADIUS);
        if (!trees.length) return fallback('no-trees-nearby');
        return { trees: trees, home: home, pos: pos, source: 'full', simulated: false, reason: 'full' };
        }, function () {
          return fallback('full-unavailable');
        });
      });
    });
  }

  global.Nearby = {
    load: load,
    distance: distance,
    bearing: bearing,
    staleDays: staleDays,
    photoPoints: photoPoints,
    RADIUS: RADIUS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
