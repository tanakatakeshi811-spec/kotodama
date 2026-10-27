import asyncio, sys, json, os
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from t_ai import FAKE
from util import *
from playwright.async_api import async_playwright
SH = SHOTS

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        await page.evaluate(FAKE)
        mid = await make_map(page)
        await page.wait_for_timeout(2600)
        # ---- start Live from the AI tab ----
        await page.click('[data-m=tab][data-t=ai]'); await page.wait_for_timeout(300)
        await page.click('[data-m=ai-live]'); await page.wait_for_timeout(1500)
        r = await mm(page, "({ docked: MM.docked, on: MM.on, live: window.__kd.Live.on, parent: M.el.parentElement.id, cls: M.el.className, liveHidden: document.getElementById('live').hidden, tab: M.tab })")
        print(r)
        check('Live started', r['live'])
        check('map docked into #live', r['docked'] and r['parent'] == 'live' and 'in-live' in r['cls'], r)
        check('AI tab hidden while docked (switched to spots)', r['tab'] == 'spots')
        await page.screenshot(path=SH + 'l_docked.png')
        # ---- type a message in Live ----
        await page.evaluate("window.__reply = 'おすすめは[[マップ:無印良品]]です。'")
        await page.evaluate("window.__kd.Live.send('無印良品はどのへん？')"); await page.wait_for_timeout(2200)
        n = await page.evaluate("window.__calls.length")
        check('Live message sent to engine', n >= 1, n)
        last = await page.evaluate("window.__calls[window.__calls.length - 1]")
        nimg = last['nimg']
        check('Live attaches map screen (1 image)', nimg == 1, nimg)
        lt = json.dumps(last['turns'][-1]['content'], ensure_ascii=False)
        check('image note mentions map screen', 'マップの画面' in lt, lt[-160:])
        check('system prompt is the live (short) variant with tags', '【いま開いているマップ' in last['turns'][0]['content'] and '[[マップ:' in last['turns'][0]['content'])
        sel = await mm(page, "M.map.pois.find(p => p.id === M.sel) && M.map.pois.find(p => p.id === M.sel).n")
        check('Live tag selected spot on docked map', sel == '無印良品', sel)
        um = await page.evaluate("(() => { const c = window.__kd.S.view; const u = c.msgs.filter(m => m.role === 'user').pop(); return { cam: u.cam || 0, live: u.live || 0, text: u.text }; })()")
        check('user message not flagged as camera video', um['cam'] == 0 and um['live'] == 1, um)
        await page.screenshot(path=SH + 'l_after.png')
        # ---- shot off ----
        await mm(page, "M.shotOn = false")
        await page.evaluate("window.__kd.Live.send('もう一回')"); await page.wait_for_timeout(2000)
        last = await page.evaluate("window.__calls[window.__calls.length - 1].nimg")
        check('no image when 画面を見せる is off', last == 0, last)
        await mm(page, "M.shotOn = true")
        # ---- close Live: map comes back full-screen ----
        await page.evaluate("window.__kd.Live.close()"); await page.wait_for_timeout(800)
        r = await mm(page, "({ docked: MM.docked, on: MM.on, parent: M.el.parentElement.tagName, cls: M.el.className, bodyOn: document.body.classList.contains('mm-on'), liveBody: document.body.classList.contains('mm-live') })")
        print(r)
        check('after Live closes: undocked, still open', (not r['docked']) and r['on'] and r['parent'] == 'BODY' and 'in-live' not in r['cls'] and r['bodyOn'] and not r['liveBody'], r)
        await page.screenshot(path=SH + 'l_closed.png')
        # ---- Live first, then open maps from Live ----
        await page.evaluate("window.__kd.MapMaker.close()"); await page.wait_for_timeout(300)
        await page.evaluate("window.__kd.Live.open()"); await page.wait_for_timeout(1200)
        check('Live on', await page.evaluate("window.__kd.Live.on"))
        await page.click('#lvMM'); await page.wait_for_timeout(900)
        r = await mm(page, "({ docked: MM.docked, on: MM.on, screen: M.screen })")
        check('map button in Live docks the library', r['docked'] and r['on'] and r['screen'] == 'lib', r)
        await page.screenshot(path=SH + 'l_lib_docked.png')
        await page.evaluate("window.__kd.MapMaker.openMap('sample-mall')"); await page.wait_for_timeout(1200)
        await page.screenshot(path=SH + 'l_sample_docked.png')
        # Esc in docked map shouldn't close Live or the map (only deselect)
        await page.evaluate("window.__kd.Live.close()"); await page.wait_for_timeout(800)
        r = await mm(page, "({ docked: MM.docked, on: MM.on })")
        check('Live opened first: closing Live closes the map too', not r['docked'] and not r['on'], r)
        sys.exit(summary(logs))

asyncio.run(main())
