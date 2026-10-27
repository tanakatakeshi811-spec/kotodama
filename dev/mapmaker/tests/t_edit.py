import asyncio, sys, json, os
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from playwright.async_api import async_playwright
SH = SHOTS

async def until(page, expr, timeout=5000):
    """画面の操作のあと、状態がそうなるまで待つ（固定の待ち時間だと、描画が忙しいときに間に合わず、まれに落ちた）"""
    try: await page.wait_for_function("(() => { const MM = window.__kd.MapMaker, M = MM._t.M; return !!(%s); })()" % expr, timeout=timeout)
    except Exception: pass

async def menu_click(page, text):
    await page.click('[data-m=more]'); await page.wait_for_timeout(250)
    await page.locator('.menu button', has_text=text).first.click()

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        mid = await make_map(page)
        await page.wait_for_timeout(2600)
        n0 = await mm(page, "M.map.pois.length")
        # ---- add spot ----
        await menu_click(page, 'スポットを追加')
        await page.wait_for_selector('.mm-fm input[name=n]', timeout=3000)
        await page.fill('.mm-fm input[name=n]', 'テスト雑貨店')
        await page.select_option('.mm-fm select[name=f]', 'b1|2F')
        await page.screenshot(path=SH + 'e_add.png')
        await page.locator('.dlg-f button', has_text='地図で場所を決める').click()
        await page.wait_for_timeout(500)
        check('placing mode on', await mm(page, "!!M.place && M.el.classList.contains('placing')"))
        # click in the middle of the canvas
        box = await page.evaluate("(() => { const r = document.querySelector('.mm-cv').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()")
        await page.mouse.click(box[0] + box[2] * 0.45, box[1] + box[3] * 0.55)
        await page.wait_for_timeout(800)
        n1 = await mm(page, "M.map.pois.length")
        check('spot added', n1 == n0 + 1, (n0, n1))
        np_ = await mm(page, "M.map.pois.find(p => p.n === 'テスト雑貨店')")
        check('new spot has user flags & floor', np_ and np_.get('src') == 'user' and np_.get('ps') == 'user' and np_.get('f') == '2F' and np_.get('u') == 1, np_)
        check('new spot selected', await mm(page, "M.sel === M.map.pois.find(p => p.n === 'テスト雑貨店').id"))
        saved = await page.evaluate("window.__kd.MapMaker._t.Store.get(window.__kd.MapMaker._t.M.map.id).then(m => m.pois.length)")
        check('persisted after add', saved == n1, saved)
        await page.screenshot(path=SH + 'e_added.png')
        # ---- edit ----
        await page.click('[data-m=editp]'); await page.wait_for_selector('.mm-fm input[name=n]', timeout=3000)
        v = await page.input_value('.mm-fm input[name=n]')
        check('edit dialog prefilled', v == 'テスト雑貨店', v)
        await page.fill('.mm-fm input[name=n]', 'テスト雑貨店2')
        await page.fill('.mm-fm input[name=hrs]', '10:00-20:00')
        await page.locator('.dlg-f button', has_text='保存').click(); await page.wait_for_timeout(500)
        await until(page, "M.map.pois.some(p => p.n === 'テスト雑貨店2')")
        p2 = await mm(page, "M.map.pois.find(p => p.n === 'テスト雑貨店2')")
        check('renamed + hours saved', p2 and p2.get('hrs') == '10:00-20:00', p2)
        # ---- move ----
        await page.click('[data-m=editp]'); await page.wait_for_selector('.mm-fm input[name=n]', timeout=3000)
        await page.locator('.dlg-f button', has_text='位置を動かす').click(); await page.wait_for_timeout(500)
        await until(page, "M.place && M.place.id")
        check('move mode on', await mm(page, "!!M.place && !!M.place.id"))
        x0 = p2['x']
        await page.mouse.click(box[0] + box[2] * 0.30, box[1] + box[3] * 0.40); await page.wait_for_timeout(600)
        await until(page, "M.map.pois.find(p => p.n === 'テスト雑貨店2').x !== %r" % x0)
        p3 = await mm(page, "M.map.pois.find(p => p.n === 'テスト雑貨店2')")
        check('moved', p3['x'] != x0, (x0, p3['x']))
        # Escape cancels placement
        await menu_click(page, 'スポットを追加'); await page.wait_for_selector('.mm-fm input[name=n]')
        await page.fill('.mm-fm input[name=n]', 'キャンセルされる店'); await page.locator('.dlg-f button', has_text='地図で場所を決める').click(); await page.wait_for_timeout(300)
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
        check('Escape cancels placing', await mm(page, "!M.place && !M.map.pois.some(p => p.n === 'キャンセルされる店')"))
        # ---- delete spot ----
        await page.evaluate("window.__kd.MapMaker._t.select(window.__kd.MapMaker._t.M.map.pois.find(p => p.n === 'テスト雑貨店2').id, {focus:false})")
        await page.click('[data-m=editp]'); await page.wait_for_selector('.mm-fm input[name=n]')
        await page.locator('.dlg-f button', has_text='削除').click(); await page.wait_for_timeout(300)
        await page.locator('.dlg-f button', has_text='削除する').click(); await page.wait_for_timeout(500)
        await until(page, "M.map.pois.length === %d" % n0)
        check('spot deleted', await mm(page, "M.map.pois.length") == n0, await mm(page, "M.map.pois.length"))
        # ---- rename map ----
        await menu_click(page, '名前を変える'); await page.wait_for_timeout(300)
        inp = page.locator('.dlg input, .dlg textarea').first
        await inp.fill('マイ・ららぽーと'); await page.locator('.dlg-f button.primary').click(); await page.wait_for_timeout(400)
        try: await page.wait_for_function("document.querySelector('.mm-ttl b') && document.querySelector('.mm-ttl b').textContent === 'マイ・ららぽーと'", timeout=5000)
        except Exception: pass
        t = await page.evaluate("document.querySelector('.mm-ttl b').textContent")
        check('map renamed', t == 'マイ・ららぽーと', t)
        # ---- export ----
        async with page.expect_download(timeout=8000) as dl:
            await menu_click(page, 'ファイルに書き出す')
        d = await dl.value
        path = SH + 'export.json'; await d.save_as(path)
        j = json.load(open(path, encoding='utf-8'))
        check('export file valid', j.get('app') == 'kotodama-map' and j['map']['name'] == 'マイ・ららぽーと' and len(j['map']['pois']) == n0, list(j.keys()))
        print('export size KB', os.path.getsize(path) // 1024, 'name', d.suggested_filename)
        # ---- delete map ----
        # このマップ用に端末へ置いた目印（注意書きを出した回数・AIとの会話）。消したあとに残らないこと
        did = await mm(page, "M.map.id")
        await page.evaluate("id => { localStorage.setItem('kd:mmnote:' + id, '1'); localStorage.setItem('kd:mmchat:' + id, '[]'); }", did)
        await menu_click(page, 'このマップを削除'); await page.wait_for_timeout(300)
        await page.locator('.dlg-f button', has_text='削除する').click(); await page.wait_for_timeout(700)
        await until(page, "M.screen === 'lib'")
        check('back to library after delete', await mm(page, "M.screen") == 'lib')
        n = await page.evaluate("document.querySelectorAll('.mm-lc').length")
        check('library has only 3 samples', n == 3, n)
        left = await page.evaluate("id => [localStorage.getItem('kd:mmnote:' + id), localStorage.getItem('kd:mmchat:' + id)]", did)
        check('delete (viewer menu) leaves no per-map keys behind', left == [None, None], left)
        # ---- import ----
        async with page.expect_file_chooser(timeout=5000) as fc:
            await page.click('[data-m=import]')
        ch = await fc.value; await ch.set_files(path); await page.wait_for_timeout(1500)
        n = await page.evaluate("document.querySelectorAll('.mm-lc').length")
        check('import restores the map (4 cards)', n == 4, n)
        names = await page.evaluate("[...document.querySelectorAll('.mm-lc b, .mm-lc h3, .mm-lc .mm-ln')].map(e => e.textContent)")
        print(names)
        # ---- library menu (card menu) ----
        await page.screenshot(path=SH + 'e_lib.png')
        # open imported -> remake
        await page.evaluate("document.querySelector('.mm-lc:not(:has(.mm-bd))').click()") if False else None
        id2 = await page.evaluate("window.__kd.MapMaker._t.Store.list().then(l => l.find(e => !e.sample).id)")
        await page.evaluate("id => window.__kd.MapMaker.openMap(id)", id2); await page.wait_for_timeout(900)
        await menu_click(page, '作り直す'); await page.wait_for_selector('[data-a=make]', timeout=4000)
        await page.click('[data-a=make]')
        await page.wait_for_function("window.__kd.MapMaker._t.M.screen === 'view' && !document.querySelector('.mm-dlg')", timeout=40000)
        await page.wait_for_timeout(1500)
        cnt = await page.evaluate("window.__kd.MapMaker._t.Store.list().then(l => l.filter(e => !e.sample).length)")
        check('remake keeps single map (same id)', cnt == 1, cnt)
        same = await mm(page, "M.map.id") == id2
        check('remake kept id', same)
        # ---- ライブラリのカードのメニューから削除 ----
        await page.evaluate("id => { localStorage.setItem('kd:mmnote:' + id, '1'); localStorage.setItem('kd:mmchat:' + id, '[]'); }", id2)
        await page.click('.mm-view:not([hidden]) [data-m=back]'); await until(page, "M.screen === 'lib'")
        btn = page.locator('button.mm-lm[data-m=libmenu][data-id="%s"]' % id2)
        check('library card has a menu button', await btn.count() == 1, await btn.count())
        await btn.click(); await page.wait_for_timeout(250)
        await page.locator('.menu button', has_text='削除').first.click(); await page.wait_for_timeout(300)
        await page.locator('.dlg-f button', has_text='削除する').click()
        try: await page.wait_for_function("document.querySelectorAll('.mm-lc').length === 3", timeout=5000)
        except Exception: pass
        n = await page.evaluate("document.querySelectorAll('.mm-lc').length")
        left = await page.evaluate("id => [localStorage.getItem('kd:mmnote:' + id), localStorage.getItem('kd:mmchat:' + id)]", id2)
        listed = await page.evaluate("window.__kd.MapMaker._t.Store.list().then(l => l.filter(e => !e.sample).length)")
        check('library card menu delete: card gone, store empty, no per-map keys left', n == 3 and listed == 0 and left == [None, None], (n, listed, left))
        sys.exit(summary(logs))

asyncio.run(main())
