# 把歷年影像研究的示範裁切圖（國土測繪中心正射影像）整理成前端用的 app/data/imagery.json＋app/img/imagery/。
# 略過「跟前一年像素完全相同」的年度圖層（最可能沿用舊航照）。
import json, shutil, os, sys
SRC_ROOT = sys.argv[1] if len(sys.argv) > 1 else '/Users/yo/workspace/shade-hackathon'
d = json.load(open(os.path.join(SRC_ROOT, 'data/derived/imagery-demo/imagery-demo.json')))
out = {'attribution': '影像來源：內政部國土測繪中心 國土測繪圖資服務雲（正射影像 WMTS）',
       'license': d['trees'][0]['frames'][1]['license'], 'findings': d['findings'], 'trees': []}
for t in d['trees']:
    frames = []
    for f in t['frames']:
        if not f['available'] or not f['image_path'] or f['identical_to_previous_year']:
            continue
        rel = f"img/imagery/{t['TreeID']}/{os.path.basename(f['image_path'])}"
        os.makedirs(os.path.dirname('app/' + rel), exist_ok=True)
        shutil.copyfile(os.path.join(SRC_ROOT, f['image_path']), 'app/' + rel)
        frames.append({'year': str(f['year']) if f['year'] != 'latest' else '最新', 'src': rel, 'observed': f.get('observed'), 'crop_m': f['crop_m']})
    out['trees'].append({'id': t['TreeID'], 'label': t['label'], 'lat': t['lat'], 'lng': t['lon'], 'species': t['species'],
                         'dbh': t.get('dbh_cm'), 'height': t.get('height_m'), 'in_dataset': t['in_2026_10_13_dataset'],
                         'why': t.get('why'), 'evidence': t.get('evidence'), 'frames': frames})
json.dump(out, open('app/data/imagery.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print([(t['id'], len(t['frames'])) for t in out['trees']])
