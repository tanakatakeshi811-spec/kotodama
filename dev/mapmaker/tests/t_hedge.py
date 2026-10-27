import asyncio, sys, json, time
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from t_gen import run_flow, make_and_wait, INFO
from playwright.async_api import async_playwright

# Overpass（公開サーバー）は遅い・混んでいる・止まっていることが多い。
#  ・すぐ断られたサーバーは、少し待ってもう一度だけ聞く
#  ・遅いときは別のサーバーにも同時に聞き、先に答えたほうを使う（遅かったほうは中止）
#  ・建物・道路 と 名前のある場所 は同時に聞く(1本ずつだと待ちが2倍)。同じサーバーへは2本まで
RUN = """async ([ms, abortAt, kind]) => {
  const O = window.__kd.MapMaker._t.OSMX, t0 = performance.now();
  const ctl = new AbortController(); if (abortAt === 0) ctl.abort(); else if (abortAt) setTimeout(() => ctl.abort(), abortAt);
  try { const j = await O.overpass('[out:json];x;', ms, ctl.signal, kind); return { ok: true, n: j.elements.length, dt: performance.now() - t0, good: O._good[kind || ''] }; }
  catch (e) { return { ok: false, code: e && e.code, msg: String((e && e.message) || ''), dt: performance.now() - t0 }; }
}"""
POSTS = "window.__mock.calls.fetch.filter(u => /interpreter/.test(u))"

async def setup(page, hedge, bad=None, allfail=False, retry=100):
    await page.wait_for_function('!window.__ovInflight', timeout=15000)   # 前の項目で遅れて返事が来るぶんが終わるまで待つ
    await page.evaluate("([h, b, f, r]) => { const O = window.__kd.MapMaker._t.OSMX; O.hedgeMs = h; O.retryMs = r; O._good = {}; window.__mockOvBad = b; window.__mockOvCnt = {}; window.__mockOvFail = f; window.__mock.calls.fetch.length = 0; window.__ovMax = 0; window.__ovStarts = []; }", [hedge, bad, allfail, retry])

