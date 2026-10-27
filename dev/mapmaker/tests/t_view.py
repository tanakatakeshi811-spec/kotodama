import asyncio, sys, json
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import SHOTS
from playwright.async_api import async_playwright

SH = SHOTS

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.wait_for_timeout(600)
        r = await page.evaluate("""async () => {
          const M = window.__kd.MapMaker;
          M.open();
          await new Promise(r => setTimeout(r, 300));
          M.openMap('sample-mall');
          await new Promise(r => setTimeout(r, 1500));
          const s = M._t.M;
          return { screen: s.screen, mode: s.mode, floor: s.floor, hasV: !!s.V, map: s.map && s.map.name };
        }""")
        print('openMap ->', r)
        await page.screenshot(path=SH + 'v_mall_2d.png')
        await page.click('[data-m="d3"]')
        await page.wait_for_timeout(1600)
        await page.screenshot(path=SH + 'v_mall_3d.png')
        for l in logs: print(l)
        await b.close()

asyncio.run(main())
