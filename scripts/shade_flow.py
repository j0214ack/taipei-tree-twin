#!/usr/bin/env python3
"""「人多沒樹蔭」站點指標（捷運站周邊 300 m 代理）。

重跑：
  .venv/bin/python -I scripts/shade_flow.py \
      --raw /Users/yo/workspace/shade-hackathon/data/raw/2026-10-23-flow

輸入
  <raw>/mrt-od-202608.csv          臺北捷運每日分時各站 OD（UTF-8 BOM）
  <raw>/mrt-exits.csv              臺北捷運車站出入口座標（Big5）
  <raw>/county-shp/COUNTY_MOI_*.shp 內政部直轄市縣市界線（只用來取臺北市範圍）
  app/data/trees.json              行道樹＋公園樹（WGS84，欄式 JSON）

輸出
  data/derived/mrt-station-flow-202608.csv  各站進／出站彙總（中間檔，可檢查）
  data/derived/shade-flow.json              GeoJSON（站點）
  data/derived/shade-flow-stats.json        方法參數與統計（給文件引用）
  app/data/shade-flow.json                  同 shade-flow.json
方法說明見 docs/shade-flow-method.md。
"""
import argparse
import csv
import glob
import json
import math
import os
import re
import statistics
from collections import defaultdict

import numpy as np
import shapefile  # pyshp
from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RADIUS_M = 300.0
AM_HOURS = {"07", "08"}          # 07:00–09:00
PM_HOURS = {"16", "17", "18"}    # 16:00–19:00
DBH_VALID = (0.0, 300.0)         # 公分；<=0 或 >300 視為異常，用同樹種中位數補
HEIGHT_VALID = (0.0, 40.0)       # 公尺；<=0 或 >40 視為異常，不套高度上限
SENS_SCALES = (0.8, 1.2)         # 敏感度：樹冠直徑 ±20%

to_m = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True).transform
to_ll = Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True).transform


def exit_station_name(exit_name):
    s = re.sub(r"站?出口.*$", "", exit_name)
    if s.startswith("台北車站"):          # 台北車站M1…M8
        return "台北車站"
    if s == "大橋頭":
        return "大橋頭站"                 # OD 檔用「大橋頭站」
    return s


def od_station_name(name):
    # 少數轉乘站在 OD 檔裡依路線分開（如 BL板橋、Y板橋、G大坪林、O景安），
    # 去掉路線代碼前綴合併成一站。
    m = re.match(r"^[A-Z]{1,2}(\D.*)$", name)
    return m.group(1) if m else name


def aggregate_od(path):
    ent = defaultdict(lambda: [0, 0, 0])  # all, am, pm
    ext = defaultdict(lambda: [0, 0, 0])
    days = set()
    rows = 0
    with open(path, encoding="utf-8-sig", newline="") as f:
        r = csv.reader(f)
        header = next(r)
        assert header == ["日期", "時段", "進站", "出站", "人次"], header
        for d, h, o, t, n in r:
            rows += 1
            n = int(n)
            if not n:
                days.add(d)
                continue
            days.add(d)
            o = od_station_name(o)
            t = od_station_name(t)
            am = h in AM_HOURS
            pm = h in PM_HOURS
            e = ent[o]; x = ext[t]
            e[0] += n; x[0] += n
            if am:
                e[1] += n; x[1] += n
            if pm:
                e[2] += n; x[2] += n
    return ent, ext, sorted(days), rows


def load_taipei_boundary(shp_dir):
    shp = glob.glob(os.path.join(shp_dir, "COUNTY_MOI_*.shp"))[0]
    rd = shapefile.Reader(shp, encoding="utf-8")
    names = [f[0] for f in rd.fields[1:]]
    for sr in rd.iterShapeRecords():
        rec = dict(zip(names, sr.record))
        if rec.get("COUNTYNAME") == "臺北市":
            return transform(to_m, shape(sr.shape.__geo_interface__)).buffer(0)
    raise SystemExit("找不到臺北市界")


def load_exits(path):
    st = defaultdict(list)
    with open(path, encoding="big5", newline="") as f:
        for row in csv.DictReader(f):
            st[exit_station_name(row["出入口名稱"])].append(
                (float(row["經度"]), float(row["緯度"])))
    return st


