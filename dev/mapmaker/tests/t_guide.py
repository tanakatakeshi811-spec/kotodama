import asyncio, sys
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.wait_for_timeout(500)
        info = await page.evaluate("""() => {
          const items = [...document.querySelectorAll('[data-chat], .chat-item, .conv, li, button')].filter(e => /何ができるの/.test(e.textContent || ''));
          return items.slice(0, 3).map(e => e.tagName + '.' + e.className + ' ' + (e.textContent || '').slice(0, 40));
        }""")
        print('items', info)
        await page.click('[data-act="open-guide"]'); clicked = True
        await page.wait_for_timeout(800)
        txt = await page.evaluate("document.body.innerText")
        check('guide shows マップ制作 row', 'マップ制作' in txt and '左の一覧の「マップ制作」' in txt, clicked)
        i = txt.find('マップ制作'); print(txt[max(0,i-60):i+120].replace('\n',' / '))
        await page.screenshot(path=SHOTS + 'guide.png')
        sys.exit(summary(logs))
asyncio.run(main())
