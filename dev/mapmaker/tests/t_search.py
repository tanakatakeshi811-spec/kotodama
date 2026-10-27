import asyncio, sys, json
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from playwright.async_api import async_playwright

async def cands(page, q):
    await page.evaluate("window.__kd.MapMaker.open()"); await page.wait_for_timeout(300)
    await page.click('[data-m="new"]'); await page.wait_for_selector('.mm-dlg input[name=q]', timeout=5000)
    await page.fill('.mm-dlg input[name=q]', q); await page.press('.mm-dlg input[name=q]', 'Enter')
    await page.wait_for_function("document.querySelector('.mm-cand') || document.querySelector('.mm-msg')", timeout=15000)
    r = await page.evaluate("[...document.querySelectorAll('.mm-cand')].map(c => c.innerText.replace(/\\n+/g, ' | '))")
    await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
    return r

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        # 1) 普通の検索（地名が結果に出る）→ 追加の検索はしない
        await page.evaluate("window.__mock.calls.fetch.length = 0")
        r = await cands(page, 'ららぽーと 船橋')
        calls = await page.evaluate("window.__mock.calls.fetch.filter(u => /nominatim.*search/.test(u)).length")
        print('plain', r, 'search calls', calls)
        # 2) お店の名前＋地名：ふつうの検索は別の県のコストコ → 地名のまわりで探しなおして近くのコストコを先頭に
        await page.evaluate("window.__mockDecoy = true; window.__mock.calls.fetch.length = 0")
        r = await cands(page, 'コストコ 海浜')
        urls = await page.evaluate("window.__mock.calls.fetch.filter(u => /nominatim.*search/.test(u))")
        print('decoy', r); print('urls', urls)
        check('name+place: nearest store comes first', len(r) >= 1 and '千葉' in r[0] and '幕張' in r[0], r)
        check('name+place: the far store is still offered after it', len(r) >= 2 and '岐阜' in r[1], r)
        check('name+place: a place-bounded search was made', any('bounded=1' in u for u in urls), urls)
        # 3) 逆の順番（地名 → 名前）でも
        await page.evaluate("window.__mock.calls.fetch.length = 0")
        r = await cands(page, '海浜 コストコ')
        print('reverse', r)
        check('place+name (reverse order): nearest store comes first', len(r) >= 1 and '千葉' in r[0], r)
        # 4) 地名が見つからない（別の言い方）でも、ふつうの結果は出る
        r = await cands(page, 'コストコ ほげほげ')
        check('unknown place word: still shows the plain results', len(r) >= 1, r)
        await page.evaluate("window.__mockDecoy = false")
        # 5) 1語の検索は追加の検索をしない
        await page.evaluate("window.__mock.calls.fetch.length = 0")
        r = await cands(page, 'ららぽーと')
        calls = await page.evaluate("window.__mock.calls.fetch.filter(u => /nominatim.*search/.test(u)).length")
        check('single word: exactly one search request', calls == 1, calls)
        sys.exit(summary(logs))
asyncio.run(main())
