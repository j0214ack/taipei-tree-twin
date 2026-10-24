#!/usr/bin/env python3
"""找出「可能是空的樹穴」並給推薦種樹分數。

輸入：新工處樹穴 GeoJSON、行道樹 CSV、公園樹 CSV、人行道 GeoJSON（皆 EPSG:3826）。
輸出：data/derived/planting-candidates.json、data/derived/planting-stats.json。
方法說明：docs/planting-method.md。

用法（在 worktree 根目錄）：
  .venv/bin/python scripts/planting_candidates.py [--raw DIR] [--out DIR]
需要：shapely>=2, pyproj, numpy（見 .venv）。
"""
import argparse
import collections
import csv
import datetime as dt
import hashlib
import json
import os
import time

import numpy as np
import shapely
from pyproj import Transformer
from shapely import STRtree

DEFAULT_RAW = "/Users/yo/workspace/shade-hackathon/data/raw/2026-10-13"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---- 門檻（改這裡就好，文件同步更新） ----
NEAR_TREE_M = 1.5        # 多邊形外 ≤1.5m 仍算有樹（點位誤差）
EMPTY_M = 3.0            # >3m 視為很可能空穴；1.5–3m 為不確定
SIDEWALK_SEARCH_M = 10.0 # 樹穴沒有落在人行道內時，往外找最近人行道的距離上限
DENSITY_R_M = 50.0       # 「周圍樹木稀少」的半徑
MIN_WIDTH_M = 1.5        # 人行道寬 <1.5m → 不推薦（分數上限 20）
NOT_REC_CAP = 20
ROW_GAP_M = 15.0         # 樹穴中位間距約 6.5m（p90 9.9m）；15m 內鄰穴有樹＝「一排缺一棵」

# 分數各項滿分：寬度 45 + 稀疏 30 + 面積 15 + 同排有樹 10 = 100；不確定 -10
W_MAX, S_MAX, A_MAX, C_MAX, UNCERTAIN_PENALTY = 45, 30, 15, 10, 10
W_FULL_M = 4.0           # 人行道寬 ≥4m 寬度分滿分
S_ZERO_N = 30            # 50m 內 ≥30 棵樹 稀疏分 0
A_ZERO, A_FULL = 0.5, 2.25  # 樹穴面積 ≤0.5㎡ 0 分、≥2.25㎡（約 1.5×1.5m）滿分
W_UNKNOWN = 10           # 找不到人行道時的寬度分


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_trees(path, anomalies, label):
    xy, bad, rows = [], 0, 0
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows += 1
            try:
                x, y = float(r["TWD97X"]), float(r["TWD97Y"])
            except (TypeError, ValueError):
                bad += 1
                continue
            # 台北市 TWD97 大致範圍；超出視為座標錯誤
            if not (290000 < x < 320000 and 2755000 < y < 2795000):
                bad += 1
                continue
            xy.append((x, y))
    a = np.array(xy)
    dup = len(a) - len(np.unique(a.round(2), axis=0))
    anomalies[label] = {"rows": rows, "bad_coords_dropped": bad, "duplicate_coords": int(dup)}
    return a


