#!/usr/bin/env python3
# 公開する index.html の一番大きい <script> を取り出し、構文(node --check)と未定義変数(eslint の no-undef)を調べる。
# 使い方: python3 lint.py [index.html]   (eslint は npm i -g eslint で入れる。無ければ構文だけ調べる)
import os, re, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
html = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'index.html'))
s = open(html, encoding='utf-8').read()
blocks = sorted((m.group(1) for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S)), key=len, reverse=True)
tmp = tempfile.mkdtemp(prefix='kdlint_')
open(os.path.join(tmp, 'app.js'), 'w', encoding='utf-8').write(blocks[0])
shutil.copy(os.path.join(HERE, 'eslint.config.mjs'), tmp)
rc = subprocess.call(['node', '--check', 'app.js'], cwd=tmp)
print('構文:', 'OK' if rc == 0 else 'エラー')
if rc == 0 and shutil.which('eslint'):
    rc = subprocess.call(['eslint', '-c', 'eslint.config.mjs', 'app.js'], cwd=tmp)
    print('未定義変数:', 'OK' if rc == 0 else 'あり')
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(rc)
