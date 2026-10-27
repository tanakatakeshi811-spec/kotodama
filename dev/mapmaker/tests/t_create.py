import asyncio, sys, json
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from playwright.async_api import async_playwright
SH = SHOTS

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(MM) => 0", None)
        await page.evaluate("MM => (%s)(MM)" % MOCKS.strip().rstrip(';').replace('\n', '\n'), None) if False else None
        ok = await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        check('mocks installed', ok)
        await page.evaluate("window.__kd.MapMaker.open()")
        await page.wait_for_timeout(400)
        await page.click('[data-m="new"]')
        await page.wait_for_selector('.mm-dlg input[name=q]', timeout=5000)
        check('create dialog opened', True)
        await page.screenshot(path=SH + 'c_dialog1.png')
        await page.fill('.mm-dlg input[name=q]', 'ららぽーと')
        await page.press('.mm-dlg input[name=q]', 'Enter')
        await page.wait_for_selector('.mm-cand', timeout=5000)
        n = await page.evaluate("document.querySelectorAll('.mm-cand').length")
        check('two candidates (duplicate of the same place merged)', n == 2, n)
        first = await page.evaluate("document.querySelector('.mm-cand b').textContent")
        check('first candidate is the mall', 'ららぽーと' in first, first)
        await page.screenshot(path=SH + 'c_dialog2.png')
        await page.click('[data-a="make"]')
        await page.wait_for_selector('.mm-steps', timeout=3000)
        await page.screenshot(path=SH + 'c_dialog3.png')
        await page.wait_for_function("window.__kd.MapMaker._t.M.screen === 'view' && window.__kd.MapMaker._t.M.map && !window.__kd.MapMaker._t.M.map.sample", timeout=40000)
        await page.wait_for_timeout(1500)
        info = await page.evaluate("""() => { const m = window.__kd.MapMaker._t.M.map; const c = {}; m.pois.forEach(p => c[p.src] = (c[p.src]||0)+1);
          return { name: m.name, kind: m.kind, n: m.pois.length, src: c, floors: (m.floors||[]).map(f => f.id), bldgs: (m.bldgs||[]).map(b => b.n + ':' + b.fl), hasSite: !!m.site, ctxB: m.ctx && m.ctx.b.length, ctxR: m.ctx && m.ctx.r.length, sum: m.info && m.info.sum, ll: m.ll, id: m.id,
            ps: m.pois.reduce((a,p)=>{a[p.ps]=(a[p.ps]||0)+1;return a;},{}), noPos: m.pois.filter(p => p.x == null).length } }""")
        print(json.dumps(info, ensure_ascii=False))
        check('map name from dossier', 'ららぽーとTOKYO-BAY' in info['name'], info['name'])
        check('kind mall', info['kind'] == 'mall')
        check('has ~35 pois', info['n'] >= 30, info['n'])
        check('some osm+ai merged', info['src'].get('osm+ai', 0) >= 3, info['src'])
        check('3 floors', len(info['floors']) >= 3, info['floors'])
        check('all pois positioned', info['noPos'] == 0, info['noPos'])
        names = await page.evaluate("window.__kd.MapMaker._t.M.map.pois.map(p => p.n)")
        check('the mall itself is not listed as a spot', not any(n == 'ららぽーとTOKYO-BAY（テスト）' or n == 'ららぽーとTOKYO-BAY' for n in names), [n for n in names if 'ららぽーと' in n])
        check('a wing tagged shop=mall is not listed as a spot', not any('北館' in n for n in names), [n for n in names if '館' in n])
        check('real spots are still listed (ユニクロ)', 'ユニクロ' in names, names[:8])
        check('ctx buildings kept', (info['ctxB'] or 0) >= 2, info['ctxB'])
        calls = await page.evaluate("window.__mock.calls")
        print('calls: ai=%d fetch=%d wx=%d' % (len(calls['ai']), len(calls['fetch']), calls['wx']))
        check('ai calls were made (dossier + chunks)', len(calls['ai']) >= 5, len(calls['ai']))
        await page.screenshot(path=SH + 'c_view_2d.png')
        # saved?
        saved = await page.evaluate("""async () => { const S = window.__kd.MapMaker._t.Store; const l = await S.list(); return l.map(e => e.id + ':' + e.name + ':' + (e.sample?'s':'u')); }""")
        print('store list', saved)
        check('saved in Store', any(':u' in s for s in saved), saved)
        # thumb
        th = await page.evaluate("""async () => { const S = window.__kd.MapMaker._t.Store; const id = window.__kd.MapMaker._t.M.map.id; const t = await S.thumb(id); return t ? t.length : 0; }""")
        check('thumbnail saved', th > 2000, th)
        # Weather chip
        wx = await page.evaluate("document.querySelector('.mm-wx') && document.querySelector('.mm-wx').textContent")
        print('wx chip:', wx)
        check('weather chip shows temperature', wx and '21' in wx, wx)
        await page.click('[data-m="d3"]'); await page.wait_for_timeout(1500)
        await page.screenshot(path=SH + 'c_view_3d.png')
        # back to library: card exists
        await page.click('[data-m="back"]'); await page.wait_for_timeout(500)
        ncards = await page.evaluate("document.querySelectorAll('.mm-lc').length")
        check('library shows 4 cards (1 mine + 3 samples)', ncards == 4, ncards)
        await page.screenshot(path=SH + 'c_lib.png')
        # reload persistence
        await page.reload(); await page.wait_for_function('window.__kd && window.__kd.MapMaker', timeout=20000)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        await page.evaluate("window.__kd.MapMaker.open()"); await page.wait_for_timeout(800)
        ncards = await page.evaluate("document.querySelectorAll('.mm-lc').length")
        check('after reload still 4 cards', ncards == 4, ncards)
        await page.screenshot(path=SH + 'c_lib2.png')
        sys.exit(summary(logs))

asyncio.run(main())
