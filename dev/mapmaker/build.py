#!/usr/bin/env python3
# マップ制作を入れる前の index.html に、src/ のモジュール・CSS・つなぎ込み(patches.py)を組み込んで、1つのHTMLを作る。
# 使い方: git show a80c267:index.html > base_index.html && python3 build.py base_index.html out/index.html
import sys, glob, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'base_index.html')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'out', 'index.html')
MM = os.path.join(HERE, 'src')
html = open(BASE, encoding='utf-8').read()
js = ''.join(open(f, encoding='utf-8').read() + '\n' for f in sorted(glob.glob(MM + '/[0-9][0-9]_*.js')))
css = open(MM + '/mm.css', encoding='utf-8').read() if os.path.exists(MM + '/mm.css') else ''

def once(s, anchor, repl, label=''):
    n = s.count(anchor)
    if n != 1:
        raise SystemExit(f'anchor not unique ({n}): {label or anchor[:60]}')
    return s.replace(anchor, repl)

marker = '/* ---- 89c_aicam.js ---- */'
html = once(html, marker, js + '\n' + marker, 'module marker')
i = html.index('</style>')
html = html[:i] + '/* mm:start */\n' + css + '\n/* mm:end */\n' + html[i:]

# ---- patches (anchor -> replacement) ----
patches = []
exec(open(MM + '/patches.py', encoding='utf-8').read()) if os.path.exists(MM + '/patches.py') else None
for a, r, label in patches:
    html = once(html, a, r, label)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(html)
print('built', OUT, len(html))
