import asyncio, sys, json
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import SHOTS
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.wait_for_timeout(800)
        r = await page.evaluate("""async () => {
          const M = window.__kd.MapMaker;
          M.open();
          await new Promise(r => setTimeout(r, 700));
          return { on: M.on, screen: M.screen, html: document.querySelector('section.mm') ? document.querySelector('section.mm').className : null };
        }""")
        print('open ->', r)
        await page.screenshot(path=SHOTS + 'lib_empty.png')
        for l in logs: print(l)
        await b.close()

asyncio.run(main())
