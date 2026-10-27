import asyncio, sys, json
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from t_gen import run_flow, make_and_wait, INFO
from playwright.async_api import async_playwright

# Overpass（公開サーバー）は遅い・混んでいることが多い。遅いときは別のサーバーにも同時に聞き、先に答えたほうを使う。
RUN = """async ([ms, abortAt, prefer]) => {
  const O = window.__kd.MapMaker._t.OSMX, t0 = performance.now();
  const ctl = new AbortController(); if (abortAt === 0) ctl.abort(); else if (abortAt) setTimeout(() => ctl.abort(), abortAt);
  try { const j = await O.overpass('[out:json];x;', ms, ctl.signal, prefer || 0); return { ok: true, n: j.elements.length, dt: performance.now() - t0, good: O._good }; }
  catch (e) { return { ok: false, code: e && e.code, msg: String((e && e.message) || ''), dt: performance.now() - t0 }; }
}"""
POSTS = "window.__mock.calls.fetch.filter(u => /interpreter/.test(u))"

async def setup(page, hedge, bad=None, allfail=False):
    await page.evaluate("([h, b, f]) => { const O = window.__kd.MapMaker._t.OSMX; O.hedgeMs = h; O._good = null; window.__mockOvBad = b; window.__mockOvFail = f; window.__mock.calls.fetch.length = 0; }", [hedge, bad, allfail])

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        urls = await page.evaluate("window.__kd.MapMaker._t.OSMX.OV()")
        check('has several overpass servers', len(urls) >= 3, urls)
        first, second = urls[0], urls[1]

        # 1) ふつう：1回で答えが来る → 追加の問い合わせはしない
        await setup(page, 200)
        r = await page.evaluate(RUN, [5000, None, 0]); print('normal', r)
        posts = await page.evaluate(POSTS)
        check('normal: ok with elements', r['ok'] and r['n'] > 0, r)
        check('normal: only one request', len(posts) == 1, posts)
        check('normal: remembers the working server', r['good'] == first, r)

        # 2) 1つめが遅い → 少し待って次のサーバーにも聞く → 速い方が勝つ（遅い方を待たない）
        await setup(page, 200, {'overpass-api.de': 'slow:3000'})
        r = await page.evaluate(RUN, [5000, None, 0]); print('slow first', r)
        posts = await page.evaluate(POSTS)
        check('slow first: answered by the next server, not after 3 s', r['ok'] and r['dt'] < 1500, r)
        check('slow first: asked first server, then the second', len(posts) == 2 and posts[0].startswith(first) and posts[1].startswith(second), posts)
        check('slow first: remembers the fast server', r['good'] == second, r)
        # 2b) 次の問い合わせは、前に速かったサーバーから始める（遅いサーバーを毎回さきに待たない）
        await page.evaluate("window.__mock.calls.fetch.length = 0")
        r = await page.evaluate(RUN, [5000, None, 0]); print('next call', r)
        posts = await page.evaluate(POSTS)
        check('next call: starts with the server that worked, one request', r['ok'] and len(posts) == 1 and posts[0].startswith(second), posts)
        await page.wait_for_timeout(3200)   # 遅いほうの返事が遅れて来ても何も起きない
        check('late answer from the slow server is ignored (no new request)', len(await page.evaluate(POSTS)) == 1)

        # 3) 1つめがすぐ失敗 → 待たずに次へ（待ち時間 hedgeMs は使わない）
        await setup(page, 5000, {'overpass-api.de': 'fail'})
        r = await page.evaluate(RUN, [5000, None, 0]); print('fail first', r)
        posts = await page.evaluate(POSTS)
        check('fail first: falls through to the next at once', r['ok'] and r['dt'] < 1000 and len(posts) == 2, (r, posts))

        # 4) 全部だめ → エラーを返す（全サーバーに1回ずつ聞いた後）
        await setup(page, 5000, None, True)
        r = await page.evaluate(RUN, [5000, None, 0]); print('all fail', r)
        posts = await page.evaluate(POSTS)
        check('all fail: rejects', (not r['ok']) and r.get('code') != 'cancelled', r)
        check('all fail: tried every server once', len(posts) == len(urls), posts)

        # 5) 途中で中止 → すぐ止まり、あとから追加の問い合わせもしない
        slow = {'overpass-api.de': 'slow:3000', 'private.coffee': 'slow:3000', 'kumi.systems': 'slow:3000'}
        await setup(page, 150, slow)
        r = await page.evaluate(RUN, [5000, 250, 0]); print('cancel', r)
        n_at = len(await page.evaluate(POSTS))
        check('cancel: rejects as cancelled quickly', (not r['ok']) and r['code'] == 'cancelled' and r['dt'] < 600, r)
        await page.wait_for_timeout(700)
        n_later = len(await page.evaluate(POSTS))
        check('cancel: no new requests after cancelling', n_later == n_at and n_at == 2, (n_at, n_later))
        # 5b) 最初から中止済み
        await setup(page, 150, slow)
        r = await page.evaluate(RUN, [5000, 0, 0]); print('pre-aborted', r)
        check('pre-aborted: cancelled, no request', (not r['ok']) and r['code'] == 'cancelled' and len(await page.evaluate(POSTS)) == 0, r)

        # 6) 2つ同時に聞くとき（prefer）は、別々のサーバーから始める
        await setup(page, 5000)
        r1, r2 = await asyncio.gather(page.evaluate(RUN, [5000, None, 0]), page.evaluate(RUN, [5000, None, 1]))
        posts = await page.evaluate(POSTS)
        check('two parallel queries start on different servers', len(posts) == 2 and posts[0].split('/api')[0] != posts[1].split('/api')[0], posts)

        # 7) 作成の流れ全体：1つめのサーバーが遅くてもマップはすぐできる
        await setup(page, 200, {'overpass-api.de': 'slow:60000'})
        import time; t0 = time.time()
        await run_flow(page, 'ららぽーと'); await make_and_wait(page, 30000)
        dt = time.time() - t0
        i = await page.evaluate(INFO); print('FLOW', round(dt, 1), json.dumps(i, ensure_ascii=False)[:300])
        check('flow: map made while first server is stuck', i['n'] >= 20 and len(i['bldgs']) >= 1, i['n'])
        check('flow: no "overpass unavailable" note', not (i['notes'] and '取得できません' in i['notes']), i['notes'])
        check('flow: not waiting for the stuck server', dt < 25, dt)
        sys.exit(summary(logs))
asyncio.run(main())