def host(u): return u.split('/api')[0].split('/osm')[0]

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        urls = await page.evaluate("window.__kd.MapMaker._t.OSMX.OV()")
        check('has several overpass servers', len(urls) >= 3, urls)
        first, second = urls[0], urls[1]
        slow = {'overpass-api.de': 'slow:3000', 'private.coffee': 'slow:3000', 'maps.mail.ru': 'slow:3000', 'kumi.systems': 'slow:3000'}

        # 1) ふつう：1回で答えが来る → 追加の問い合わせはしない
        await setup(page, 200)
        r = await page.evaluate(RUN, [5000, None, 'k']); print('normal', r)
        posts = await page.evaluate(POSTS)
        check('normal: ok with elements', r['ok'] and r['n'] > 0, r)
        check('normal: only one request', len(posts) == 1, posts)
        check('normal: remembers the working server', r['good'] == first, r)

        # 2) 1つめが遅い → 少し待って次のサーバーにも聞く → 速い方が勝つ（遅い方を待たない）
        await setup(page, 200, {'overpass-api.de': 'slow:3000'})
        r = await page.evaluate(RUN, [5000, None, 'k']); print('slow first', r)
        posts = await page.evaluate(POSTS)
        check('slow first: answered by the next server, not after 3 s', r['ok'] and r['dt'] < 1500, r)
        check('slow first: asked first server, then the second', len(posts) == 2 and posts[0].startswith(first) and posts[1].startswith(second), posts)
        check('slow first: remembers the fast server', r['good'] == second, r)
        # 2b) 同じ種類の次の問い合わせは、前に速かったサーバーから始める（遅いサーバーを毎回さきに待たない）
        await page.evaluate("window.__mock.calls.fetch.length = 0")
        r = await page.evaluate(RUN, [5000, None, 'k']); print('next call', r)
        posts = await page.evaluate(POSTS)
        check('next call (same kind): starts with the server that worked, one request', r['ok'] and len(posts) == 1 and posts[0].startswith(second), posts)
        await page.wait_for_timeout(3200)   # 遅いほうの返事が遅れて来ても何も起きない
        check('late answer from the slow server is ignored (no new request)', len(await page.evaluate(POSTS)) == 1)

        # 3) 1つめがすぐ失敗 → 待たずに次のサーバーへ（待ち時間 hedgeMs は使わない）。もう一度は後で
        await setup(page, 5000, {'overpass-api.de': 'fail'}, False, 5000)
        r = await page.evaluate(RUN, [5000, None, 'k']); print('fail first', r)
        posts = await page.evaluate(POSTS)
        check('fail first: falls through to the next at once', r['ok'] and r['dt'] < 1000 and len(posts) == 2 and posts[1].startswith(second), (r, posts))

        # 4) すぐ断られた（混んでいる）サーバーは、少し待ってもう一度だけ聞く → 他が遅くても、そのサーバーが答える
        bad = dict(slow); bad['overpass-api.de'] = 'failn:1'
        await setup(page, 5000, bad, False, 100)
        r = await page.evaluate(RUN, [5000, None, 'k']); print('busy once', r)
        posts = await page.evaluate(POSTS)
        check('busy once: asked again after a short wait and answered', r['ok'] and r['dt'] < 1500 and r['good'] == first, r)
        check('busy once: first server asked twice, the next one once', len([u for u in posts if u.startswith(first)]) == 2 and len(posts) == 3, posts)
        # 4b) 2回断られたら、もう同じサーバーには聞かない
        bad = dict(slow); bad['overpass-api.de'] = 'failn:5'
        await setup(page, 5000, bad, False, 100)
        r = await page.evaluate(RUN, [1500, None, 'k']); print('busy always', r)
        posts = await page.evaluate(POSTS)
        check('busy always: a server is asked at most twice', len([u for u in posts if u.startswith(first)]) == 2, posts)

        # 4c) 処理が間に合わなかったサーバーは、エラーではなく「空っぽの結果＋remark(runtime error)」を返す → 成功にせず、次のサーバーに聞く
        await setup(page, 5000, {'overpass-api.de': 'remark'}, False, 5000)
        r = await page.evaluate(RUN, [5000, None, 'k']); print('remark', r)
        posts = await page.evaluate(POSTS)
        check('server-side timeout (empty result + remark) is not taken as success; the next server is asked', r['ok'] and r['n'] > 0 and r['good'] == second and len(posts) >= 2 and posts[1].startswith(second), (r, posts))
        await setup(page, 5000, {'overpass-api.de': 'remark', 'private.coffee': 'remark', 'maps.mail.ru': 'remark', 'kumi.systems': 'remark'}, False, 100)
        r = await page.evaluate(RUN, [5000, None, 'k']); print('remark everywhere', r)
        check('server-side timeout everywhere: rejects (no empty data passed off as a map)', (not r['ok']) and r.get('code') != 'cancelled', r)

        # 5) 全部だめ → エラーを返す（どのサーバーにも、断られたあとの「もう一度」を1回ずつ）
        await setup(page, 5000, None, True, 100)
        r = await page.evaluate(RUN, [5000, None, 'k']); print('all fail', r)
        posts = await page.evaluate(POSTS)
        check('all fail: rejects', (not r['ok']) and r.get('code') != 'cancelled', r)
        check('all fail: every server asked twice, no more', len(posts) == 2 * len(urls), (len(posts), posts))

        # 6) 途中で中止 → すぐ止まり、あとから追加の問い合わせもしない
        await setup(page, 150, slow)
        r = await page.evaluate(RUN, [5000, 250, 'k']); print('cancel', r)
        n_at = len(await page.evaluate(POSTS))
        check('cancel: rejects as cancelled quickly', (not r['ok']) and r['code'] == 'cancelled' and r['dt'] < 600, r)
        await page.wait_for_timeout(700)
        n_later = len(await page.evaluate(POSTS))
        check('cancel: no new requests after cancelling', n_later == n_at and n_at == 2, (n_at, n_later))
        # 6b) 「もう一度」を待っているあいだに中止 → もう聞かない
        await setup(page, 5000, None, True, 400)
        r = await page.evaluate(RUN, [5000, 200, 'k'])
        n_at = len(await page.evaluate(POSTS)); await page.wait_for_timeout(900)
        check('cancel while waiting to ask again: cancelled, nothing more asked', (not r['ok']) and r['code'] == 'cancelled' and len(await page.evaluate(POSTS)) == n_at, (r, n_at))
        # 6c) 最初から中止済み
        await setup(page, 150, slow)
        r = await page.evaluate(RUN, [5000, 0, 'k']); print('pre-aborted', r)
        check('pre-aborted: cancelled, no request', (not r['ok']) and r['code'] == 'cancelled' and len(await page.evaluate(POSTS)) == 0, r)

        # 7) 作成の流れ全体：建物・道路 と 名前のある場所 は、同時に聞く（本物の公開サーバーは混んでいて、1本ずつだと待ちが2倍になる）
        await setup(page, 5000, {'overpass-api.de': 'slow:600'})
        await run_flow(page, 'ららぽーと'); await make_and_wait(page, 30000)
        posts = await page.evaluate(POSTS); starts = await page.evaluate("window.__ovStarts")
        i = await page.evaluate(INFO)
        check('flow: two queries (buildings/roads and named places) asked at the same time', len(posts) == 2 and len(starts) == 2 and abs(starts[1] - starts[0]) < 200, (len(posts), starts))
        check('flow: both start on the main server (one each, so at most 2 at a time per server)', all(u.startswith(first) for u in posts), posts)
        check('flow: map made with buildings and spots', i['n'] >= 20 and len(i['bldgs']) >= 1, i['n'])

        # 8) 作成の流れ全体：1つめのサーバーが止まっていても、マップはすぐできる（どちらの問い合わせも別サーバーが答える）
        await setup(page, 200, {'overpass-api.de': 'slow:60000'})
        t0 = time.time()
        await run_flow(page, 'ららぽーと'); await make_and_wait(page, 30000)
        dt = time.time() - t0
        posts = await page.evaluate(POSTS); i = await page.evaluate(INFO)
        print('FLOW', round(dt, 1), [host(u) for u in posts])
        check('flow (first server stuck): map made', i['n'] >= 20 and len(i['bldgs']) >= 1, i['n'])
        check('flow (first server stuck): no "overpass unavailable" note', not (i['notes'] and '取得できません' in i['notes']), i['notes'])
        check('flow (first server stuck): not waiting for the stuck server', dt < 25, dt)
        check('flow (first server stuck): each query was also asked of the next server', len([u for u in posts if u.startswith(second)]) == 2, [host(u) for u in posts])
        sys.exit(summary(logs))
asyncio.run(main())
