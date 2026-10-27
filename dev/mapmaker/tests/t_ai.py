import asyncio, sys, json, os
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from playwright.async_api import async_playwright
SH = SHOTS

FAKE = """
(() => {
  const E = window.__kd.Engine;
  E.kind = 'sample'; E.denied = false; E.relay = false; E.imgMax = 2; E.checked = true;
  window.__calls = [];
  window.__reply = 'おすすめは[[マップ:ユニクロ]]です。2階も見てみましょう。[[マップ階:2F]][[マップ表示:3D]][[マップ絞込:グルメ]]';
  window.__delay = 40; window.__fail = null;
  E.sample = async (turns, opts) => {
    window.__calls.push({ turns, nimg: (opts.images || []).length, imgType: (opts.images && opts.images[0] && opts.images[0].type) || '' });
    const r = window.__reply;
    if (window.__fail) { const f = window.__fail; window.__fail = null; throw f; }
    await new Promise((res, rej) => {
      const t = setTimeout(res, window.__delay);
      if (opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(t); rej({ code: 'cancelled' }); });
    });
    if (opts.onText) opts.onText({ text: r.slice(0, Math.floor(r.length / 2)) });
    return { text: r, modelApplied: 'fake' };
  };
  return true;
})()
"""

async def main_():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        await page.evaluate(FAKE)
        mid = await make_map(page)
        await page.wait_for_timeout(2600)
        # ---- AI tab: quick prompts, empty state ----
        await page.click('[data-m=tab][data-t=ai]'); await page.wait_for_timeout(300)
        quick = await page.evaluate("[...document.querySelectorAll('.mm-quick .chip')].map(c => c.textContent)")
        check('quick prompts shown', len(quick) >= 4, quick)
        check('empty-state hint shown', await page.evaluate("!!document.querySelector('.mm-aiw')"))
        await page.screenshot(path=SH + 'a_empty.png')
        # ---- send via textarea (Enter) ----
        await page.fill('textarea[data-m=aiin]', 'おすすめのお店は？')
        await page.click('.mm-send'); await page.wait_for_timeout(1500)
        c = await mm(page, "({ has: !!MM._t.MC.chat, mapId: MM._t.MC.chat && MM._t.MC.chat.mapId, n: MM._t.MC.chat && MM._t.MC.chat.msgs.length, title: MM._t.MC.chat && MM._t.MC.chat.title, ls: localStorage.getItem('kd_mmchat:' + M.map.id) })")
        print('chat:', c)
        check('chat created & bound to map', c['has'] and c['mapId'] == mid and c['n'] == 2, c)
        calls = await page.evaluate("window.__calls.length")
        check('engine called once', calls == 1, calls)
        sysp = await page.evaluate("JSON.stringify(window.__calls[0].turns[0].content)")
        sysT = json.loads(sysp)
        check('system prompt has map context header', '【いま開いているマップ' in sysT)
        check('system prompt lists spots (ユニクロ)', 'ユニクロ' in sysT and '【マップのスポット一覧' in sysT)
        check('system prompt has weather line', '21℃' in sysT, '')
        check('system prompt has tag instructions', '[[マップ:' in sysT and '[[マップ階:' in sysT)
        check('system prompt says view state (2D/階)', '画面の表示：' in sysT)
        print('system prompt length', len(sysT))
        nimg = await page.evaluate("window.__calls[0].nimg")
        check('map screenshot attached (default on)', nimg == 1, nimg)
        last = await page.evaluate("JSON.stringify(window.__calls[0].turns[window.__calls[0].turns.length - 1].content)")
        check('image note labels the map screen', 'ユーザーがいま見ているマップ' in json.loads(last), json.loads(last)[-200:])
        itype = await page.evaluate("window.__calls[0].imgType")
        check('screenshot is jpeg', itype == 'image/jpeg', itype)
        # ---- tags applied ----
        st = await mm(page, "({ sel: M.map.pois.find(p => p.id === M.sel) && M.map.pois.find(p => p.id === M.sel).n, floor: V.floor, is3: V.is3d(), filter: M.filter })")
        print('after tags:', st)
        check('tag [[マップ:ユニクロ]] selected spot', st['sel'] == 'ユニクロ', st)
        check('tag [[マップ階:2F]] switched floor', st['floor'] == '2F', st)
        check('tag [[マップ表示:3D]]', st['is3'], st)
        check('tag [[マップ絞込:グルメ]]', st['filter'] == 'food', st)
        # ---- rendered answer: tags hidden, chips present ----
        txt = await page.evaluate("document.querySelector('.mm-m.a .mm-ab').textContent")
        check('tags not shown in answer text', '[[' not in txt and 'おすすめは' in txt, txt)
        chips = await page.evaluate("[...document.querySelectorAll('.mm-tg2 .chip')].map(c => c.textContent)")
        check('"見る" chip for マップ tag', any('ユニクロ' in c for c in chips), chips)
        await page.screenshot(path=SH + 'a_answer.png')
        # chip click re-selects
        await mm(page, "M.V.setFloor('1F'), MM._t.select(null)")
        await page.click('.mm-tg2 .chip'); await page.wait_for_timeout(500)
        check('chip click selects spot again', await mm(page, "M.sel") is not None)
        # ---- quick prompt ----
        await page.evaluate("window.__reply = 'トイレは各階にあります。'")
        await page.click('.mm-quick .chip >> nth=0'); await page.wait_for_timeout(1200)
        n = await mm(page, "MM._t.MC.chat.msgs.length")
        check('quick prompt sent (4 msgs)', n == 4, n)
        # ---- history sent in 2nd call ----
        t2 = await page.evaluate("window.__calls[1].turns.map(t => t.role)")
        check('2nd call includes prior turns', len(t2) >= 4, t2)
        # ---- selected spot question (askp) ----
        await mm(page, "MM._t.select(M.map.pois.find(p => p.n === 'サイゼリヤ').id, {focus:false})")
        await page.click('[data-m=tab][data-t=spots]'); await page.wait_for_timeout(200)
        await page.click('[data-m=askp]'); await page.wait_for_timeout(1200)
        check('askp switches to AI tab and sends', await mm(page, "M.tab") == 'ai' and await mm(page, "MM._t.MC.chat.msgs.length") == 6)
        lastu = await page.evaluate("window.__calls[2].turns[window.__calls[2].turns.length - 1].content")
        check('askp question mentions spot', 'サイゼリヤ' in lastu, lastu[:80])
        sys3 = await page.evaluate("window.__calls[2].turns[0].content")
        check('selected spot passed in system prompt', 'いま選んでいるスポット：サイゼリヤ' in sys3)
        # ---- error + retry ----
        await page.evaluate("window.__fail = { code: 'upstream_error' }")
        await page.fill('textarea[data-m=aiin]', 'ここから映画館は近い？')
        await page.click('.mm-send'); await page.wait_for_timeout(1000)
        check('error shown with retry button', await page.evaluate("!!document.querySelector('.m-err [data-m=ai-retry]')"))
        await page.screenshot(path=SH + 'a_err.png')
        await page.evaluate("window.__reply = 'TOHOシネマズは3階です。[[マップ:TOHOシネマズ]]'")
        await page.click('[data-m=ai-retry]'); await page.wait_for_timeout(1500)
        check('retry succeeded', await page.evaluate("!document.querySelector('.m-err') && document.querySelector('.mm-m.a:last-child .mm-ab').textContent.includes('TOHO')"))
        sel = await mm(page, "M.map.pois.find(p => p.id === M.sel) && M.map.pois.find(p => p.id === M.sel).n")
        check('retry applied tag (TOHOシネマズ selected)', sel == 'TOHOシネマズ', sel)
        # ---- stop ----
        await page.evaluate("window.__delay = 5000; window.__reply = '長い回答'")
        await page.fill('textarea[data-m=aiin]', '長く考えて'); await page.click('.mm-send'); await page.wait_for_timeout(500)
        isstop = await page.evaluate("document.querySelector('.mm-send').dataset.m")
        check('send button becomes stop while busy', isstop == 'ai-stop', isstop)
        await page.click('.mm-send'); await page.wait_for_timeout(700)
        check('stopped → note shown & button back', await page.evaluate("document.querySelector('.mm-send').dataset.m === 'ai-send' && /止めました/.test(document.querySelector('.mm-log').textContent)"))
        await page.evaluate("window.__delay = 40")
        # ---- persistence: reopen map → chat restored ----
        await page.click('[data-m=back]'); await page.wait_for_timeout(300)
        await page.evaluate("id => window.__kd.MapMaker.openMap(id)", mid); await page.wait_for_timeout(900)
        await page.click('[data-m=tab][data-t=ai]'); await page.wait_for_timeout(400)
        nm = await page.evaluate("document.querySelectorAll('.mm-m').length")
        check('chat restored on reopen', nm >= 6, nm)
        # ---- chat in main UI shows the map chip ----
        await page.evaluate("window.__kd.MapMaker._t.MC.openInChat()"); await page.wait_for_timeout(800)
        check('map closed after openInChat', not await mm(page, "M.on"))
        h = await page.evaluate("document.querySelector('.geo-chips') ? document.querySelector('.geo-chips').textContent : ''")
        print('main chat chips:', h)
        check('main chat shows "マップで見る" chips', 'マップで見る' in h, h)
        await page.screenshot(path=SH + 'a_mainchat.png')
        # send from the main composer: context should still include the map (preload)
        await page.evaluate("window.__reply = 'はい。'")
        await page.fill('#input', 'ユニクロはどこ？'); await page.press('#input', 'Enter'); await page.wait_for_timeout(1500)
        k = await page.evaluate("window.__calls.length")
        sysm = await page.evaluate("window.__calls[window.__calls.length - 1].turns[0].content")
        check('main composer: system prompt keeps map context', '【いま開いているマップ' in sysm and 'ユニクロ' in sysm, sysm[:80])
        check('main composer: closed-map wording', 'さっきまで見ていました' in sysm)
        no_tags = '【マップを動かすタグ】' not in sysm and '【マップのタグ】' in sysm
        check('main composer: chip-tag instructions (not screen-move)', no_tags)
        # click chip in main chat → opens the map
        await page.evaluate("window.__reply = '[[マップ:無印良品]]ここです'")
        await page.fill('#input', '無印は？'); await page.press('#input', 'Enter'); await page.wait_for_timeout(1500)
        await page.locator('.geo-chips .chip[data-act=mm-pin]').last.click(); await page.wait_for_timeout(2500)
        sel = await mm(page, "M.on && M.screen === 'view' && M.map.pois.find(p => p.id === M.sel) && M.map.pois.find(p => p.id === M.sel).n")
        check('chip in main chat opens map & selects spot', sel == '無印良品', sel)
        sys.exit(summary(logs))

if __name__ == "__main__": asyncio.run(main_())
