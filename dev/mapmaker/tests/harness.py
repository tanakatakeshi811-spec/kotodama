import asyncio, sys, json, os
from playwright.async_api import async_playwright

import os
URL = 'file://' + os.path.abspath(os.environ.get('KD_HTML') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'index.html'))
INIT = """
window.__KD_TEST = true;
try { Object.defineProperty(Notification, 'permission', { get: () => 'denied' }); } catch (e) {}
"""

async def launch(p, w=1200, h=800, dpr=1, mobile=False, scheme='light'):
    b = await p.chromium.launch(args=['--no-sandbox'])
    ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr, is_mobile=mobile, has_touch=mobile, color_scheme=scheme, locale='ja-JP')
    await ctx.add_init_script(INIT)
    page = await ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append(('console.' + m.type, m.text)) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: logs.append(('pageerror', str(e))))
    await page.goto(URL)
    await page.wait_for_function('window.__kd && window.__kd.MapMaker', timeout=20000)
    return b, ctx, page, logs
