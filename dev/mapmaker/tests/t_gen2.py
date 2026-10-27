import asyncio, sys, json, os
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from t_gen import run_flow, make_and_wait, INFO
from playwright.async_api import async_playwright
SH = SHOTS

async def nmaps(page):
    return await page.evaluate("window.__kd.MapMaker._t.Store.list().then(l => l.filter(e => !e.sample).length)")

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())

        # 1) nothing found
        await run_flow(page, 'nothing here')
        t = await page.evaluate("document.querySelector('.mm-msg') && document.querySelector('.mm-msg').textContent")
        check('no candidates → friendly message', t and '見つかりませんでした' in t, t)
        # 2) nominatim failure
        await page.evaluate("window.__mockNomFail = true")
        await page.fill('.mm-dlg input[name=q]', 'ららぽーと'); await page.press('.mm-dlg input[name=q]', 'Enter'); await page.wait_for_timeout(500)
        t = await page.evaluate("document.querySelector('.mm-msg') && document.querySelector('.mm-msg').textContent")
        check('search failure → message', t and 'さがせませんでした' in t, t)
        await page.evaluate("window.__mockNomFail = false")
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)

        # 3) overpass down
        await page.evaluate("window.__mockOvFail = true")
        await run_flow(page, 'ららぽーと'); await make_and_wait(page)
        i = await page.evaluate(INFO); print('OVDOWN', json.dumps(i, ensure_ascii=False))
        check('overpass down: map still made', i['n'] >= 20, i['n'])
        check('overpass down: note recorded', i['notes'] and '取得できません' in i['notes'], i['notes'])
        check('overpass down: synthesized building', any('synth' in x for x in i['bldgs']) or len(i['bldgs']) >= 1, i['bldgs'])
        await page.wait_for_timeout(2500); await page.screenshot(path=SH + 'g2_ovdown.png')
        await page.click('[data-m=d3]'); await page.wait_for_timeout(1500); await page.screenshot(path=SH + 'g2_ovdown3d.png')
        await page.evaluate("window.__mockOvFail = false")

        # 4) dossier fails
        await page.evaluate("window.__mockAiFail = true")
        await run_flow(page, 'ららぽーと'); await make_and_wait(page)
        i = await page.evaluate(INFO); print('NODOSSIER', json.dumps(i, ensure_ascii=False))
        check('dossier failed: map still made', i['n'] >= 5, i['n'])
        check('dossier failed: note', i['notes'] and 'AIの下調べに失敗' in i['notes'], i['notes'])
        await page.evaluate("window.__mockAiFail = false")

        # 5) truncated list
        await page.evaluate("window.__mockTrunc = true")
        await run_flow(page, 'ららぽーと'); await make_and_wait(page)
        i = await page.evaluate(INFO)
        n3 = await page.evaluate("window.__kd.MapMaker._t.M.map.pois.filter(p => p.f === '3F').length")
        print('TRUNC 3F count', n3, 'total', i['n'])
        check('truncated list: partial items salvaged (1-3 on 3F)', 1 <= n3 <= 3, n3)
        await page.evaluate("window.__mockTrunc = false")

        # 6) cancel during run
        before = await nmaps(page)
        await page.evaluate("window.__mockAiMs = 900")
        await run_flow(page, 'ららぽーと'); await page.click('[data-a="make"]'); await page.wait_for_selector('.mm-steps'); await page.wait_for_timeout(600)
        await page.screenshot(path=SH + 'g2_running.png')
        await page.click('[data-a="cancel"]'); await page.wait_for_timeout(1500)
        back = await page.evaluate("!!document.querySelector('[data-a=make]') && !document.querySelector('.mm-steps')")
        check('cancel → back to confirm step', back)
        check('cancel → no map saved', await nmaps(page) == before, (before, await nmaps(page)))
        # 7) early finish
        await page.click('[data-a="make"]'); await page.wait_for_selector('.mm-steps')
        await page.evaluate("window.__mockAiMs = 500")
        await page.wait_for_function("!document.querySelector('[data-a=early]').disabled", timeout=30000)
        await page.screenshot(path=SH + 'g2_early.png')
        await page.click('[data-a="early"]')
        await page.wait_for_function("window.__kd.MapMaker._t.M.screen === 'view' && !document.querySelector('.mm-dlg')", timeout=30000); await page.wait_for_timeout(800)
        i = await page.evaluate(INFO)
        check('early finish: map made with partial results', i['n'] >= 3 and await nmaps(page) == before + 1, (i['n'], await nmaps(page)))
        print('EARLY n=', i['n'])
        # 8) close dialog during run
        before = await nmaps(page)
        await page.evaluate("window.__mockAiMs = 900")
        await run_flow(page, 'ららぽーと'); await page.click('[data-a="make"]'); await page.wait_for_selector('.mm-steps'); await page.wait_for_timeout(400)
        await page.click('.mm-dlg [data-x]'); await page.wait_for_timeout(2500)
        # X during a run = cancel the run and go back to the confirm step (a second X closes the dialog)
        back2 = await page.evaluate("!!document.querySelector('[data-a=make]') && !document.querySelector('.mm-steps')")
        check('X during run → run cancelled, back to confirm step', back2)
        n_after = await nmaps(page)
        check('X during run → no map saved', n_after == before, (before, n_after))
        await page.click('.mm-dlg [data-x]'); await page.wait_for_timeout(600)
        gone = await page.evaluate("!document.querySelector('.mm-dlg')")
        check('second X → dialog closed', gone)
        await page.wait_for_timeout(1500)
        check('closed dialog → still no map saved / still on library', await nmaps(page) == before and await page.evaluate("window.__kd.MapMaker._t.M.screen") == 'lib')
        await page.evaluate("window.__mockAiMs = 20")
        # 9) nothing at all: no AI + no named features
        await page.evaluate("window.__kd.MapMaker.test.ai = null; window.__mockNoNamed = true")
        await page.keyboard.press('Escape')
        await run_flow(page, 'ららぽーと'); await page.click('[data-a="make"]'); await page.wait_for_timeout(2500)
        t = await page.evaluate("document.querySelector('.mm-msg.warn') && document.querySelector('.mm-msg.warn').textContent")
        print('empty msg:', t)
        check('nothing found → error message shown on confirm step', t and '見つかりませんでした' in t, t)
        sys.exit(summary(logs))

asyncio.run(main())
