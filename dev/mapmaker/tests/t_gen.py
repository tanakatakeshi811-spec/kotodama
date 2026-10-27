import asyncio, sys, json, os
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from playwright.async_api import async_playwright
SH = SHOTS

async def run_flow(page, q, wait_ok=True):
    await page.evaluate("window.__kd.MapMaker.close()"); await page.wait_for_timeout(100)
    await page.evaluate("window.__kd.MapMaker.open()"); await page.wait_for_timeout(300)
    await page.click('[data-m="new"]')
    await page.wait_for_selector('.mm-dlg input[name=q]', timeout=5000)
    await page.fill('.mm-dlg input[name=q]', q)
    await page.press('.mm-dlg input[name=q]', 'Enter')
    await page.wait_for_selector('.mm-cand, .mm-msg', timeout=8000)

async def make_and_wait(page, timeout=40000):
    await page.click('[data-a="make"]')
    await page.wait_for_function("window.__kd.MapMaker._t.M.screen === 'view' && window.__kd.MapMaker._t.M.map && !window.__kd.MapMaker._t.M.map.sample && !document.querySelector('.mm-dlg')", timeout=timeout)
    await page.wait_for_timeout(1200)

INFO = """() => { const m = window.__kd.MapMaker._t.M.map; const c = {}, ps = {}, cats = {}; m.pois.forEach(p => { c[p.src] = (c[p.src]||0)+1; ps[p.ps] = (ps[p.ps]||0)+1; cats[p.c] = (cats[p.c]||0)+1; });
  const inRing = (x, y, r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
  const out = m.pois.filter(p => !p.b); const inSite = out.filter(p => inRing(p.x, p.y, m.site)).length;
  return { name: m.name, kind: m.kind, n: m.pois.length, src: c, ps, cats, floors: (m.floors||[]).map(f => f.id), bldgs: (m.bldgs||[]).map(b => b.n + ':' + b.fl + (b.synth ? '(synth)' : '')), zones: (m.zones||[]).map(z => z.n + (z.ring ? '+ring' : '')), site: m.site.length, ctx: { b: m.ctx.b.length, r: m.ctx.r.length, w: m.ctx.w.length, g: m.ctx.g.length, k: m.ctx.k.length },
    outdoor: out.length, outdoorInSite: inSite, noPos: m.pois.filter(p => p.x == null || !isFinite(p.x) || !isFinite(p.y)).length, notes: m.info && m.info.notes, acc: m.info && m.info.acc, ext: m.ext } }"""

async def main_():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())

        # ===== park =====
        await run_flow(page, 'ディズニーランド')
        n = await page.evaluate("document.querySelectorAll('.mm-cand').length")
        check('park: candidate found', n == 1, n)
        kind_tag = await page.evaluate("document.querySelector('.mm-cand .tag').textContent")
        check('park: kind guessed as theme park', 'テーマパーク' in kind_tag, kind_tag)
        await make_and_wait(page)
        i = await page.evaluate(INFO); print('PARK', json.dumps(i, ensure_ascii=False))
        check('park: kind park, 4 zones', i['kind'] == 'park' and len(i['zones']) == 4, i['zones'])
        check('park: ~40 spots', i['n'] >= 35, i['n'])
        check('park: all positioned', i['noPos'] == 0)
        check('park: osm matched some', i['src'].get('osm+ai', 0) >= 5, i['src'])
        check('park: rides present', i['cats'].get('ride', 0) >= 10, i['cats'])
        check('park: outdoor spots inside the site', i['outdoorInSite'] >= i['outdoor'] * 0.8, (i['outdoorInSite'], i['outdoor']))
        check('park: no building floors', not i['floors'] or len(i['floors']) <= 1, i['floors'])
        await page.wait_for_timeout(2500)
        await page.screenshot(path=SH + 'g_park2d.png')
        await page.click('[data-m=d3]'); await page.wait_for_timeout(1500)
        await page.screenshot(path=SH + 'g_park3d.png')
        # zone headings in list
        heads = await page.evaluate("[...document.querySelectorAll('.mm-grp h4')].map(h => h.textContent)")
        print('park groups:', heads)
        check('park: spot list grouped by zones', any('ファンタジーランド' in h for h in heads), heads)

        # ===== store =====
        await run_flow(page, 'コストコ 幕張')
        kind_tag = await page.evaluate("document.querySelector('.mm-cand .tag').textContent")
        check('store: kind guessed', '大型店' in kind_tag or 'スーパー' in kind_tag, kind_tag)
        await make_and_wait(page)
        i = await page.evaluate(INFO); print('STORE', json.dumps(i, ensure_ascii=False))
        check('store: kind store', i['kind'] == 'store', i['kind'])
        check('store: ~20 spots', i['n'] >= 18, i['n'])
        check('store: all positioned', i['noPos'] == 0)
        check('store: single building with 1F', len(i['bldgs']) == 1 and '1F' in i['bldgs'][0], i['bldgs'])
        await page.wait_for_timeout(2500)
        await page.screenshot(path=SH + 'g_store2d.png')
        await page.click('[data-m=d3]'); await page.wait_for_timeout(1500)
        await page.screenshot(path=SH + 'g_store3d.png')

        # ===== no AI at all =====
        await page.evaluate("window.__kd.MapMaker.test.ai = null")
        await run_flow(page, 'ららぽーと')
        warn = await page.evaluate("!!document.querySelector('.mm-msg.warn')")
        check('no-AI: warning shown in dialog', warn)
        await make_and_wait(page)
        i = await page.evaluate(INFO); print('NOAI', json.dumps(i, ensure_ascii=False))
        check('no-AI: map from OSM only', i['acc'] == 'osm' and all(k == 'osm' for k in i['src']) and i['n'] >= 3, i)
        await page.wait_for_timeout(2500); await page.screenshot(path=SH + 'g_noai.png')
        await page.evaluate("window.__kd.MapMaker.test.ai = window.__mock_ai")  if False else None
        sys.exit(summary(logs))

if __name__ == "__main__": asyncio.run(main_())
