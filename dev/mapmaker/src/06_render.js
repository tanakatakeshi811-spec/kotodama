
/* ---------- 描画：2D（見取り図）と3D（立体）----------
   Canvas2Dだけで描く「斜め上からの立体」。外部ライブラリなしで、オフラインでも動く。
   2D↔3Dは、カメラの傾きをなめらかに変えて切りかえる。3Dでは階を縦に重ねて見せる。 */
const FG = 22;                 /* 階と階のあいだ(m) */
const SLAB = 1.5;              /* 床の厚み(m) */
const PAL = {
  light: { bg: '#E6E3D8', site: '#F3F0E6', siteLine: '#BDB69F', green: '#C9DDB6', greenLine: '#B4CCA0', water: '#A9CBE3', waterLine: '#8DB6D3', park: '#D6D3CB', road: '#FFFFFF', roadEdge: '#C9C3B3', roadMain: '#FFF3CE', roadMainEdge: '#D2BC7A', path: '#F7F2E7', pathEdge: '#D4CCB8', rail: '#8B8E96', bld: '#D9D5C9', bldEdge: '#B9B3A3', plate: '#FBF9F2', plateEdge: '#AFA894', cor: '#ECE6D3', ink: '#1C2420', ink2: '#56605A', pill: 'rgba(255,255,255,.95)', pillLine: 'rgba(0,0,0,.16)', shadow: 'rgba(48,44,30,.17)', zone: 0.2, ghost: '#C5BFAE' },
  dark: { bg: '#14181B', site: '#1D2226', siteLine: '#3B454C', green: '#20342A', greenLine: '#2B4636', water: '#1B374E', waterLine: '#26506F', park: '#262B2F', road: '#2F373D', roadEdge: '#22292E', roadMain: '#3B3F36', roadMainEdge: '#55502F', path: '#2B3135', pathEdge: '#21272B', rail: '#6A6F78', bld: '#2A3035', bldEdge: '#3D474E', plate: '#2A3036', plateEdge: '#4B565E', cor: '#333B42', ink: '#E6ECE8', ink2: '#A9B5AE', pill: 'rgba(32,38,43,.95)', pillLine: 'rgba(255,255,255,.18)', shadow: 'rgba(0,0,0,.38)', zone: 0.24, ghost: '#47525A' },
};
const FONT = '"Hiragino Sans","Noto Sans JP","Yu Gothic UI","Meiryo",system-ui,sans-serif';
/* カテゴリのマークを画像にして使い回す */
const IconImg = {
  cache: new Map(), onload: null,
  get(name, color, size = 48) {
    const key = name + '|' + color; let e = this.cache.get(key);
    if (e) return e.ok ? e.img : null;
    e = { ok: false, img: new Image() }; this.cache.set(key, e);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.locate}</svg>`;
    e.img.onload = () => { e.ok = true; if (IconImg.onload) IconImg.onload(); };
    e.img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return null;
  },
};
const TW = new Map();
function textW(g, font, t) { const k = font + '|' + t; let w = TW.get(k); if (w == null) { g.font = font; w = g.measureText(t).width; if (TW.size > 4000) TW.clear(); TW.set(k, w); } return w; }
function clipText(g, font, t, max) { let w = textW(g, font, t); if (w <= max) return [t, w]; let s = t; while (s.length > 1 && textW(g, font, s + '…') > max) s = s.slice(0, -1); return [s + '…', textW(g, font, s + '…')]; }
const gOf = id => catOf(id).g;
/* ラベルに出す短い名前：「…」の中や（…）を省く */
function shortName(n) {
  n = String(n || ''); let m = n.match(/[「『](.{2,})[」』]/); if (m) return m[1];
  const t = n.replace(/[（(][^）)]*[）)]/g, '').trim(); return t.length >= 2 ? t : n;
}

/* 地図ごとの描画用データ（保存はしない）*/
function prepare(map) {
  const R = { pois: [], byId: new Map(), floors: [], fidx: new Map(), ground: 0, ctxb: [], roads: [], bl: [], zl: [], fg: FG, stack: false };
  R.groups = new Map(); R.focus = focusBox(map);
  R.floors = (map.floors || []).slice().sort((a, b) => a.lv - b.lv);
  R.floors.forEach((f, i) => R.fidx.set(f.id, i));
  const gi = R.floors.findIndex(f => f.lv >= 0); R.ground = gi < 0 ? 0 : gi;
  { const sp = stackParams(map); R.fg = sp.fg; R.stack = sp.stack; }
  for (const p of map.pois || []) {
    const ring = p.ring && p.ring.length >= 3 ? ccw(p.ring) : ccw(rectPoly(p.x, p.y, p.w || 10, p.l || 8, p.r || 0));
    const rgb = hexRgb(catOf(p.c).c), q = { p, ring, cx: p.x, cy: p.y, rad: Math.hypot(p.w || 10, p.l || 8) / 2, rgb, h: p.ht || catOf(p.c).h, fi: p.f && R.fidx.has(p.f) ? R.fidx.get(p.f) : -999, g: gOf(p.c), b: p.b || '' };
    R.pois.push(q); R.byId.set(p.id, q);
    if (p.b && p.f) { const k = p.b + '|' + p.f; let a = R.groups.get(k); if (!a) R.groups.set(k, a = []); a.push(q); }
  }
  for (const b of (map.ctx && map.ctx.b) || []) { const bb = bboxOf(b.p); R.ctxb.push({ p: b.p, h: b.h || 8, bb, cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2 }); }
  for (const r of (map.ctx && map.ctx.r) || []) R.roads.push({ r, bb: bboxOf(r.p) });
  R.bl = (map.bldgs || []).map(b => { const bb = bboxOf(b.ring), c = polyCentroid(b.ring); return { b, bb, cx: c[0], cy: c[1], ring: b.ring }; });
  R.zl = (map.zones || []).map(z => { let c = null; if (z.ring) c = polyCentroid(z.ring); else { const m = (map.pois || []).filter(p => p.z === z.id); if (m.length) c = [m.reduce((a, p) => a + p.x, 0) / m.length, m.reduce((a, p) => a + p.y, 0) / m.length]; } return { z, c }; }).filter(x => x.c);
  return R;
}
/* 階を重ねるときの間隔：となりの階と重ならないよう、建物の奥行きから決める */
const STACK_EL = 0.66;
function stackParams(map) {
  const fl = (map.floors || []).slice().sort((a, b) => a.lv - b.lv), n = fl.length;
  const gi = Math.max(0, fl.findIndex(f => f.lv >= 0));
  if (n < 2 || !(map.bldgs || []).length) return { fg: FG, zmin: 0, zmax: 20, n, ground: gi, stack: false };
  let maxD = 36; for (const b of map.bldgs) { const ob = obbOf(b.ring); maxD = Math.max(maxD, Math.min(ob.d, 130)); }
  const fg = clamp(maxD * Math.tan(STACK_EL) * 1.06, 28, 78);
  return { fg, zmin: -gi * fg - 3, zmax: (n - 1 - gi) * fg + 12, n, ground: gi, stack: true };
}
function fitCam(map, W, H, h, el3, mode3d, pad = 1.18) {
  const e = focusBox(map), ca = Math.cos(h), sa = Math.sin(h);
  const corners = [[e[0], e[1]], [e[2], e[1]], [e[2], e[3]], [e[0], e[3]]];
  const sp = stackParams(map), zTop = mode3d ? sp.zmax : 0, zBot = mode3d ? Math.min(0, sp.zmin) : 0, el = mode3d ? el3 : Math.PI / 2, se = Math.sin(el), ce = Math.cos(el);
  let u0 = 1e18, u1 = -1e18, v0 = 1e18, v1 = -1e18;
  for (const [x, y] of corners) { const u = x * ca - y * sa, v = (x * sa + y * ca) * se; for (const z of [zBot, zTop]) { const vv = v + z * ce; if (u < u0) u0 = u; if (u > u1) u1 = u; if (vv < v0) v0 = vv; if (vv > v1) v1 = vv; } }
  const ww = Math.max(20, u1 - u0) * pad, hh = Math.max(20, v1 - v0) * pad;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  /* 中心を逆変換（地面の点として）*/
  const cvg = (cv - ((zTop + zBot) * ce) / 2) / se;
  const cx = cu * ca + cvg * sa, cy = -cu * sa + cvg * ca;
  return { cx, cy, s: Math.min(W / ww, H / hh) };
}

/* ひとつの場面を描く。st = {map,R,W,H,cam,floor,sel,hits,filter,gps,dark,hud,labels,out} */
function drawScene(g, st) {
  const { map, R, W, H, cam } = st;
  const P = st.dark ? PAL.dark : PAL.light;
  const e = ease(clamp(cam.t3, 0, 1)), el = lerp(Math.PI / 2, cam.el3, e), se = Math.sin(el), ce = Math.cos(el);
  const ca = Math.cos(cam.h), sa = Math.sin(cam.h), S = cam.s, ox = W / 2 + (st.ox || 0), oy = H / 2 + (st.oy || 0);
  const X = (x, y) => ox + S * ((x - cam.cx) * ca - (y - cam.cy) * sa);
  const Y = (x, y, z) => oy - S * (((x - cam.cx) * sa + (y - cam.cy) * ca) * se + z * ce);
  const DEP = (x, y, z) => ((x - cam.cx) * sa + (y - cam.cy) * ca) * ce - z * se;
  const curFi = st.floor && R.fidx.has(st.floor) ? R.fidx.get(st.floor) : R.ground;
  const zOfFi = fi => (fi === -999 ? 0 : (fi - R.ground) * R.fg * e);
  const margin = 80;
  const onScr = (bb, z) => { /* バウンディングボックスが画面に入るか（ざっくり）*/
    const xs = [X(bb[0], bb[1]), X(bb[2], bb[1]), X(bb[2], bb[3]), X(bb[0], bb[3])], ys = [Y(bb[0], bb[1], 0), Y(bb[2], bb[1], 0), Y(bb[2], bb[3], 0), Y(bb[0], bb[3], 0)];
    const y0 = Math.min(...ys) - (z || 0) * ce * S, y1 = Math.max(...ys);
    return Math.max(...xs) > -margin && Math.min(...xs) < W + margin && y1 > -margin && y0 < H + margin;
  };
  const ringPath = (ring, z) => { for (let i = 0; i < ring.length; i++) { const x = X(ring[i][0], ring[i][1]), y = Y(ring[i][0], ring[i][1], z); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); };
  g.setTransform(st.dpr || 1, 0, 0, st.dpr || 1, 0, 0);
  g.globalAlpha = 1; g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const ctx = map.ctx || {};

  /* 敷地 */
  if (map.site && map.site.length > 2) { g.beginPath(); ringPath(map.site, 0); g.fillStyle = P.site; g.fill(); g.setLineDash([8, 5]); g.strokeStyle = P.siteLine; g.lineWidth = 1.2; g.stroke(); g.setLineDash([]); }
  /* 緑・水・駐車場 */
  const fillAll = (arr, fill, line, minPx) => { g.fillStyle = fill; g.strokeStyle = line; g.lineWidth = 0.8; for (const ring of arr || []) { const bb = bboxOf(ring); if (!onScr(bb, 0)) continue; if ((bb[2] - bb[0]) * S < (minPx || 0) && (bb[3] - bb[1]) * S < (minPx || 0)) continue; g.beginPath(); ringPath(ring, 0); g.fill(); g.stroke(); } };
  fillAll(ctx.g, P.green, P.greenLine, 2); fillAll(ctx.k, P.park, P.pathEdge, 3); fillAll(ctx.w, P.water, P.waterLine, 2);
  if (ctx.wl && ctx.wl.length) { g.strokeStyle = P.water; for (const w of ctx.wl) { g.lineWidth = Math.max(1.2, w.w * S); g.beginPath(); w.p.forEach((q, i) => (i ? g.lineTo(X(q[0], q[1]), Y(q[0], q[1], 0)) : g.moveTo(X(q[0], q[1]), Y(q[0], q[1], 0)))); g.stroke(); } }
  /* エリア（色のうすい面）*/
  const zc = ['#E4572E', '#2E8FD6', '#7DB02E', '#A14CC7', '#E8883A', '#2FA37A', '#D0488C', '#5B7C99'];
  (map.zones || []).forEach((z, i) => { if (!z.ring) return; const col = hexRgb(z.c && /^#/.test(z.c) ? z.c : zc[i % zc.length]); g.beginPath(); ringPath(z.ring, 0); g.fillStyle = rgbStr(col, P.zone); g.fill(); g.strokeStyle = rgbStr(col, 0.45); g.lineWidth = 1; g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]); });
  /* 道 */
  if (S > 0.25) {
    g.globalAlpha = 1;
    /* 道の幅は種類ごとに集計 */
    const drawRoads = (cls, color, edge, mul) => {
      const groups = new Map();
      for (const q of R.roads) { const r = q.r; if (r.t !== cls) continue; if (!onScr(q.bb, 0)) continue; const k = (r.tn ? 'T' : '') + Math.round(r.w); let a = groups.get(k); if (!a) groups.set(k, a = []); a.push(r); }
      for (const pass of [0, 1]) for (const [k, arr] of groups) {
        const w = arr[0].w, tn = !!arr[0].tn;
        g.strokeStyle = pass ? color : edge; g.globalAlpha = tn ? 0.45 : 1; g.lineWidth = Math.max(pass ? 0.9 : 1.6, w * S * mul + (pass ? 0 : 2));
        if (tn) g.setLineDash([6, 5]);
        g.beginPath(); for (const r of arr) r.p.forEach((pt, i) => (i ? g.lineTo(X(pt[0], pt[1]), Y(pt[0], pt[1], 0)) : g.moveTo(X(pt[0], pt[1]), Y(pt[0], pt[1], 0)))); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
      }
    };
    drawRoads('p', P.path, P.pathEdge, 1); drawRoads('n', P.road, P.roadEdge, 1); drawRoads('m', P.roadMain, P.roadMainEdge, 1);
    /* 線路 */
    g.strokeStyle = P.rail; g.lineWidth = Math.max(1.4, 2.4 * S); g.beginPath(); let any = false;
    for (const q of R.roads) { if (q.r.t !== 'r' || !onScr(q.bb, 0)) continue; any = true; q.r.p.forEach((pt, i) => (i ? g.lineTo(X(pt[0], pt[1]), Y(pt[0], pt[1], 0)) : g.moveTo(X(pt[0], pt[1]), Y(pt[0], pt[1], 0)))); }
    if (any) { g.stroke(); g.strokeStyle = P.bg; g.lineWidth = Math.max(0.8, 1.2 * S); g.setLineDash([7, 7]); g.stroke(); g.setLineDash([]); }
  }

  /* 影（地面の上に立つものだけ）*/
  const lightU = 0.55, lightV = 0.4;
  const shadowOff = h => { const du = lightU * h * e, dv = lightV * h * e; return [du * ca + dv * sa, -du * sa + dv * ca]; };
  const drawShadow = (ring, h, alpha) => {
    if (e < 0.05 || h * e * ce * S < 2.2) return;
    const [dx, dy] = shadowOff(h); const pts = []; for (const q of ring) { pts.push(q, [q[0] + dx, q[1] + dy]); }
    const hull = hullOf(pts); g.beginPath(); ringPath(hull, 0); g.globalAlpha = alpha; g.fillStyle = P.shadow; g.fill(); g.globalAlpha = 1;
  };

  /* 立体を描く道具：ring を z0〜z1 まで押し出す */
  const prism = (ring, z0, z1, top, rgb, edge, alpha, sideMul) => {
    const n = ring.length, hpx = (z1 - z0) * ce * S;
    g.globalAlpha = alpha;
    if (hpx > 0.8 && e > 0.02) {
      const faces = [];
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 0.01) continue;
        const nx = dy / L, ny = -dx / L, nv = nx * sa + ny * ca; if (nv >= -0.015) continue;
        const nu = nx * ca - ny * sa, dot = nu * -0.77 + nv * -0.63, br = (0.56 + 0.44 * clamp((dot + 1) / 2, 0, 1)) * (sideMul || 1);
        faces.push({ a, b, br, k: ((a[0] + b[0]) / 2 - cam.cx) * sa + ((a[1] + b[1]) / 2 - cam.cy) * ca });
      }
      faces.sort((p, q) => q.k - p.k);
      for (const f of faces) {
        g.beginPath(); g.moveTo(X(f.a[0], f.a[1]), Y(f.a[0], f.a[1], z0)); g.lineTo(X(f.b[0], f.b[1]), Y(f.b[0], f.b[1], z0)); g.lineTo(X(f.b[0], f.b[1]), Y(f.b[0], f.b[1], z1)); g.lineTo(X(f.a[0], f.a[1]), Y(f.a[0], f.a[1], z1)); g.closePath();
        g.fillStyle = rgbStr(shade(rgb, f.br)); g.fill(); g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = 0.5; g.stroke();
      }
    }
    g.beginPath(); ringPath(ring, z1); g.fillStyle = top; g.fill();
    if (edge) { g.strokeStyle = edge; g.lineWidth = 0.8; g.stroke(); }
    g.globalAlpha = 1;
  };

  /* ガラスの壁：奥の面は店の後ろに、手前の面は店の前に重ねて描く */
  const walls = (ring, z0, h, front, alpha) => {
    if (h * ce * S < 1.2) return;
    const n = ring.length, fc = [];
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 0.01) continue;
      const nx = dy / L, ny = -dx / L, nv = nx * sa + ny * ca, isFront = nv < 0; if (isFront !== front) continue;
      const nu = nx * ca - ny * sa, dot = nu * -0.77 + nv * -0.63;
      fc.push({ a, b, br: 0.62 + 0.38 * clamp((dot + 1) / 2, 0, 1), k: ((a[0] + b[0]) / 2 - cam.cx) * sa + ((a[1] + b[1]) / 2 - cam.cy) * ca });
    }
    fc.sort((p1, p2) => p2.k - p1.k); g.globalAlpha = alpha;
    for (const f of fc) { g.beginPath(); g.moveTo(X(f.a[0], f.a[1]), Y(f.a[0], f.a[1], z0)); g.lineTo(X(f.b[0], f.b[1]), Y(f.b[0], f.b[1], z0)); g.lineTo(X(f.b[0], f.b[1]), Y(f.b[0], f.b[1], z0 + h)); g.lineTo(X(f.a[0], f.a[1]), Y(f.a[0], f.a[1], z0 + h)); g.closePath(); g.fillStyle = rgbStr(shade(hexRgb(st.dark ? '#7C8A96' : '#B9C6D2'), f.br)); g.fill(); g.strokeStyle = st.dark ? 'rgba(255,255,255,.3)' : 'rgba(80,90,100,.35)'; g.lineWidth = 0.7; g.stroke(); }
    g.globalAlpha = 1;
  };
  /* 並べ替えて描く物のリスト */
  const items = [];
  /* まわりの建物 */
  const ctxAlpha = st.dark ? 1 : 1;
  const bldRgb = hexRgb(st.dark ? '#3A424A' : '#D9D5C9');
  const bTop = st.dark ? '#46505A' : '#E7E3D8';
  for (const b of R.ctxb) {
    if (b.bb[2] - b.bb[0] < 0.5) continue;
    if (!onScr(b.bb, b.h * e)) continue;
    const pxs = Math.max(b.bb[2] - b.bb[0], b.bb[3] - b.bb[1]) * S; if (pxs < 1.6) continue;
    items.push({ k: DEP(b.cx, b.cy, b.h * e / 2), t: 0, o: b });
  }
  /* 屋外のスポット */
  const filt = st.filter && st.filter !== 'all' ? st.filter : '';
  const hitSet = st.hits && st.hits.size ? st.hits : null;
  const outdoor = []; for (const q of R.pois) { if (q.fi === -999 || !q.b) outdoor.push(q); }
  for (const q of outdoor) { if (!onScr([q.cx - q.rad, q.cy - q.rad, q.cx + q.rad, q.cy + q.rad], q.h * e)) continue; items.push({ k: DEP(q.cx, q.cy, q.h * e / 2), t: 1, o: q }); }
  /* 建物（階を重ねたもの）*/
  for (const bl of R.bl) { const nf = bl.b.fl.length; const zt = zOfFi(R.fidx.get(bl.b.fl[nf - 1])) ; if (!onScr(bl.bb, Math.max(0, zt) + 8)) continue; items.push({ k: DEP(bl.cx, bl.cy, (Math.max(0, zt) + 2) / 2) , t: 2, o: bl }); }
  items.sort((a, b) => b.k - a.k);

  const labels = [], hitList = [], tags = [];
  const dimA = 0.2;
  const dimOf = q => { if (hitSet) return hitSet.has(q.p.id) ? 1 : dimA; if (filt) return q.g === filt ? 1 : dimA; return 1; };
  const topCol = (rgb) => rgbStr(mix(rgb, [255, 255, 255], st.dark ? 0.06 : 0.2));
  const poiBase = (q, z, a, ghost) => {
    /* スポットを描く（2Dは平らな色面・3Dは立体）*/
    const h = ghost ? 0.7 : q.h * e, rgb = q.rgb;
    if (e > 0.02 && !ghost && h * e * ce * S > 1.2) drawShadow(q.ring, q.h, 0.5 * a);
    if (e < 0.02 || ghost) {
      g.globalAlpha = a * (ghost ? 0.5 : 0.92); g.beginPath(); ringPath(q.ring, z + h); g.fillStyle = ghost ? rgbStr(rgb) : topCol(rgb); g.fill();
      if (!ghost) { g.strokeStyle = st.dark ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.85)'; g.lineWidth = 1; g.stroke(); }
      g.globalAlpha = 1;
    } else prism(q.ring, z, z + h, topCol(rgb), rgb, st.dark ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.75)', a);
    return h;
  };
  const registerPoi = (q, z, a, ghost, h, otherFloor) => {
    if (ghost) return;
    const px = Math.max((q.p.w || 8), (q.p.l || 8)) * S;
    const tx = X(q.cx, q.cy), ty = Y(q.cx, q.cy, z + h);
    const sel = st.sel === q.p.id, isHit = hitSet && hitSet.has(q.p.id);
    if (st.out) {
      /* 当たり判定：底面と上面の凸包 */
      const pts = []; for (const r of q.ring) { pts.push([X(r[0], r[1]), Y(r[0], r[1], z)], [X(r[0], r[1]), Y(r[0], r[1], z + h)]); }
      hitList.push({ id: q.p.id, hull: hullOf(pts), a });
    }
    if (sel) { g.save(); g.beginPath(); ringPath(q.ring, z + h); g.strokeStyle = st.accent || '#1C7A62'; g.lineWidth = 3; g.shadowColor = st.accent || '#1C7A62'; g.shadowBlur = 10; g.stroke(); g.restore(); }
    if (px >= 12 || sel || isHit) labels.push({ q, x: tx, y: ty, px, a, sel, isHit, off: !!otherFloor });
  };
  const mallFloorDraw = bl => {
    const b = bl.b, bb = bl.bb, nf = b.fl.length, stack = R.stack;
    if (nf > 1 && e > 0.05) {
      const zs = b.fl.map(f => zOfFi(R.fidx.get(f))), z0 = Math.min(...zs), z1 = Math.max(...zs);
      let l = bl.ring[0], r = bl.ring[0]; for (const q of bl.ring) { if (X(q[0], q[1]) < X(l[0], l[1])) l = q; if (X(q[0], q[1]) > X(r[0], r[1])) r = q; }
      g.strokeStyle = P.plateEdge; g.globalAlpha = 0.6 * e; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath();
      for (const q of [l, r]) { g.moveTo(X(q[0], q[1]), Y(q[0], q[1], z0)); g.lineTo(X(q[0], q[1]), Y(q[0], q[1], z1)); }
      g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    }
    for (let k = 0; k < nf; k++) {
      const fid = b.fl[k], fi = R.fidx.get(fid), cur = fi === curFi;
      /* 2Dでは見ている階だけ。3Dでは（階が2つ以上なら）すべての階を重ねて見せる */
      const vis = cur ? 1 : (stack ? e : 0);
      if (vis < 0.02) continue;
      const z = zOfFi(fi);
      if (fi === R.ground && stack && e > 0.02) drawShadow(bl.ring, 6, 0.9);
      else if (cur && !stack && e > 0.02) drawShadow(bl.ring, 6, 0.9);
      g.globalAlpha = vis; prism(bl.ring, z - SLAB, z, cur ? P.plate : (st.dark ? '#262C31' : '#F1EEE4'), hexRgb(st.dark ? '#3C464E' : '#CFC8B3'), cur && stack ? (st.accent || '#1C7A62') : P.plateEdge, vis, 1);
      if (cur && stack && e > 0.3) { g.save(); g.globalAlpha = 0.9 * vis; g.strokeStyle = st.accent || '#1C7A62'; g.lineWidth = 2; g.beginPath(); ringPath(bl.ring, z); g.stroke(); g.restore(); }
      if (b.cor) { g.beginPath(); ringPath(b.cor, z + 0.02); g.fillStyle = P.cor; g.globalAlpha = 0.9 * vis; g.fill(); g.globalAlpha = 1; }
      if (e > 0.02) walls(bl.ring, z, 5.2 * e, false, (cur ? 0.42 : 0.3) * e * vis);
      const mine = (R.groups.get(b.id + '|' + fid) || []).map(q => ({ q, d: DEP(q.cx, q.cy, z) })).sort((p1, p2) => p2.d - p1.d);
      for (const { q } of mine) { const aa = dimOf(q) * vis * (cur ? 1 : 0.93); const h = poiBase(q, z, aa, false); registerPoi(q, z, aa, false, h, !cur); }
      if (e > 0.02) walls(bl.ring, z, 5.2 * e, true, (cur ? 0.34 : 0.26) * e * vis);
      /* 階の札（3Dで重ねたとき）：タップでその階へ */
      if (nf > 1 && e > 0.35 && st.hud !== false) {
        let lv = bl.ring[0], lx = X(lv[0], lv[1]); for (const q of bl.ring) { const x = X(q[0], q[1]); if (x < lx) { lx = x; lv = q; } }
        tags.push({ fid, x: lx, y: Y(lv[0], lv[1], z) + 2, cur, a: Math.min(1, e * 1.4) });
      }
      if (cur && b.n && st.hud !== false && Math.max(bb[2] - bb[0], bb[3] - bb[1]) * S > 120) labels.push({ title: b.n, x: X(bl.cx, bl.cy), y: Y(bb[0] + (bb[2] - bb[0]) / 2, bb[1], z) + 14, a: 1 });
    }
    /* 見ている階が、この建物にない（2D）→ 輪郭だけ */
    if (e < 0.02 && !b.fl.includes(st.floor || '') && R.floors.length > 1) { g.beginPath(); ringPath(bl.ring, 0); g.fillStyle = rgbStr(hexRgb(st.dark ? '#2B3238' : '#DCD6C6'), 0.7); g.fill(); g.setLineDash([5, 4]); g.strokeStyle = P.plateEdge; g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
  };
  /* 先に影をまとめて描く（建物）*/
  for (const it of items) if (it.t === 0) drawShadow(it.o.p, it.o.h, 1);
  for (const it of items) {
    if (it.t === 0) { const b = it.o; if (e < 0.02) { g.beginPath(); ringPath(b.p, 0); g.fillStyle = P.bld; g.fill(); g.strokeStyle = P.bldEdge; g.lineWidth = 0.7; g.stroke(); } else prism(b.p, 0, b.h * e, bTop, bldRgb, P.bldEdge, 1, 1); }
    else if (it.t === 1) { const q = it.o, a = dimOf(q); const h = poiBase(q, 0, a, false); registerPoi(q, 0, a, false, h); }
    else mallFloorDraw(it.o);
  }

  /* 道案内の線・現在地 */
  if (st.route && st.route.length > 1) {
    g.strokeStyle = st.accent || '#1C7A62'; g.lineWidth = 4; g.setLineDash([2, 8]); g.beginPath(); st.route.forEach((q, i) => (i ? g.lineTo(X(q[0], q[1]), Y(q[0], q[1], 0)) : g.moveTo(X(q[0], q[1]), Y(q[0], q[1], 0)))); g.stroke(); g.setLineDash([]);
  }
  if (st.gps) {
    const gz = zOfFi(curFi) * (st.gpsInside ? 1 : 0), gx = X(st.gps.x, st.gps.y), gy = Y(st.gps.x, st.gps.y, gz);
    const ar = clamp((st.gps.acc || 30) * S, 8, 140);
    g.fillStyle = 'rgba(41,121,255,.14)'; g.strokeStyle = 'rgba(41,121,255,.4)'; g.lineWidth = 1; g.beginPath(); g.ellipse(gx, gy, ar, ar * Math.max(0.35, se), 0, 0, 6.283); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(gx, gy, 9, 0, 6.283); g.fill(); g.fillStyle = '#2979FF'; g.beginPath(); g.arc(gx, gy, 6.2, 0, 6.283); g.fill();
    st.gpsPt = [gx, gy];
  }

  /* ラベル：エリア名 → 建物名 → スポット名（かぶらないものだけ）*/
  const placed = [];
  const fits = r => { for (const p of placed) if (r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]) return false; return true; };
  if (st.labels !== false) {
    for (const zl of R.zl) {
      const col = hexRgb(zl.z.c && /^#/.test(zl.z.c) ? zl.z.c : zc[(map.zones || []).indexOf(zl.z) % zc.length]);
      const a = clamp((2.6 - S) / 1.3, 0.0, 0.95); if (a < 0.05) continue;
      const x = X(zl.c[0], zl.c[1]), y = Y(zl.c[0], zl.c[1], 0), font = `700 ${clamp(13 + (1.4 - S) * 3, 12, 18)}px ${FONT}`; const t = zl.z.n; const w = textW(g, font, t);
      if (x < -50 || x > W + 50 || y < -20 || y > H + 20) continue;
      g.globalAlpha = a; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 4; g.strokeStyle = st.dark ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.85)'; g.strokeText(t, x, y); g.fillStyle = rgbStr(shade(col, st.dark ? 1.5 : 0.8)); g.fillText(t, x, y); g.globalAlpha = 1;
      placed.push([x - w / 2 - 4, y - 10, x + w / 2 + 4, y + 10]);
    }
    const order = labels.filter(l => !l.title).sort((a, b) => (b.sel - a.sel) || (b.isHit - a.isHit) || (a.off - b.off) || ((catPri(b.q.p.c)) - (catPri(a.q.p.c))) || (b.px - a.px));
    for (const l of labels.filter(l => l.title)) {
      const font = `700 12px ${FONT}`, [t, w] = clipText(g, font, l.title, 180); const r = [l.x - w / 2 - 8, l.y - 10, l.x + w / 2 + 8, l.y + 10]; if (!fits(r)) continue; placed.push(r);
      g.globalAlpha = 0.92; g.fillStyle = P.pill; roundRect(g, r[0], r[1], r[2] - r[0], r[3] - r[1], 10); g.fill(); g.globalAlpha = 1; g.font = font; g.fillStyle = P.ink2; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, l.x, l.y + 0.5);
    }
    let count = 0;
    for (const l of order) {
      const q = l.q, p = q.p; const bigEnough = l.px >= (catPri(p.c) >= 7 ? 24 : 36);
      const rb = clamp(l.px * 0.2, 6.5, 13.5);
      const showBadge = l.px >= 12 || l.sel || l.isHit;
      const bx = l.x, by = l.y - (e > 0.05 ? 0 : 0);
      if (showBadge) {
        const br = [bx - rb - 1, by - rb - 1, bx + rb + 1, by + rb + 1];
        if ((l.sel || l.isHit || fits(br))) { placed.push(br); drawBadge(g, bx, by, rb, q.rgb, catOf(p.c).ic, l.a, l.sel); }
      }
      if ((bigEnough || l.sel || l.isHit) && count < 140) {
        const font = `600 ${l.sel ? 13 : 11.5}px ${FONT}`, maxw = l.sel ? 240 : clamp(l.px * 2.4, 90, 190); const [t, w] = clipText(g, font, l.sel ? p.n : shortName(p.n), maxw);
        const ph = l.sel ? 22 : 19, r = [bx - w / 2 - 7, by + rb + 3, bx + w / 2 + 7, by + rb + 3 + ph];
        if (l.sel || fits(r)) { placed.push(r); count++; g.globalAlpha = l.a; g.fillStyle = P.pill; roundRect(g, r[0], r[1], r[2] - r[0], ph, ph / 2); g.fill(); g.strokeStyle = l.sel ? (st.accent || '#1C7A62') : P.pillLine; g.lineWidth = l.sel ? 1.6 : 0.8; g.stroke(); g.font = font; g.fillStyle = P.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, bx, r[1] + ph / 2 + 0.5); g.globalAlpha = 1; }
      }
    }
  }
  /* 階の札 */
  for (const t of tags) {
    const font = `700 11.5px ${FONT}`, txt = t.fid, w = textW(g, font, txt) + 14, x0 = t.x - w - 8, y0 = t.y - 10;
    g.globalAlpha = t.a; g.fillStyle = t.cur ? (st.accent || '#1C7A62') : P.pill; roundRect(g, x0, y0, w, 20, 10); g.fill(); g.strokeStyle = t.cur ? 'rgba(255,255,255,.8)' : P.pillLine; g.lineWidth = 1; g.stroke();
    g.font = font; g.fillStyle = t.cur ? '#fff' : P.ink2; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, x0 + w / 2, y0 + 10.5); g.globalAlpha = 1;
    if (st.out) hitList.push({ id: 'floor:' + t.fid, hull: [[x0 - 4, y0 - 4], [x0 + w + 4, y0 - 4], [x0 + w + 4, y0 + 24], [x0 - 4, y0 + 24]], a: 1, tag: true });
  }
  /* 縮尺 */
  if (st.hud !== false) {
    const nice = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; let m = nice[0]; for (const v of nice) { if (v * S >= 56) { m = v; break; } m = v; }
    const px = m * S; if (px < 160) { const x0 = 14, y0 = H - 16; g.strokeStyle = P.ink2; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y0 - 5); g.lineTo(x0, y0); g.lineTo(x0 + px, y0); g.lineTo(x0 + px, y0 - 5); g.stroke(); g.font = `600 11px ${FONT}`; g.fillStyle = P.ink2; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.lineWidth = 3; g.strokeStyle = st.dark ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.8)'; g.strokeText(m >= 1000 ? m / 1000 + 'km' : m + 'm', x0 + 4, y0 - 6); g.fillText(m >= 1000 ? m / 1000 + 'km' : m + 'm', x0 + 4, y0 - 6); }
  }
  if (st.out) { hitList.reverse(); st.out.hits = hitList; st.out.proj = { ox, oy, S, ca, sa, se, ce, cx: cam.cx, cy: cam.cy }; }
}
const CAT_PRI = { ride: 9, show: 8, play: 7, gate: 7, food: 6, shop: 5, fashion: 5, goods: 5, grocery: 5, cafe: 5, service: 4, facility: 4, parking: 3, wc: 2, other: 1 };
const catPri = c => CAT_PRI[c] || 1;
function roundRect(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawBadge(g, x, y, r, rgb, icon, a, sel) {
  g.globalAlpha = a; g.fillStyle = rgbStr(rgb); g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
  g.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,.92)'; g.lineWidth = sel ? 2.2 : 1.4; g.stroke();
  const im = IconImg.get(icon, '#ffffff'); if (im) g.drawImage(im, x - r * 0.64, y - r * 0.64, r * 1.28, r * 1.28);
  g.globalAlpha = 1;
}