def lin(v, lo, hi):
    return np.clip((v - lo) / (hi - lo), 0.0, 1.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=DEFAULT_RAW)
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "derived"))
    args = ap.parse_args()
    t0 = time.time()
    raw = args.raw
    f_holes = os.path.join(raw, "sidewalk-tree-holes.json")
    f_tree = os.path.join(raw, "TaipeiTree.csv")
    f_park = os.path.join(raw, "TaipeiParkTree.csv")
    f_sw = os.path.join(raw, "sidewalks.json")
    anomalies = {}

    # ---- 1. 樹穴（只取 Name=樹穴） ----
    H = json.load(open(f_holes, encoding="utf-8"))
    name_counts = collections.Counter(f["properties"]["Name"] for f in H["features"])
    hf = [f for f in H["features"] if f["properties"]["Name"] == "樹穴"]
    polys = np.array([shapely.geometry.shape(f["geometry"]) for f in hf])
    inval = ~shapely.is_valid(polys)
    if inval.any():
        polys[inval] = shapely.make_valid(polys[inval])
    hid = np.array([f["properties"]["OBJECTID"] for f in hf])
    hdist = [f["properties"]["Town_N"] for f in hf]
    area = shapely.area(polys)
    anomalies["holes"] = {
        "name_counts": dict(name_counts),
        "invalid_geometries_fixed": int(inval.sum()),
        "duplicate_objectid": int(len(hid) - len(np.unique(hid))),
        "area_lt_0_5m2": int((area < 0.5).sum()),
        "area_gt_10m2": int((area > 10).sum()),
        "area_max_m2": round(float(area.max()), 1),
    }

    # ---- 2. 樹點（行道樹＋公園樹） ----
    t_xy = load_trees(f_tree, anomalies, "street_trees")
    p_xy = load_trees(f_park, anomalies, "park_trees")
    pts = shapely.points(np.vstack([t_xy, p_xy]))
    ttree = STRtree(pts)

    # 最近樹距離（多邊形內＝0）
    (ih, it), d = ttree.query_nearest(polys, return_distance=True)
    dmin = np.full(len(polys), np.inf)
    np.minimum.at(dmin, ih, d)
    near_idx = np.full(len(polys), -1)
    near_idx[ih] = it

    inside = dmin == 0
    near = (dmin > 0) & (dmin <= NEAR_TREE_M)
    uncertain = (dmin > NEAR_TREE_M) & (dmin <= EMPTY_M)
    empty = dmin > EMPTY_M
    occupied = inside | near

    # 同一棵樹被 >1 個樹穴當作「1.5m 內的樹」（相鄰樹穴共用一棵樹的可能高估）
    shared = collections.Counter(near_idx[near])
    a_c, _ = ttree.query(polys, predicate="contains")
    trees_in_hole = np.bincount(a_c, minlength=len(polys))
    # 有多少樹點不在任何樹穴 1.5m 內（反向覆蓋）
    hpoly_tree = STRtree(polys)
    tp_a, _ = hpoly_tree.query(pts, predicate="dwithin", distance=NEAR_TREE_M)
    tree_near_hole = np.zeros(len(pts), bool)
    tree_near_hole[tp_a] = True
    nt = len(t_xy)
    anomalies["matching"] = {
        "holes_with_multiple_trees_inside": int((trees_in_hole > 1).sum()),
        "max_trees_inside_one_hole": int(trees_in_hole.max()),
        "trees_counted_for_multiple_near_holes": int(sum(1 for v in shared.values() if v > 1)),
        "street_trees_within_1_5m_of_a_hole": int(tree_near_hole[:nt].sum()),
        "street_trees_total": int(nt),
        "park_trees_within_1_5m_of_a_hole": int(tree_near_hole[nt:].sum()),
    }

    # 中心點（凹形樹穴若形心落在外面，改用 point_on_surface）
    cent = shapely.centroid(polys)
    out_c = ~shapely.contains(polys, cent)
    if out_c.any():
        cent[out_c] = shapely.point_on_surface(polys[out_c])

    # 50m 內樹木數
    a50, _ = ttree.query(cent, predicate="dwithin", distance=DENSITY_R_M)
    n50 = np.bincount(a50, minlength=len(polys))

    # 鄰穴脈絡：15m 內鄰穴有樹＝像「一排缺一棵」（row_gap）；
    # 50m 內有其他樹穴但全都比不到樹＝可能是樹木資料缺漏或新設人行道（all_empty）
    def nb_counts(r):
        ha, hb = hpoly_tree.query(cent, predicate="dwithin", distance=r)
        m = ha != hb
        n = np.bincount(ha[m], minlength=len(polys))
        o = np.bincount(ha[m], weights=occupied[hb[m]], minlength=len(polys)).astype(int)
        return n, o
    _, occ15 = nb_counts(ROW_GAP_M)
    nb50, occ50 = nb_counts(DENSITY_R_M)
    nbr_tree = occ15 > 0
    ctx = np.where(nbr_tree, "row_gap",
                   np.where(occ50 > 0, "mixed", np.where(nb50 > 0, "all_empty", "isolated")))

    # ---- 3. 人行道 join ----
    S = json.load(open(f_sw, encoding="utf-8"))
    sp = [f["properties"] for f in S["features"]]
    sg = np.array([shapely.geometry.shape(f["geometry"]) for f in S["features"]])
    sw_inval = ~shapely.is_valid(sg)
    if sw_inval.any():
        sg[sw_inval] = shapely.make_valid(sg[sw_inval])
    sw_w = np.array([p["SW_WTH_ItemValue"] if p["SW_WTH_ItemValue"] is not None else np.nan for p in sp], float)
    sw_ww = np.array([p["SWW_WTH"] if p["SWW_WTH"] is not None else np.nan for p in sp], float)
    anomalies["sidewalks"] = {
        "features": len(sp),
        "invalid_geometries_fixed": int(sw_inval.sum()),
        "SWW_WTH_gt_SW_WTH": int((sw_ww > sw_w + 0.01).sum()),
        "SWW_WTH_eq_SW_WTH": int((np.abs(sw_ww - sw_w) <= 0.01).sum()),
        "SWW_WTH_lt_SW_WTH": int((sw_ww < sw_w - 0.01).sum()),
        "SW_WTH_lt_1_5": int((sw_w < MIN_WIDTH_M).sum()),
        "SWW_WTH_lt_0_5": int((sw_ww < 0.5).sum()),
        "SW_WTH_median": round(float(np.nanmedian(sw_w)), 2),
        "SWW_WTH_median": round(float(np.nanmedian(sw_ww)), 2),
        "Town_N_note": "人行道 Town_N 是數字代碼（如 63000050），非中文區名；本分析行政區一律用樹穴的 Town_N",
    }
    stree = STRtree(sg)
    sw_idx = np.full(len(polys), -1)
    sw_dist = np.full(len(polys), np.nan)
    # 只算候選穴（加快）；有樹的穴不需要人行道資訊
    cand = np.where(uncertain | empty)[0]
    qa, qb = stree.query(polys[cand], predicate="intersects")
    if len(qa):
        ov = shapely.area(shapely.intersection(polys[cand][qa], sg[qb]))
        best = {}
        for i, j, o in zip(qa, qb, ov):
            if i not in best or o > best[i][1]:
                best[i] = (j, o)
        for i, (j, _) in best.items():
            sw_idx[cand[i]] = j
            sw_dist[cand[i]] = 0.0
    rest = cand[sw_idx[cand] < 0]
    if len(rest):
        (na, nb), nd = stree.query_nearest(polys[rest], max_distance=SIDEWALK_SEARCH_M, return_distance=True)
        seen = set()
        for i, j, dd in zip(na, nb, nd):
            if i in seen:
                continue
            seen.add(i)
            sw_idx[rest[i]] = j
            sw_dist[rest[i]] = dd

    # ---- 4. 分數 ----
    has_sw = sw_idx >= 0
    width = np.where(has_sw, sw_w[np.maximum(sw_idx, 0)], np.nan)
    net = np.where(has_sw, sw_ww[np.maximum(sw_idx, 0)], np.nan)
    w_pts = np.where(has_sw, 10 + (W_MAX - 10) * lin(np.nan_to_num(width), MIN_WIDTH_M, W_FULL_M), W_UNKNOWN)
    w_pts = np.where(has_sw & (np.nan_to_num(width) < MIN_WIDTH_M), 0, w_pts)
    s_pts = S_MAX * (1 - np.minimum(n50, S_ZERO_N) / S_ZERO_N)
    # 50m 內樹穴全比不到樹（all_empty／isolated）時，「樹少」很可能是樹木資料缺漏造成的假象，
    # 不給稀疏分（偏離原始規則，理由見 docs/planting-method.md）
    s_pts = np.where(np.isin(ctx, ["all_empty", "isolated"]), 0, s_pts)
    a_pts = A_MAX * lin(area, A_ZERO, A_FULL)
    c_pts = np.where(nbr_tree, C_MAX, 0)
    score = w_pts + s_pts + a_pts + c_pts - np.where(uncertain, UNCERTAIN_PENALTY, 0)
    not_rec = has_sw & (np.nan_to_num(width) < MIN_WIDTH_M)
    score = np.where(not_rec, np.minimum(score, NOT_REC_CAP), score)
    score = np.clip(np.rint(score), 0, 100).astype(int)

    # ---- 5. 轉 WGS84、輸出 ----
    tf = Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)
    cx, cy = shapely.get_x(cent), shapely.get_y(cent)
    lon, lat = tf.transform(cx, cy)

    def fmt_w(v):
        return None if np.isnan(v) else round(float(v), 2)

    feats = []
    for i in cand:
        st = "uncertain" if uncertain[i] else "likely_empty"
        road = sp[sw_idx[i]]["NAME_Road"] if has_sw[i] else None
        rs = []
        if not has_sw[i]:
            rs.append("10m 內無人行道圖資")
        elif not_rec[i]:
            rs.append(f"人行道寬 {width[i]:.1f}m 不足 1.5m，不推薦")
        else:
            rs.append(f"人行道寬 {width[i]:.1f}m")
        rs.append(f"50m 內 {n50[i]} 棵樹")
        if ctx[i] == "row_gap":
            rs.append("隔壁穴有樹")
        elif ctx[i] == "all_empty":
            rs.append("附近樹穴都比不到樹，疑資料缺漏")
        if uncertain[i]:
            rs.append(f"最近樹 {dmin[i]:.1f}m，不確定")
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(float(lon[i]), 6), round(float(lat[i]), 6)]},
            "properties": {
                "id": int(hid[i]),
                "dist": hdist[i],
                "road": road,
                "sw_width": fmt_w(width[i]),
                "sw_net_width": fmt_w(net[i]),
                "area_m2": round(float(area[i]), 2),
                "nearest_tree_m": round(float(dmin[i]), 1),
                "status": st,
                "score": int(score[i]),
                "ctx": str(ctx[i]),
                "reasons": "、".join(rs),
            },
        })
    feats.sort(key=lambda f: -f["properties"]["score"])
    os.makedirs(args.out, exist_ok=True)
    out_geo = os.path.join(args.out, "planting-candidates.json")
    with open(out_geo, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))

    # ---- stats ----
    def hist(vals):
        bins = list(range(0, 101, 10))
        h = np.histogram(vals, bins=bins)[0] if len(vals) else np.zeros(10, int)
        return {f"{bins[k]}-{bins[k + 1] - 1 if k < 9 else 100}": int(h[k]) for k in range(10)}

    by_dist = collections.defaultdict(lambda: {"holes": 0, "likely_empty": 0, "uncertain": 0})
    for i, dn in enumerate(hdist):
        by_dist[dn]["holes"] += 1
        if empty[i]:
            by_dist[dn]["likely_empty"] += 1
        elif uncertain[i]:
            by_dist[dn]["uncertain"] += 1
    for v in by_dist.values():
        v["likely_empty_pct"] = round(100 * v["likely_empty"] / v["holes"], 1)
    road_c = collections.Counter(f["properties"]["road"] for f in feats if f["properties"]["status"] == "likely_empty")
    le, un = empty, uncertain
    stats = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds"),
        "script": "scripts/planting_candidates.py",
        "inputs": {os.path.basename(p): {"bytes": os.path.getsize(p), "sha256": sha256(p)} for p in (f_holes, f_tree, f_park, f_sw)},
        "thresholds": {
            "near_tree_m": NEAR_TREE_M, "empty_m": EMPTY_M, "sidewalk_search_m": SIDEWALK_SEARCH_M,
            "density_radius_m": DENSITY_R_M, "min_sidewalk_width_m": MIN_WIDTH_M, "row_gap_m": ROW_GAP_M,
        },
        "counts": {
            "tree_holes": int(len(polys)),
            "has_tree_inside": int(inside.sum()),
            "has_tree_within_1_5m": int(near.sum()),
            "uncertain_1_5_to_3m": int(un.sum()),
            "likely_empty_gt_3m": int(le.sum()),
            "candidates_output": len(feats),
            "candidates_no_sidewalk_within_10m": int((~has_sw[cand]).sum()),
            "candidates_sidewalk_overlapping": int((sw_dist[cand] == 0).sum()),
            "candidates_sidewalk_nearest_within_10m": int((sw_dist[cand] > 0).sum()),
            "candidates_sidewalk_lt_1_5m_not_recommended": int(not_rec[cand].sum()),
            "likely_empty_ctx": {k: int((le & (ctx == k)).sum()) for k in ("row_gap", "mixed", "all_empty", "isolated")},
            "uncertain_ctx": {k: int((un & (ctx == k)).sum()) for k in ("row_gap", "mixed", "all_empty", "isolated")},
            "likely_empty_gt_15m": int((dmin > 15).sum()),
            "likely_empty_gt_30m": int((dmin > 30).sum()),
        },
        "nearest_tree_m_percentiles_all_holes": {
            f"p{q}": round(float(v), 2) for q, v in zip((25, 50, 75, 90, 95), np.percentile(dmin, (25, 50, 75, 90, 95)))
        },
        "by_district": dict(sorted(by_dist.items(), key=lambda kv: -kv[1]["likely_empty"])),
        "score_hist": {
            "likely_empty": hist(score[le]),
            "uncertain": hist(score[un]),
        },
        "score_summary": {
            "likely_empty_median": float(np.median(score[le])) if le.any() else None,
            "likely_empty_ge_70": int((score[le] >= 70).sum()),
            "likely_empty_ge_80": int((score[le] >= 80).sum()),
            "likely_empty_not_recommended": int((le & not_rec).sum()),
        },
        "top_roads_likely_empty": dict(road_c.most_common(15)),
        "anomalies": anomalies,
        "runtime_s": None,
    }
    stats["runtime_s"] = round(time.time() - t0, 1)
    with open(os.path.join(args.out, "planting-stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1)
    print(json.dumps(stats["counts"], ensure_ascii=False, indent=1))
    print("runtime_s", stats["runtime_s"], "->", out_geo, os.path.getsize(out_geo), "bytes")


if __name__ == "__main__":
    main()
