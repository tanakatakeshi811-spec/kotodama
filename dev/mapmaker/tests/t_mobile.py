import asyncio, sys, json, os
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from playwright.async_api import async_playwright
SH = SHOTS

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 390, 844, dpr=2, mobile=True)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        await page.evaluate("window.__kd.MapMaker.open()"); await page.wait_for_timeout(600)
        await page.screenshot(path=SH + 'm_lib.png')
        ov = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check('library: no horizontal overflow', ov <= 1, ov)
        # create flow (mobile)
        await page.click('[data-m="new"]'); await page.wait_for_selector('.mm-dlg input[name=q]')
        await page.screenshot(path=SH + 'm_create1.png')
        await page.fill('.mm-dlg input[name=q]', 'ららぽーと'); await page.press('.mm-dlg input[name=q]', 'Enter')
        await page.wait_for_selector('.mm-cand'); await page.wait_for_timeout(200)
        await page.screenshot(path=SH + 'm_create2.png')
        await page.click('[data-a="make"]')
        await page.wait_for_function("window.__kd.MapMaker._t.M.screen === 'view' && window.__kd.MapMaker._t.M.map && !window.__kd.MapMaker._t.M.map.sample", timeout=40000)
        await page.wait_for_timeout(2800)
        await page.screenshot(path=SH + 'm_view_peek.png')
        r = await mm(page, "({ narrow: M.narrow, sheet: M.sheet, cls: M.el.className })")
        check('narrow layout active', r['narrow'] and r['sheet'] == 'peek', r)
        ov = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check('viewer: no horizontal overflow', ov <= 1, ov)
        # tap a poi on canvas → card + peek
        await mm(page, "MM._t.select(M.map.pois.find(p => p.n === 'ユニクロ').id, {focus:true})"); await page.wait_for_timeout(800)
        await page.screenshot(path=SH + 'm_view_card.png')
        # card must not overlap the sheet peek
        r = await mm(page, "(() => { const c = document.querySelector('.mm-pcard').getBoundingClientRect(), s = document.querySelector('.mm-side').getBoundingClientRect(); return { cardBottom: c.bottom, sideTop: s.top, cardTop: c.top, cardH: c.height }; })()")
        check('card sits above sheet', r['cardBottom'] <= r['sideTop'] + 2, r)
        # selected poi should be visible above the card
        r = await mm(page, "(() => { const q = V.R.byId.get(M.sel); const s = V.worldToScreen(q.cx, q.cy); const c = document.querySelector('.mm-pcard').getBoundingClientRect(); const st = document.querySelector('.mm-stage').getBoundingClientRect(); return { y: s[1], cardTop: c.top - st.top, x: s[0] }; })()")
        check('selected spot visible above card', r['y'] < r['cardTop'] - 4, r)
        # expand sheet by tapping the grab handle
        await mm(page, "MM._t.select(null)")
        await page.click('.mm-grab'); await page.wait_for_timeout(600)
        await page.screenshot(path=SH + 'm_view_half.png')
        check('sheet half', await mm(page, "M.sheet") == 'half')
        await page.click('.mm-grab'); await page.wait_for_timeout(600)
        await page.screenshot(path=SH + 'm_view_full.png')
        check('sheet full', await mm(page, "M.sheet") == 'full')
        await page.click('.mm-grab'); await page.wait_for_timeout(400)
        check('sheet peek again', await mm(page, "M.sheet") == 'peek')
        # drag the grab handle up
        g = await page.evaluate("(() => { const r = document.querySelector('.mm-grab').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
        await page.mouse.move(g[0], g[1]); await page.mouse.down(); 
        for i in range(1, 9): await page.mouse.move(g[0], g[1] - i * 40); await page.wait_for_timeout(16)
        await page.mouse.up(); await page.wait_for_timeout(500)
        s = await mm(page, "M.sheet"); print('after drag up:', s)
        check('drag handle up expands sheet', s in ('half', 'full'), s)
        await page.screenshot(path=SH + 'm_view_drag.png')
        # search on mobile
        await mm(page, "MM._t.setSheet('peek')")
        await page.tap('input[data-m=q]'); await page.keyboard.type('トイレ'); await page.wait_for_timeout(500)
        await page.screenshot(path=SH + 'm_search.png')
        n = await page.evaluate("document.querySelectorAll('.mm-sri').length")
        check('mobile search dropdown', n >= 3, n)
        await page.tap('.mm-sri >> nth=0'); await page.wait_for_timeout(700)
        check('mobile pick selects', await mm(page, "!!M.sel"))
        await page.screenshot(path=SH + 'm_search_pick.png')
        # AI tab
        await page.tap('[data-m=tab][data-t=ai]'); await page.wait_for_timeout(500)
        await page.screenshot(path=SH + 'm_ai.png')
        check('AI tab opens sheet', await mm(page, "M.sheet") != 'peek')
        # 3D in mobile
        await mm(page, "MM._t.setSheet('peek')"); await page.tap('[data-m=d3]'); await page.wait_for_timeout(1500)
        await page.screenshot(path=SH + 'm_view_3d.png')
        # weather dialog on mobile
        await page.tap('[data-m=wx]'); await page.wait_for_selector('.mm-wxd'); await page.wait_for_timeout(500)
        await page.screenshot(path=SH + 'm_wx.png')
        ov = await page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check('weather dialog: no horizontal overflow', ov <= 1, ov)
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
        sys.exit(summary(logs))

asyncio.run(main())
