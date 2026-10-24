#!/usr/bin/env bash
# 把「模樹 Treemulation」（遊戲化第二個 app）從 wt/gamify-mockup/mockups/collect/ 複製到 app/treemulation/，部署後在 /treemulation/。
# - 只複製來源根層的 *.html（排除 *-test.html）、*.js、*.json、*.webmanifest、*.svg、*.png；不進子資料夾
# - 只覆蓋 app/treemulation/ 根層的同名檔；不刪任何檔，不碰 app/treemulation/wish/ 等子資料夾（許願種樹頁在那裡）
# - 每個複製過去的 .html：先移除既有 ga-on-ship 區塊，再把 app/index.html 的 GA 區塊原樣插在 <meta charset> 後面
# 用法：bash scripts/sync-collect.sh [來源資料夾]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/../gamify-mockup/mockups/collect}"
DEST="$ROOT/app/treemulation"
MAIN_HTML="$ROOT/app/index.html"

if [ ! -d "$SRC" ]; then echo "找不到來源資料夾：$SRC" >&2; exit 1; fi
grep -q '<!-- ga-on-ship:start' "$MAIN_HTML" || { echo "app/index.html 找不到 ga-on-ship 區塊" >&2; exit 1; }

mkdir -p "$DEST"
shopt -s nullglob
n=0; html=()
for f in "$SRC"/*.html "$SRC"/*.js "$SRC"/*.json "$SRC"/*.webmanifest "$SRC"/*.svg "$SRC"/*.png; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  case "$name" in *-test.html) echo "略過 $name（測試頁）"; continue ;; esac
  cp "$f" "$DEST/$name"
  echo "已複製 $name"
  n=$((n + 1))
  case "$name" in *.html) html+=("$DEST/$name") ;; esac
done
[ "$n" -gt 0 ] || { echo "來源沒有可複製的檔案：$SRC" >&2; exit 1; }

# 插入主站 GA 區塊
if [ "${#html[@]}" -gt 0 ]; then
  python3 -I - "$MAIN_HTML" "${html[@]}" <<'PY'
import re, sys
main = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'<!-- ga-on-ship:start.*?<!-- ga-on-ship:end -->', main, re.S)
block = m.group(0)
for p in sys.argv[2:]:
    s = open(p, encoding='utf-8').read()
    s = re.sub(r'[ \t]*<!-- ga-on-ship:start.*?<!-- ga-on-ship:end -->[ \t]*\n?', '', s, flags=re.S)
    c = re.search(r'<meta\s+charset[^>]*>[ \t]*\n?', s, re.I)
    if not c:
        sys.exit(f'找不到 <meta charset>：{p}')
    end = c.end()
    sep = '' if s[c.start():end].endswith('\n') else '\n'
    s = s[:end] + sep + block + '\n' + s[end:]
    open(p, 'w', encoding='utf-8').write(s)
    print(f'已插入 GA：{p.rsplit("/", 1)[-1]}')
PY
fi