def crown_diameters(trees):
    c = trees["cols"]
    i_sp, i_dbh, i_h = c.index("species"), c.index("dbh"), c.index("height")
    rows = trees["rows"]
    by_sp = defaultdict(list)
    for r in rows:
        d = r[i_dbh]
        if d is not None and DBH_VALID[0] < d <= DBH_VALID[1]:
            by_sp[r[i_sp]].append(d)
    sp_med = {k: statistics.median(v) for k, v in by_sp.items()}
    all_med = statistics.median([d for v in by_sp.values() for d in v])
    out = np.empty(len(rows))
    n_imputed = n_hcap = n_hbad = 0
    for k, r in enumerate(rows):
        d = r[i_dbh]
        if d is None or not (DBH_VALID[0] < d <= DBH_VALID[1]):
            d = sp_med.get(r[i_sp], all_med)
            n_imputed += 1
        cd = 0.2 * d + 1.0
        h = r[i_h]
        hi = math.inf
        if h is not None and HEIGHT_VALID[0] < h <= HEIGHT_VALID[1]:
            hi = 0.8 * h + 2.0
        else:
            n_hbad += 1
        if cd > hi:
            n_hcap += 1
        out[k] = max(1.5, min(cd, hi))
    return out, {"dbh_imputed": n_imputed, "height_invalid": n_hbad,
                 "height_capped": n_hcap, "dbh_global_median_cm": all_med}


def pct_rank(values):
    """平均排名百分位 0–1（最小 0、最大 1，同值取平均）。"""
    v = np.asarray(values, float)
    order = v.argsort(kind="mergesort")
    ranks = np.empty(len(v))
    ranks[order] = np.arange(len(v), dtype=float)
    for val in np.unique(v):
        m = v == val
        ranks[m] = ranks[m].mean()
    return ranks / (len(v) - 1)


