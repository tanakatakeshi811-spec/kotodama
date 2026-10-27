import sys, json
FAILS = []
def check(name, cond, detail=''):
    ok = bool(cond)
    print(('PASS ' if ok else 'FAIL ') + name + ((' :: ' + str(detail)) if (detail != '' and not ok) else ''))
    if not ok: FAILS.append(name)
    return ok
def summary(logs=None, ignore=('ERR_TUNNEL_CONNECTION_FAILED', 'ERR_CONNECTION_REFUSED', 'ERR_NAME_NOT_RESOLVED', 'ERR_INTERNET_DISCONNECTED', 'ERR_CONNECTION_RESET', 'ERR_CERT', 'Failed to load resource')):
    bad = [l for l in (logs or []) if not any(i in l[1] for i in ignore)]
    for l in bad: print('LOG', l)
    check('no console/page errors', not bad, bad[:3])
    print('\n==== %s ====' % ('ALL PASS' if not FAILS else 'FAILED: ' + ', '.join(FAILS)))
    return 0 if not FAILS else 1
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
MOCKS = open(_os.path.join(_HERE, 'mocks.js'), encoding='utf-8').read()
SHOTS = _os.path.join(_HERE, 'shots') + '/'
_os.makedirs(SHOTS, exist_ok=True)

async def make_map(page, q='ららぽーと'):
    """UI flow with mocks: create the test mall map, return when the viewer is open."""
    await page.evaluate("window.__kd.MapMaker.open()")
    await page.wait_for_timeout(300)
    await page.click('[data-m="new"]')
    await page.wait_for_selector('.mm-dlg input[name=q]', timeout=5000)
    await page.fill('.mm-dlg input[name=q]', q)
    await page.press('.mm-dlg input[name=q]', 'Enter')
    await page.wait_for_selector('.mm-cand', timeout=5000)
    await page.click('[data-a="make"]')
    await page.wait_for_function("window.__kd.MapMaker._t.M.screen === 'view' && window.__kd.MapMaker._t.M.map && !window.__kd.MapMaker._t.M.map.sample", timeout=40000)
    await page.wait_for_timeout(900)
    return await page.evaluate("window.__kd.MapMaker._t.M.map.id")

async def mm(page, expr):
    return await page.evaluate("(() => { const MM = window.__kd.MapMaker, M = MM._t.M, V = M.V; return %s; })()" % expr)
