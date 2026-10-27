import asyncio, sys, json, os
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from playwright.async_api import async_playwright
SH = SHOTS

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800, scheme='dark')
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        th = await page.evaluate("[document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]")
        print('theme', th)
        await page.evaluate("window.__kd.MapMaker.open()"); await page.wait_for_timeout(700)
        await page.screenshot(path=SH + 'd_lib.png')
        await page.evaluate("window.__kd.MapMaker.openMap('sample-park')"); await page.wait_for_timeout(1500)
        await page.screenshot(path=SH + 'd_park2d.png')
        await page.click('[data-m=d3]'); await page.wait_for_timeout(1500)
        await mm(page, "MM._t.select(M.map.pois.find(p => p.c === 'ride').id, {focus:true})"); await page.wait_for_timeout(900)
        await page.screenshot(path=SH + 'd_park3d.png')
        await page.click('[data-m=tab][data-t=info]'); await page.wait_for_timeout(300)
        await page.screenshot(path=SH + 'd_info.png')
        await page.click('[data-m=tab][data-t=ai]'); await page.wait_for_timeout(300)
        await page.screenshot(path=SH + 'd_ai.png')
        sys.exit(summary(logs))
asyncio.run(main())