def spearman(x, y):
    return float(np.corrcoef(pct_rank(x), pct_rank(y))[0, 1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--sensitivity", action="store_true",
                    help="另算樹冠直徑 ±20%% 與站點改用出入口聯集的排名穩定度")
    a = ap.parse_args()

    ent, ext, days, nrows = aggregate_od(os.path.join(a.raw, "mrt-od-202608.csv"))
    ndays = len(days)
    with open(os.path.join(ROOT, "data/derived/mrt-station-flow-202608.csv"), "w",
              encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["station", "days", "entries", "exits", "entries_am", "exits_am",
                    "entries_pm", "exits_pm"])
        for s in sorted(set(ent) | set(ext)):
            e, x = ent[s], ext[s]
            w.writerow([s, ndays, e[0], x[0], e[1], x[1], e[2], x[2]])

    taipei = load_taipei_boundary(os.path.join(a.raw, "county-shp"))
    exits = load_exits(os.path.join(a.raw, "mrt-exits.csv"))

    trees = json.load(open(os.path.join(ROOT, "app/data/trees.json"), encoding="utf-8"))
    c = trees["cols"]
    lng = np.array([r[c.index("lng")] for r in trees["rows"]])
    lat = np.array([r[c.index("lat")] for r in trees["rows"]])
    tx, ty = to_m(lng, lat)
    cd, crown_stats = crown_diameters(trees)
    pts = [Point(x, y) for x, y in zip(tx, ty)]
    tree_idx = STRtree(pts)
    max_r = cd.max() / 2

    stations, skipped = [], []
    for name in sorted(set(ent) | set(ext)):
        if name not in exits:
            skipped.append((name, "無出入口座標"))
            continue
        ll = np.array(exits[name])
        cx, cy = to_m(ll[:, 0].mean(), ll[:, 1].mean())
        center = Point(cx, cy)
        if not taipei.contains(center):
            skipped.append((name, "不在臺北市"))
            continue
        circle = center.buffer(RADIUS_M, quad_segs=32)
        area_full = circle.area
        clip = circle.intersection(taipei)
        in_city = clip.area / area_full
        near = tree_idx.query(center.buffer(RADIUS_M + max_r * 1.2))
        dist = np.hypot(tx[near] - cx, ty[near] - cy)
        in300 = int((dist <= RADIUS_M).sum())

        def coverage(scale):
            r = cd[near] * scale / 2
            keep = np.nonzero(dist <= RADIUS_M + r)[0]
            if not len(keep):
                return 0.0
            canopy = unary_union([pts[near[i]].buffer(r[i], quad_segs=8) for i in keep])
            return canopy.intersection(clip).area / clip.area

        cov = coverage(1.0)
        sens = {k: coverage(k) for k in SENS_SCALES} if a.sensitivity else {}
        if a.sensitivity:
            # 另一種站點定義：每個出入口各畫 300 m 圓再取聯集
            ex_m = [to_m(lo, la) for lo, la in ll]
            zone = unary_union([Point(p).buffer(RADIUS_M, quad_segs=32) for p in ex_m])
            zone = zone.intersection(taipei)
            cand = tree_idx.query(zone.buffer(max_r))
            if len(cand):
                canopy = unary_union([pts[i].buffer(cd[i] / 2, quad_segs=8) for i in cand])
                sens["exits_union"] = canopy.intersection(zone).area / zone.area
            else:
                sens["exits_union"] = 0.0
        e, x = ent[name], ext[name]
        stations.append({
            "name": name, "lng": round(ll[:, 0].mean(), 6), "lat": round(ll[:, 1].mean(), 6),
            "n_exits": len(ll),
            "daily": (e[0] + x[0]) / ndays, "peak_am": (e[1] + x[1]) / ndays,
            "peak_pm": (e[2] + x[2]) / ndays, "canopy": cov, "trees_300m": in300,
            "in_city": in_city, "sens": sens,
        })

    p_flow = pct_rank([s["daily"] for s in stations])
    p_can = pct_rank([s["canopy"] for s in stations])
    for s, pf, pc in zip(stations, p_flow, p_can):
        s["gap"] = 100 * pf * (1 - pc)
    stations.sort(key=lambda s: (-round(s["gap"]), -s["daily"]))
    p_flow_sorted = pct_rank([s["daily"] for s in stations])
    feats = []
    for rank, s in enumerate(stations, 1):
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [s["lng"], s["lat"]]},
            "properties": {
                "name": s["name"], "daily": int(round(s["daily"])),
                "peak_am": int(round(s["peak_am"])), "peak_pm": int(round(s["peak_pm"])),
                "canopy_pct": round(100 * s["canopy"], 1), "trees_300m": s["trees_300m"],
                "gap_score": int(round(s["gap"])), "rank": rank,
            },
        })
    fc = {"type": "FeatureCollection", "features": feats}
    txt = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    for out in ("data/derived/shade-flow.json", "app/data/shade-flow.json"):
        with open(os.path.join(ROOT, out), "w", encoding="utf-8") as f:
            f.write(txt)

    can = np.array([s["canopy"] for s in stations]) * 100
    stats = {
        "od_rows": nrows, "od_days": ndays, "od_first_day": days[0], "od_last_day": days[-1],
        "stations_in_od": len(set(ent) | set(ext)), "stations_output": len(stations),
        "skipped": skipped, "trees": len(trees["rows"]), "crown": crown_stats,
        "crown_d_m_pctl": dict(zip(["p5", "p50", "p95"],
                                   [round(float(v), 2) for v in np.percentile(cd, [5, 50, 95])])),
        "canopy_pct_min_med_max": [round(float(can.min()), 1), round(float(np.median(can)), 1),
                                   round(float(can.max()), 1)],
        "partial_circle_stations": [(s["name"], round(s["in_city"], 3))
                                    for s in stations if s["in_city"] < 0.999],
        "params": {"radius_m": RADIUS_M, "am_hours": sorted(AM_HOURS),
                   "pm_hours": sorted(PM_HOURS), "dbh_valid_cm": DBH_VALID,
                   "height_valid_m": HEIGHT_VALID},
        "top10": [(f["properties"]["name"], f["properties"]["gap_score"],
                   f["properties"]["daily"], f["properties"]["canopy_pct"]) for f in feats[:10]],
    }
    if a.sensitivity:
        base = np.array([s["gap"] for s in stations])
        top = {s["name"] for s in stations[:10]}
        stats["sensitivity"] = {}
        for k in SENS_SCALES + ("exits_union",):
            pc = pct_rank([s["sens"][k] for s in stations])
            g = 100 * p_flow_sorted * (1 - pc)
            order = np.argsort(-g, kind="mergesort")
            stats["sensitivity"][k if isinstance(k, str) else f"crown_x{k}"] = {
                "spearman_gap": round(spearman(base, g), 3),
                "top10_overlap": len(top & {stations[i]["name"] for i in order[:10]}),
                "top10": [stations[i]["name"] for i in order[:10]],
                "canopy_pct_median": round(float(np.median([s["sens"][k] for s in stations])) * 100, 1),
            }
    with open(os.path.join(ROOT, "data/derived/shade-flow-stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1)
    print(json.dumps(stats, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
