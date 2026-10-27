import asyncio, sys, json
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from playwright.async_api import async_playwright
SH = SHOTS

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        mid = await make_map(page)
        await page.wait_for_timeout(2500)   # toast
        # ---- search ----
        await page.fill('input[data-m=q]', 'ユニクロ')
        await page.wait_for_timeout(400)
        n = await page.evaluate("document.querySelectorAll('.mm-sri').length")
        check('search ユニクロ → dropdown has items', n >= 1, n)
        vis = await page.evaluate("!document.querySelector('.mm-sr').hidden")
        check('dropdown visible', vis)
        await page.screenshot(path=SH + 'v_search.png')
        await page.press('input[data-m=q]', 'Enter')
        await page.wait_for_timeout(700)
        sel = await mm(page, "M.sel && M.map.pois.find(p => p.id === M.sel).n")
        check('Enter selects first hit (ユニクロ)', sel == 'ユニクロ', sel)
        card = await page.evaluate("!document.querySelector('.mm-pcard').hidden && document.querySelector('.mm-pcard').textContent")
        check('card shown with name', card and 'ユニクロ' in card, card)
        await page.screenshot(path=SH + 'v_card.png')
        # ---- search with no results / category ----
        await page.fill('input[data-m=q]', 'トイレ'); await page.wait_for_timeout(400)
        n = await page.evaluate("document.querySelectorAll('.mm-sri').length")
        check('search トイレ → >=3 hits', n >= 3, n)
        head = await page.evaluate("document.querySelector('.mm-pane[data-p=spots] .mm-sh span').textContent")
        check('list header shows search results', '検索結果' in head, head)
        await page.fill('input[data-m=q]', 'ほげほげ存在しない'); await page.wait_for_timeout(400)
        t = await page.evaluate("document.querySelector('.mm-sr').textContent")
        check('no-result message + AI ask button', '見つかりませんでした' in t and 'AIに聞く' in t, t)
        await page.click('[data-m=sclear]'); await page.wait_for_timeout(300)
        check('clear search resets list', await mm(page, "M.q === '' && !M.hits"))
        # ---- chips ----
        await page.click('[data-m=chip][data-g=food]'); await page.wait_for_timeout(300)
        r = await mm(page, "({ f: M.filter, items: document.querySelectorAll('.mm-pane[data-p=spots] .mm-it').length, on: document.querySelector('.mm-chip.on').dataset.g })")
        check('chip food filters list', r['f'] == 'food' and 0 < r['items'] < 20 and r['on'] == 'food', r)
        await page.click('[data-m=chip][data-g=all]'); await page.wait_for_timeout(200)
        # ---- floors ----
        await page.click('[data-m=floor][data-f="2F"]'); await page.wait_for_timeout(700)
        check('floor 2F selected', await mm(page, "V.floor") == '2F')
        # ---- 3D / 2D & keys ----
        await page.keyboard.press('3'); await page.wait_for_timeout(1400)
        check('key 3 → 3D', await mm(page, "V.is3d()"))
        await page.keyboard.press('2'); await page.wait_for_timeout(1400)
        check('key 2 → 2D', not await mm(page, "V.is3d()"))
        await page.keyboard.press(']'); await page.wait_for_timeout(500)
        check('key ] → next floor up', await mm(page, "V.floor") == '3F', await mm(page, "V.floor"))
        await page.keyboard.press('['); await page.keyboard.press('['); await page.wait_for_timeout(500)
        check('key [ x2 → 1F', await mm(page, "V.floor") == '1F', await mm(page, "V.floor"))
        # ---- weather dialog ----
        await page.click('[data-m=wx]'); await page.wait_for_selector('.mm-wxd', timeout=3000)
        t = await page.evaluate("document.querySelector('.mm-wxd').textContent")
        check('weather dialog has temperature/hours', '21' in t and '24' in t and '時' in t, t[:120])
        await page.screenshot(path=SH + 'v_wx.png')
        await page.keyboard.press('Escape'); await page.wait_for_timeout(400)
        check('weather dialog closed', await page.evaluate("!document.querySelector('.mm-wxd')"))
        # ---- info tab ----
        await page.click('[data-m=tab][data-t=info]'); await page.wait_for_timeout(300)
        t = await page.evaluate("document.querySelector('.mm-pane[data-p=info]').textContent")
        check('info tab: summary/hours/access/disclaimer', all(k in t for k in ['船橋市', '営業時間', '見取り図の目安', 'JR南船橋駅', 'いまの気温']), t[:200])
        await page.screenshot(path=SH + 'v_info.png')
        await page.click('[data-m=tab][data-t=spots]'); await page.wait_for_timeout(200)
        # ---- GPS inside ----
        await page.evaluate("window.__kd.MapMaker.test.geo = { lat: window.__mock.C.lat + 0.0002, lon: window.__mock.C.lon - 0.0004, acc: 14 }")
        await page.click('[data-m=gps]'); await page.wait_for_timeout(1200)
        g = await mm(page, "({ on: M.gps.on, inside: M.gps.inside, pos: !!M.gps.pos, stat: document.querySelector('.mm-gstat').textContent, hidden: document.querySelector('.mm-gstat').hidden })")
        check('GPS inside map', g['on'] and g['inside'] and g['pos'] and not g['hidden'] and 'このマップの中' in g['stat'], g)
        await page.screenshot(path=SH + 'v_gps.png')
        near = await page.evaluate("document.querySelectorAll('.mm-near .chip').length")
        check('near-spots chips shown', near >= 1, near)
        # route to selected
        await mm(page, "M.V.setFloor('1F')")
        await page.evaluate("window.__kd.MapMaker._t.select(window.__kd.MapMaker._t.M.map.pois.find(p => p.n === '丸亀製麺').id, {focus:true})")
        await page.wait_for_timeout(500)
        await page.click('[data-m=route]'); await page.wait_for_timeout(700)
        rt = await mm(page, "({ route: !!V.route, banner: document.querySelector('.mm-banner').textContent, hid: document.querySelector('.mm-banner').hidden })")
        check('route drawn + banner with distance', rt['route'] and not rt['hid'] and 'まで' in rt['banner'] and '約' in rt['banner'], rt)
        await page.screenshot(path=SH + 'v_route.png')
        # GPS off
        await page.click('[data-m=gps]'); await page.wait_for_timeout(300)
        check('GPS off', not await mm(page, "M.gps.on"))
        # GPS outside
        await page.evaluate("window.__kd.MapMaker.test.geo = { lat: window.__mock.C.lat + 0.1, lon: window.__mock.C.lon + 0.1, acc: 30 }")
        await page.click('[data-m=gps]'); await page.wait_for_timeout(800)
        g = await mm(page, "({ on: M.gps.on, inside: M.gps.inside, stat: document.querySelector('.mm-gstat').textContent })")
        check('GPS outside shows distance', g['on'] and not g['inside'] and 'はなれ' in g['stat'], g)
        await page.click('[data-m=gps]'); await page.wait_for_timeout(300)
        # ---- more menu ----
        await page.click('[data-m=more]'); await page.wait_for_timeout(300)
        items = await page.evaluate("[...document.querySelectorAll('.menu button, .menu [role=menuitem]')].map(b => b.textContent.trim())")
        print('menu items:', items)
        check('more menu has add/rename/remake/export/delete', all(any(k in s for s in items) for k in ['スポットを追加', '名前を変える', '作り直す', '書き出す', '削除']), items)
        await page.screenshot(path=SH + 'v_menu.png')
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
        sys.exit(summary(logs))

asyncio.run(main())
