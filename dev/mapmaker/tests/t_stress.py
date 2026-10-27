import asyncio, sys, json, os
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from harness import launch
from util import *
from playwright.async_api import async_playwright
SH = SHOTS

async def main():
    async with async_playwright() as p:
        b, ctx, page, logs = await launch(p, 1280, 800)
        await page.evaluate("(%s)(window.__kd.MapMaker)" % MOCKS.strip())
        await page.evaluate("window.__kd.MapMaker.open()"); await page.wait_for_timeout(300)
        res = await page.evaluate("""async () => {
          const MM = window.__kd.MapMaker, T = MM._t, M = T.M;
          const m = JSON.parse(JSON.stringify(T.Samples.get('sample-mall')));
          m.id = 'stress1'; m.sample = 0; m.name = 'ストレステスト'; m.ll = { lat: 35.68, lon: 139.99 };
          const base = m.pois.slice(); let k = 0;
          for (let r = 1; r < 8; r++) for (const p of base) { k++; const q = JSON.parse(JSON.stringify(p)); q.id = p.id + '_' + r; q.n = p.n + r; q.x += (Math.random() - .5) * 30; q.y += (Math.random() - .5) * 12; m.pois.push(q); }
          // many buildings & roads
          const ctx = m.ctx; const B = ctx.b.slice(); for (let i = 0; i < 1400; i++) { const b0 = B[i % B.length]; const dx = (Math.random() - .5) * 2400, dy = (Math.random() - .5) * 2000; ctx.b.push({ p: b0.p.map(q => [q[0] + dx, q[1] + dy]), h: b0.h }); }
          const R = ctx.r.slice(); for (let i = 0; i < 2000; i++) { const r0 = R[i % R.length]; const dx = (Math.random() - .5) * 2400, dy = (Math.random() - .5) * 2000; ctx.r.push({ p: r0.p.map(q => [q[0] + dx, q[1] + dy]), w: r0.w, t: r0.t }); }
          const out = { npois: m.pois.length, nb: ctx.b.length, nr: ctx.r.length, bytes: JSON.stringify(m).length };
          await T.Store.put(m);
          await MM.openMap('stress1');
          await new Promise(r => setTimeout(r, 800));
          const V = M.V;
          const time = (f, n = 10) => { const t0 = performance.now(); for (let i = 0; i < n; i++) f(); return +((performance.now() - t0) / n).toFixed(1); };
          out.snap2d = time(() => V.snapshot(V.W, V.H, { useView: true, dpr: 1 }));
          V.setMode(true, false); await new Promise(r => setTimeout(r, 200));
          out.snap3d = time(() => V.snapshot(V.W, V.H, { useView: true, dpr: 1 }));
          V.setFloor(V.R.floors[1].id);
          out.snap3dF = time(() => V.snapshot(V.W, V.H, { useView: true, dpr: 1 }));
          out.search = time(() => T.searchPois(m, 'ユニクロ'), 20);
          out.searchAll = time(() => T.searchPois(m, 'トイレ'), 20);
          out.paintSpots = time(() => { M.listN = 90; T.layout(); document.querySelector('.mm-pane[data-p=spots]'); }, 5);
          const t0 = performance.now(); const th = await T.makeThumb(m); out.thumbMs = +(performance.now() - t0).toFixed(0); out.thumbKB = Math.round(th.length / 1024);
          return out;
        }""")
        print(json.dumps(res, ensure_ascii=False))
        check('3D frame time < 120ms with 400 spots / 1400 bldgs', res['snap3d'] < 120 and res['snap3dF'] < 120, res)
        check('2D frame time < 80ms', res['snap2d'] < 80, res)
        check('search fast (<15ms)', res['search'] < 15 and res['searchAll'] < 15, res)
        await page.screenshot(path=SH + 'x_stress3d.png')
        # real animation FPS in 3D with rotation
        fps = await page.evaluate("""async () => {
          const T = window.__kd.MapMaker._t, V = T.M.V; let n = 0; const t0 = performance.now();
          await new Promise(res => { const step = () => { V.rotateBy(0.02); n++; if (performance.now() - t0 > 1500) res(); else requestAnimationFrame(step); }; step(); });
          return +(n / ((performance.now() - t0) / 1000)).toFixed(1);
        }""")
        print('3D rotate FPS (software GL headless):', fps)
        check('animates > 8 fps even in headless software mode', fps > 8, fps)
        # ---- cloud-style chunked storage ----
        r = await page.evaluate("""async () => {
          const KV = window.__kd.KV, T = window.__kd.MapMaker._t, S = T.Store;
          const store = new Map(), orig = KV.be, maxDoc = { n: 0 };
          const fake = { get: async k => store.has(k) ? JSON.parse(store.get(k)) : null, set: async (k, v) => { const s = JSON.stringify(v); maxDoc.n = Math.max(maxDoc.n, new TextEncoder().encode(s).length); store.set(k, s); }, del: async k => { store.delete(k); }, watch: () => () => {} };
          KV.be = fake;
          const m = await S.get('stress1');
          S.cache.delete('stress1');
          // fresh copy with new id to force chunking path
          const c = JSON.parse(JSON.stringify(m)); c.id = 'stress2';
          await S.put(c);
          await new Promise(r => setTimeout(r, 600));
          const keys = [...store.keys()].filter(k => k.startsWith('kd_mm_stress2'));
          S.cache.delete('stress2');
          const back = await S.get('stress2');
          const same = JSON.stringify(back) === JSON.stringify(c);
          const e = (await S.list()).find(x => x.id === 'stress2');
          KV.be = orig;
          return { keys: keys.length, maxDoc: maxDoc.n, same, parts: e && e.parts, size: JSON.stringify(c).length };
        }""")
        print(r)
        check('cloud chunking: multiple parts', r['parts'] and r['parts'] >= 2, r)
        check('cloud chunking: each doc < 250KB', r['maxDoc'] < 250 * 1024, r)
        check('cloud chunking: round-trip identical', r['same'], r)
        sys.exit(summary(logs))

asyncio.run(main())
