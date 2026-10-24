# 各行政區：人行道總長（人行道範圍圖 SW_LENG_ItemValue 加總）與行道樹數，算每公里人行道樹數（公平檢查用）。
import json, sys
RAW = sys.argv[1] if len(sys.argv) > 1 else '/Users/yo/workspace/shade-hackathon/data/raw/2026-10-13'
CODE = {'63000010': '松山區', '63000020': '信義區', '63000030': '大安區', '63000040': '中山區', '63000050': '中正區', '63000060': '大同區',
        '63000070': '萬華區', '63000080': '文山區', '63000090': '南港區', '63000100': '內湖區', '63000110': '士林區', '63000120': '北投區'}
sw = json.load(open(f'{RAW}/sidewalks.json'))
length = {}
for f in sw['features']:
    p = f['properties']; d = CODE.get(str(p.get('Town_N')))
    if d and p.get('SW_LENG_ItemValue'):
        length[d] = length.get(d, 0) + float(p['SW_LENG_ItemValue'])
t = json.load(open('app/data/trees.json'))
street = {}
for r in t['rows']:
    if r[10] == 0:
        d = t['dists'][r[7]]; street[d] = street.get(d, 0) + 1
plant = json.load(open('app/data/planting-candidates.json'))
cand = {}
for f in plant['features']:
    d = f['properties'].get('dist'); cand[d] = cand.get(d, 0) + 1
out = []
for d in CODE.values():
    km = length.get(d, 0) / 1000
    out.append({'dist': d, 'sidewalk_km': round(km, 1), 'street_trees': street.get(d, 0), 'per_km': round(street.get(d, 0) / km, 1) if km else None, 'candidates': cand.get(d, 0)})
out.sort(key=lambda x: x['per_km'] or 0)
json.dump({'source': '人行道範圍圖 SW_LENG_ItemValue（2026-10-13 下載）、行道樹 CSV、推薦種樹點', 'note': '人行道長度是每段人行道多邊形的長度欄位加總，兩側分開計；行道樹含安全島上的樹', 'rows': out}, open('app/data/district-stats.json', 'w'), ensure_ascii=False)
for o in out: print(o)
