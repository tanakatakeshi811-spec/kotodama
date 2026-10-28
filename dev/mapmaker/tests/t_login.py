import asyncio, sys, json, time
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from t_gen import run_flow, make_and_wait, INFO
from playwright.async_api import async_playwright

# AIが「ログイン切れ」で使えないとき（本物の中継で起きた：PCのClaude Codeのログインが切れ、毎回
# 「Failed to authenticate: OAuth session expired and could not be refreshed」が返る）。
#  ・何度聞いても同じなので、聞き直さない（前は聞き直しだけで1〜2分待たされた）
#  ・すぐ「AIなし」（OpenStreetMapだけ）に切り替えて、マップは作る
#  ・理由を画面に出す（注記・はじめの案内・お店が1つもないときのエラー）
#  ・ログインとは関係のない一時的な中継エラーは、これまで通り聞き直す
AI = "window.__mock.calls.ai"
DOS = "/この場所について、次のJSON/"

async def reset(page, **flags):
    await page.evaluate("(f) => { window.__mockAiLogin = f.login || null; window.__mockAiCode = f.code || null; window.__mockAiRelayErr = f.relayErr || 0; window.__mockNoNamed = !!f.noNamed; window.__mock.calls.ai.length = 0; }", flags)

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        M = "window.__kd.MapMaker._t.M"

        # 1) 下調べの時点でログイン切れ：聞き直さず、OpenStreetMapだけで作る
        await reset(page, login='all')
        await run_flow(page, 'ららぽーと')
        t0 = time.time(); await make_and_wait(page, 30000); dt = time.time() - t0
        calls = await page.evaluate(AI); i = await page.evaluate(INFO); info = await page.evaluate(M + ".map.info")
        print('LOGIN all', round(dt, 1), 's, ai calls', len(calls), 'n', i['n'], 'acc', i['acc'])
        check('login lost (dossier): AI asked only once (no retries, no list calls)', len(calls) == 1, [c['user'][:30] for c in calls])
        check('login lost (dossier): map made quickly from OpenStreetMap only', i['n'] >= 5 and dt < 8, (i['n'], round(dt, 1)))
        check('login lost (dossier): labelled as osm only, reason recorded', i['acc'] == 'osm' and info.get('aiDown') == 'relay' and not info.get('ai') and not info.get('search'), (i['acc'], info.get('aiDown'), info.get('ai')))
        check('login lost (dossier): note tells how to fix', i['notes'] and 'ログインが切れ' in i['notes'] and '/login' in i['notes'], i['notes'])
        check('login lost (dossier): all spots come from OSM', set(i['src'].keys()) <= {'osm'}, i['src'])
        banner = await page.evaluate("(document.querySelector('.mm-banner') || {}).textContent || ''")
        check('login lost: first-view banner names the reason', 'ログインが切れていた' in banner and '作り直す' in banner, banner)

        # 2) 下調べはできたが、店のリストの途中でログイン切れ：残りは聞かない（最初の同時3本だけ）
        await reset(page, login='chunks')
        await run_flow(page, 'ららぽーと')
        t0 = time.time(); await make_and_wait(page, 30000); dt = time.time() - t0
        calls = await page.evaluate(AI); i = await page.evaluate(INFO); info = await page.evaluate(M + ".map.info")
        users = [c['user'] for c in calls]
        print('LOGIN chunks', round(dt, 1), 's, ai calls', len(calls), 'n', i['n'], 'acc', i['acc'])
        check('login lost (list): dossier + at most the first 3 parallel list calls', 2 <= len(calls) <= 4, len(calls))
        check('login lost (list): nothing asked twice', len(set(users)) == len(users), users)
        check('login lost (list): no retry waits', dt < 8, round(dt, 1))
        check('login lost (list): osm only, reason recorded, note', i['acc'] == 'osm' and info.get('aiDown') == 'relay' and i['notes'] and 'ログインが切れ' in i['notes'], (i['acc'], info.get('aiDown'), i['notes']))
        check('login lost (list): the dossier was still used (name/buildings)', i['n'] >= 5, i['n'])
        check('login lost (list): no "could not investigate X" spam', not i['notes'] or '調べられませんでした' not in i['notes'], i['notes'])

        # 3) OpenStreetMapにもお店がない → エラーでも、本当の理由（ログイン切れ）を伝える
        await reset(page, login='all', noNamed=True)
        before = await page.evaluate("window.__kd.MapMaker._t.Store.list().then(l => l.filter(e => !e.sample).length)")
        await run_flow(page, 'ららぽーと'); await page.click('[data-a="make"]')
        await page.wait_for_selector('.mm-cr .mm-msg.warn', timeout=15000)
        msg = await page.evaluate("document.querySelector('.mm-cr .mm-msg.warn').textContent")
        after = await page.evaluate("window.__kd.MapMaker._t.Store.list().then(l => l.filter(e => !e.sample).length)")
        print('EMPTY', msg)
        check('no spots at all + login lost: message says why and how to fix', 'ログインが切れて' in msg and '/login' in msg and 'もう一度' in msg, msg)
        check('no spots at all: nothing saved', after == before, (before, after))
        await page.evaluate("window.__mockNoNamed = false")
        await page.keyboard.press('Escape'); await page.wait_for_timeout(400)   # エラーの出た作成ダイアログを閉じる

        # 4) APIキーまちがい／Claudeのログイン期限切れ（コードだけのエラー）も、聞き直さず理由を出す
        for code, why, key in (('api_key', 'key', 'APIキーが正しくない'), ('session_expired', 'session', 'ログインの期限が切れて')):
            await reset(page, code=code)
            await run_flow(page, 'ららぽーと')
            t0 = time.time(); await make_and_wait(page, 30000); dt = time.time() - t0
            calls = await page.evaluate(AI); i = await page.evaluate(INFO); info = await page.evaluate(M + ".map.info")
            check('%s: one AI call, osm-only map, reason and note' % code, len(calls) == 1 and i['acc'] == 'osm' and info.get('aiDown') == why and i['notes'] and key in i['notes'] and dt < 8, (len(calls), i['acc'], info.get('aiDown'), i['notes'], round(dt, 1)))

        # 5) ログインとは関係ない一時的な中継エラーは、これまで通り聞き直す（1回目だけ失敗 → 4秒あけて2回目で成功）
        await reset(page, relayErr=1)
        await run_flow(page, 'ららぽーと')
        t0 = time.time(); await make_and_wait(page, 40000); dt = time.time() - t0
        calls = await page.evaluate(AI); i = await page.evaluate(INFO); info = await page.evaluate(M + ".map.info")
        dosn = len([c for c in calls if '次のJSON' in c['user']])
        print('TRANSIENT', round(dt, 1), 's, dossier asks', dosn, 'acc', i['acc'])
        check('transient relay error is still retried (dossier asked twice) and AI result used', dosn == 2 and i['acc'] == 'osm+ai' and not info.get('aiDown') and i['n'] >= 20, (dosn, i['acc'], info.get('aiDown'), i['n']))
        check('transient relay error: no login note', not i['notes'] or 'ログイン' not in i['notes'], i['notes'])
        await reset(page)

        # 6) 本体のエラー文：ログイン切れは日本語の案内、ほかの中継エラーはこれまで通り
        r = await page.evaluate("""() => { const e = window.__kd.errText; return [
          e({ code: 'relay_error', message: 'Failed to authenticate: OAuth session expired and could not be refreshed' }),
          e({ code: 'relay_error', message: 'Claude Code exited with code 1' }),
          e({ code: 'upstream_error' }), e({ code: 'relay_down' })]; }""")
        print(r)
        check('errText: login expired → Japanese fix instructions', 'ログインが切れています' in r[0] and '/login' in r[0] and 'Failed' not in r[0], r[0])
        check('errText: other relay errors unchanged', r[1] == '中継サーバーのエラー：Claude Code exited with code 1' and r[2] == '通信が途切れました。もう一度お試しください。' and '中継サーバーにつながりません' in r[3], r[1:])
        sys.exit(summary(logs))
asyncio.run(main())
