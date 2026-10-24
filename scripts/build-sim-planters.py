# 產生「移動植栽」模擬圖層：從人行道 < 2 m 的推薦點挑一些當示範位置（位置是真實推薦點，植栽、企業、歷史全部模擬）。
import json, random
random.seed(20261023)
fs = json.load(open('app/data/planting-candidates.json'))['features']
pool = [f for f in fs if f['properties'].get('sw_width') is not None and f['properties']['sw_width'] < 2 and f['properties']['ctx'] in ('row_gap', 'mixed')]
pool.sort(key=lambda f: -f['properties']['score'])
pick = pool[:60]
random.shuffle(pick)
pick = pick[:36]
KINDS = ['大型移動植栽盆（桂花）', '大型移動植栽盆（樹蘭）', '棚架爬藤（使君子）', '棚架爬藤（炮仗花）', '大型移動植栽盆（矮性欒樹）']
COS = ['c1', 'c2', 'c3', None]
out = []
for n, f in enumerate(pick):
    lng, lat = f['geometry']['coordinates']
    p = f['properties']
    hist = []
    # 往回推 1–2 次移動紀錄（模擬）
    plng, plat = lng, lat
    moves = random.randint(0, 2)
    dates = sorted(random.sample(['2025-11', '2026-01', '2026-03', '2026-05', '2026-07', '2026-09'], moves + 1))
    for i in range(moves):
        plng2 = round(plng + random.uniform(-0.0006, 0.0006), 6)
        plat2 = round(plat + random.uniform(-0.0005, 0.0005), 6)
        hist.append({'date': dates[i], 'lng': plng2, 'lat': plat2, 'note': random.choice(['原放置點', '因道路施工暫移', '因市場出入動線調整'])})
    hist.append({'date': dates[-1], 'lng': lng, 'lat': lat, 'note': '移到目前位置（人行道寬 %.1f m，不適合種喬木）' % p['sw_width']})
    out.append({'id': 'PL-%03d' % (n + 1), 'lng': lng, 'lat': lat, 'dist': p['dist'], 'road': p['road'], 'sw_width': p['sw_width'],
                'kind': random.choice(KINDS), 'company': random.choice(COS), 'history': hist})
json.dump(out, open('app/data/sim-planters.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(pool), len(out))
