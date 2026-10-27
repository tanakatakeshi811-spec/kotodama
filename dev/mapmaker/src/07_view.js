
/* ---------- 地図ビュー：カメラの動き・指やマウスの操作・当たり判定 ---------- */
function createView(canvas, hooks) {
  hooks = hooks || {};
  const g = canvas.getContext('2d');
  const D3_H = -0.55;   /* 3Dにしたときの標準の向き（すこし斜め）*/
  const V = {
    map: null, R: null, W: 300, H: 300, dpr: 1, cam: { cx: 0, cy: 0, s: 1, h: 0, el3: 0.92, t3: 0 }, goal: { cx: 0, cy: 0, s: 1, h: 0, el3: 0.92, t3: 0 },
    floor: '', sel: null, hits: null, filter: 'all', gps: null, gpsInside: false, route: null, dark: false, accent: '#1C7A62', pad: { l: 0, r: 0, t: 0, b: 0 },
    moved: false, raf: 0, last: 0, fitS: 1, out: { hits: [], proj: null }, labels: true, hud: true,
  };
  const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const elNow = () => lerp(Math.PI / 2, V.cam.el3, ease(clamp(V.cam.t3, 0, 1)));
  const state = () => ({ map: V.map, R: V.R, W: V.W, H: V.H, dpr: V.dpr, cam: V.cam, floor: V.floor, sel: V.sel, hits: V.hits, filter: V.filter, gps: V.gps, gpsInside: V.gpsInside, route: V.route, dark: V.dark, accent: V.accent, out: V.out, labels: V.labels, hud: V.hud, ox: (V.pad.l - V.pad.r) / 2, oy: (V.pad.t - V.pad.b) / 2 });
  V.draw = () => { if (!V.map || !V.R) { g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); g.fillStyle = (V.dark ? PAL.dark : PAL.light).bg; g.fillRect(0, 0, V.W, V.H); return; } drawScene(g, state()); };
  V.request = () => { if (V.raf) return; V.raf = requestAnimationFrame(tick); };
  function tick(t) {
    V.raf = 0; const dt = Math.min(0.08, V.last ? (t - V.last) / 1000 : 0.016); V.last = t;
    const c = V.cam, q = V.goal, k = 1 - Math.exp(-dt * 11);
    let busy = false;
    const step = (key, wrap) => { let d = q[key] - c[key]; if (wrap) d = wrapA(d); if (Math.abs(d) < (key === 's' ? 1e-4 : key === 'cx' || key === 'cy' ? 0.01 : 1e-3)) { c[key] = q[key]; return; } c[key] += d * k; busy = true; };
    step('cx'); step('cy'); step('h', true); step('el3'); step('t3');
    { const d = Math.log(q.s / c.s); if (Math.abs(d) < 1e-3) c.s = q.s; else { c.s *= Math.exp(d * k); busy = true; } }
    V.draw(); hooks.onChange && hooks.onChange(V);
    if (busy) { V.last = t; V.request(); } else V.last = 0;
  }
  V.render = () => { V.request(); };
  V.resize = (w, h, dpr) => { V.W = Math.max(40, w); V.H = Math.max(40, h); V.dpr = dpr || 1; canvas.width = Math.round(V.W * V.dpr); canvas.height = Math.round(V.H * V.dpr); V.render(); };
  V.setMap = (map, keep) => {
    V.map = map; V.R = map ? prepare(map) : null; V.sel = null; V.hits = null; V.filter = 'all'; V.route = null;
    if (map) { const gf = V.R.floors[V.R.ground]; if (!keep || !V.R.fidx.has(V.floor)) V.floor = gf ? gf.id : ''; if (!keep) { V.goal.el3 = V.cam.el3 = V.R.stack ? STACK_EL : 0.92; V.fit(false); } }
    V.render();
  };
  V.refresh = () => { if (V.map) { V.R = prepare(V.map); if (!V.R.fidx.has(V.floor)) { const gf = V.R.floors[V.R.ground]; V.floor = gf ? gf.id : ''; } } V.render(); };
  V.is3d = () => V.goal.t3 > 0.5;
  V.fit = (animate) => {
    if (!V.map) return;
    const f = fitCam(V.map, V.W - V.pad.l - V.pad.r, V.H - V.pad.t - V.pad.b, V.goal.h, V.goal.el3, V.goal.t3 > 0.5);
    V.fitS = f.s; Object.assign(V.goal, { cx: f.cx, cy: f.cy, s: f.s }); V.moved = false;
    if (!animate) Object.assign(V.cam, { cx: f.cx, cy: f.cy, s: f.s, h: V.goal.h, el3: V.goal.el3, t3: V.goal.t3 });
    V.render();
  };
  V.setMode = (is3d, animate = true) => {
    const was = V.goal.t3 > 0.5; if (was === is3d && animate) return;
    V.goal.t3 = is3d ? 1 : 0;
    if (is3d && Math.abs(wrapA(V.goal.h)) < 0.06) V.goal.h = D3_H; else if (!is3d && Math.abs(wrapA(V.goal.h - D3_H)) < 0.06) V.goal.h = 0;
    if (!V.moved) V.fit(animate); else { /* 動かしていたら、いまの中心はそのまま */ }
    if (!animate) { V.cam.t3 = V.goal.t3; V.cam.h = V.goal.h; V.render(); }
    V.render(); hooks.onMode && hooks.onMode(is3d);
  };
  V.setFloor = id => { if (V.floor === id) return; V.floor = id; V.render(); hooks.onFloor && hooks.onFloor(id); };
  V.select = id => { V.sel = id || null; V.render(); };
  V.setHits = set => { V.hits = set && set.size ? set : null; V.render(); };
  V.setFilter = f => { V.filter = f || 'all'; V.render(); };
  V.setGps = (p, inside) => { V.gps = p; V.gpsInside = !!inside; V.render(); };
  V.zoomBy = (f, anchor) => {
    const s0 = V.goal.s, s1 = clamp(s0 * f, V.fitS * 0.35, 48);
    if (anchor) { const w0 = V.screenToWorld(anchor[0], anchor[1], true); V.goal.s = s1; const w1 = V.screenToWorld(anchor[0], anchor[1], true, s1); V.goal.cx += w0[0] - w1[0]; V.goal.cy += w0[1] - w1[1]; }
    else V.goal.s = s1;
    V.moved = true; V.render();
  };
  V.rotateBy = d => { V.goal.h = wrapA(V.goal.h + d); V.moved = true; V.render(); };
  V.tiltBy = d => { V.goal.el3 = clamp(V.goal.el3 + d, 0.5, 1.25); V.moved = true; V.render(); };
  V.resetNorth = () => { V.goal.h = V.goal.t3 > 0.5 ? D3_H : 0; V.render(); };
  V.heading = () => V.cam.h;
  /* 画面の点 → 地面の点（z=0）*/
  V.screenToWorld = (px, py, useGoal, sOverride) => {
    const c = useGoal ? V.goal : V.cam, el = useGoal ? lerp(Math.PI / 2, c.el3, ease(clamp(c.t3, 0, 1))) : elNow(), se = Math.sin(el), ca = Math.cos(c.h), sa = Math.sin(c.h), S = sOverride || c.s;
    const ox = V.W / 2 + (V.pad.l - V.pad.r) / 2, oy = V.H / 2 + (V.pad.t - V.pad.b) / 2;
    const u = (px - ox) / S, v = (oy - py) / (S * se);
    return [c.cx + u * ca + v * sa, c.cy - u * sa + v * ca];
  };
  V.worldToScreen = (x, y, z = 0) => {
    const c = V.cam, el = elNow(), se = Math.sin(el), ce = Math.cos(el), ca = Math.cos(c.h), sa = Math.sin(c.h), ox = V.W / 2 + (V.pad.l - V.pad.r) / 2, oy = V.H / 2 + (V.pad.t - V.pad.b) / 2;
    return [ox + c.s * ((x - c.cx) * ca - (y - c.cy) * sa), oy - c.s * (((x - c.cx) * sa + (y - c.cy) * ca) * se + z * ce)];
  };
  V.pick = (px, py) => { for (const h of V.out.hits || []) { if (px < 0) break; if (inPoly(px, py, h.hull)) return h.id; } return null; };
  V.focusPoi = (id, o = {}) => {
    const q = V.R && V.R.byId.get(id); if (!q) return;
    if (q.p.f) V.setFloor(q.p.f);
    const size = Math.max(q.p.w || 8, q.p.l || 8);
    const s = o.s || clamp(Math.max(V.goal.s, 70 / size), V.fitS * 1.2, 12);
    V.goal.cx = q.cx; V.goal.cy = q.cy; V.goal.s = Math.max(s, o.keepZoom ? V.goal.s : 0);
    /* o.at = 画面のこの位置（px）に出す。カードやボタンにかくれないように */
    if (o.at) { const w = V.screenToWorld(o.at[0], o.at[1], true); V.goal.cx = 2 * q.cx - w[0]; V.goal.cy = 2 * q.cy - w[1]; }
    V.moved = true; V.render();
  };
  V.focusPoint = (x, y, s) => { V.goal.cx = x; V.goal.cy = y; if (s) V.goal.s = s; V.moved = true; V.render(); };
  /* 画像として書き出す（サムネイル・AIに見せる画面）*/
  V.snapshot = (w, h, o = {}) => {
    const cv = document.createElement('canvas'), dpr = o.dpr || 1; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const gg = cv.getContext('2d'); const is3 = o.mode3d != null ? o.mode3d : V.goal.t3 > 0.5;
    const hh = o.h != null ? o.h : (is3 ? D3_H : 0), el3 = V.goal.el3;
    let cam;
    if (o.useView) cam = Object.assign({}, V.cam); else { const f = fitCam(V.map, w, h, hh, el3, is3, o.pad || 1.1); cam = { cx: f.cx, cy: f.cy, s: f.s, h: hh, el3, t3: is3 ? 1 : 0 }; }
    const st = { map: V.map, R: V.R, W: w, H: h, dpr, cam, floor: V.floor, sel: o.sel === undefined ? null : o.sel, hits: o.hits || null, filter: 'all', gps: null, route: null, dark: o.dark != null ? o.dark : V.dark, accent: V.accent, labels: o.labels !== false, hud: o.hud === true, out: null, ox: 0, oy: 0 };
    if (o.useView) { st.W = V.W; st.H = V.H; st.ox = (V.pad.l - V.pad.r) / 2; st.oy = (V.pad.t - V.pad.b) / 2; st.sel = V.sel; st.hits = V.hits; st.filter = V.filter; st.gps = V.gps; st.route = V.route; st.hud = true; cv.width = Math.round(V.W * dpr); cv.height = Math.round(V.H * dpr); }
    drawScene(gg, st);
    return cv;
  };

  /* ---------- 操作 ---------- */
  const pts = new Map(); let pinch = null, down = null, tapT = 0, lastTap = 0, lastTapPt = null;
  const rect = () => canvas.getBoundingClientRect();
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    const r = rect(); pts.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    if (pts.size === 1) down = { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now(), moved: false, btn: e.button, shift: e.shiftKey || e.ctrlKey || e.button === 2, cx: V.goal.cx, cy: V.goal.cy, h: V.goal.h, el: V.goal.el3 };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), s: V.goal.s, h: V.goal.h, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; if (down) down.moved = true; }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const r = rect(), p = { x: e.clientX - r.left, y: e.clientY - r.top }, prev = pts.get(e.pointerId); pts.set(e.pointerId, p);
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const s1 = clamp(pinch.s * d / Math.max(10, pinch.d), V.fitS * 0.35, 48);
      /* 指の中点の下にある場所を動かさない */
      const w0 = V.screenToWorld(pinch.mx, pinch.my, true, pinch.s); V.goal.s = s1; V.goal.h = wrapA(pinch.h - (ang - pinch.a));
      const w1 = V.screenToWorld(mx, my, true, s1); V.goal.cx += w0[0] - w1[0]; V.goal.cy += w0[1] - w1[1];
      Object.assign(V.cam, { cx: V.goal.cx, cy: V.goal.cy, s: V.goal.s, h: V.goal.h }); V.moved = true; V.render(); return;
    }
    if (!down) return;
    const dx = p.x - down.x, dy = p.y - down.y;
    if (!down.moved && Math.hypot(dx, dy) > 6) down.moved = true;
    if (!down.moved) return;
    if (down.shift) { V.goal.h = wrapA(down.h - dx * 0.008); if (V.goal.t3 > 0.5) V.goal.el3 = clamp(down.el + dy * 0.006, 0.5, 1.25); Object.assign(V.cam, { h: V.goal.h, el3: V.goal.el3 }); V.moved = true; V.render(); return; }
    /* 指の下の地面を動かす */
    const el = elNow(), se = Math.sin(el), ca = Math.cos(V.cam.h), sa = Math.sin(V.cam.h), S = V.cam.s;
    const ddx = p.x - prev.x, ddy = p.y - prev.y, u = ddx / S, v = -ddy / (S * se);
    const wx = u * ca + v * sa, wy = -u * sa + v * ca;
    V.goal.cx -= wx; V.goal.cy -= wy; V.cam.cx = V.goal.cx; V.cam.cy = V.goal.cy; V.moved = true; V.render();
  });
  const up = e => {
    const had = pts.has(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
    if (!had || !down || pts.size) { if (!pts.size) down = null; return; }
    const d = down; down = null;
    if (!d.moved && e.type === 'pointerup' && performance.now() - d.t < 600 && d.btn !== 2) {
      const now = performance.now(), dbl = now - lastTap < 320 && lastTapPt && Math.hypot(d.x - lastTapPt[0], d.y - lastTapPt[1]) < 24;
      lastTap = now; lastTapPt = [d.x, d.y];
      if (dbl) { V.zoomBy(1.9, [d.x, d.y]); return; }
      const id = V.pick(d.x, d.y); const w = V.screenToWorld(d.x, d.y);
      hooks.onTap && hooks.onTap(id, w, [d.x, d.y]);
    }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); const r = rect();
    if (e.ctrlKey && false) return;
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
    const s0 = V.goal.s, s1 = clamp(s0 * f, V.fitS * 0.35, 48), ax = e.clientX - r.left, ay = e.clientY - r.top;
    const w0 = V.screenToWorld(ax, ay, true); V.goal.s = s1; const w1 = V.screenToWorld(ax, ay, true, s1);
    V.goal.cx += w0[0] - w1[0]; V.goal.cy += w0[1] - w1[1]; V.cam.s = V.goal.s; V.cam.cx = V.goal.cx; V.cam.cy = V.goal.cy; V.moved = true; V.render();
  }, { passive: false });
  return V;
}
