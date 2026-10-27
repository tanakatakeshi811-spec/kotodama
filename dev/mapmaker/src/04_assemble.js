
/* ---------- 組み立て：プラン（輪郭・建物・階・エリア・スポットの一覧）→ 場所つきのマップ ---------- */
function normFloor(s) {
  s = String(s == null ? '' : s).normalize('NFKC').trim(); if (!s) return '';
  let m;
  if ((m = s.match(/^(?:地下|B)\s*(\d+)/i))) return 'B' + parseInt(m[1], 10);
  if ((m = s.match(/^(\d+)\s*(?:F|階|f)?$/))) return parseInt(m[1], 10) + 'F';
  if ((m = s.match(/^(\d+)\s*(?:F|階|f)/))) return parseInt(m[1], 10) + 'F';
  if (/^(G|GF|地上|グラウンド|ground)/i.test(s)) return '1F';
  if (/^(R|RF|屋上|ルーフ|roof)/i.test(s)) return 'RF';
  return '';
}
function floorLv(id) { if (id === 'RF') return 99; let m = String(id).match(/^B(\d+)$/); if (m) return -parseInt(m[1], 10); const n = parseInt(id, 10); return isFinite(n) ? n - 1 : 0; }
const floorLabel = id => (id === 'RF' ? '屋上' : /^B\d+$/.test(id) ? '地下' + id.slice(1) + '階' : parseInt(id, 10) + '階');
function defaultSite(kind, c = [0, 0]) {
  const R = { mall: 170, park: 480, store: 105, station: 220, campus: 330, other: 170 }[kind] || 170;
  return Array.from({ length: 14 }, (_, i) => { const a = i / 14 * Math.PI * 2; return [r1(c[0] + Math.cos(a) * R * 1.2), r1(c[1] + Math.sin(a) * R * 0.86)]; });
}
const expandRect = (ring, m) => { const ob = obbOf(ring); return rectPoly(ob.cx, ob.cy, ob.w + 2 * m, ob.d + 2 * m, ob.rot); };
function nearestOnRoads(roads, x, y, maxD) {
  let best = null, bd = maxD || 1e9;
  for (const r of roads) { if (r.t === 'p' || r.t === 'r') continue; const p = r.p; for (let i = 0; i + 1 < p.length; i++) { const A = p[i], B = p[i + 1], dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy || 1, t = clamp(((x - A[0]) * dx + (y - A[1]) * dy) / l2, 0, 1), px = A[0] + t * dx, py = A[1] + t * dy, d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = [px, py]; } } }
  return best;
}

function distToRings(x, y, rings) {
  let bd = 1e9;
  for (const r of rings) for (let i = 0, n = r.length; i < n; i++) { const A = r[i], B = r[(i + 1) % n], dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy || 1, t = clamp(((x - A[0]) * dx + (y - A[1]) * dy) / l2, 0, 1), d = Math.hypot(x - (A[0] + t * dx), y - (A[1] + t * dy)); if (d < bd) bd = d; }
  return bd;
}
/* 最初に見せる範囲：建物がある場所は建物のまわり、広い場所は敷地ぜんたい */
function focusBox(map) {
  const e = map.ext || [-100, -100, 100, 100];
  if (map.kind === 'park' || map.kind === 'campus' || !(map.bldgs || []).length) { if (map.site && map.site.length > 2 && (map.kind === 'park' || map.kind === 'campus')) { const b = bboxOf(map.site); return [b[0] - 20, b[1] - 20, b[2] + 20, b[3] + 20]; } return e; }
  const pts = []; for (const b of map.bldgs) for (const q of b.ring) pts.push(q);
  let b0 = bboxOf(pts); const pad = 38;
  for (const p of map.pois || []) { if (p.f) continue; if (p.x > b0[0] - 90 && p.x < b0[2] + 90 && p.y > b0[1] - 90 && p.y < b0[3] + 90) pts.push([p.x, p.y]); }
  b0 = bboxOf(pts); return [b0[0] - pad, b0[1] - pad, b0[2] + pad, b0[3] + pad];
}
function assemble(plan, seed) {
  const kind = plan.kind || 'other', rng = mulberry(seed || hashN(plan.name || 'x'));
  const ctx = plan.ctx || { b: [], r: [], w: [], wl: [], g: [], k: [] };
  for (const k of ['b', 'r', 'w', 'wl', 'g', 'k']) if (!ctx[k]) ctx[k] = [];
  let site = plan.site && plan.site.length >= 3 ? ccw(plan.site) : null;
  const pois = (plan.pois || []).map((p, i) => Object.assign({}, p, { id: 'p' + (i + 1) }));
  /* --- 階 --- */
  const fmap = new Map();
  const addFloor = (id, nm) => { id = normFloor(id); if (!id) return ''; if (!fmap.has(id)) fmap.set(id, { id, n: nm || id, lv: floorLv(id) }); return id; };
  for (const f of plan.floors || []) addFloor(f.id || f.n, f.name || f.n);
  for (const p of pois) { p.ex = p.out === true || (typeof p.f === 'string' && !normFloor(p.f)); p.f = p.f ? addFloor(p.f) : ''; p.c = CATS[p.c] ? p.c : guessCat(p.n + ' ' + (p.ds || '')); }
  /* --- 建物 --- */
  let bldgs = (plan.bldgs || []).map((b, i) => ({ id: b.id || 'b' + (i + 1), n: b.n || b.name || '', ring: b.ring && b.ring.length >= 3 ? ccw(b.ring) : null, fl: (b.fl || b.floors || []).map(normFloor).filter(Boolean), pos: b.pos || '' }));
  const hasIndoor = pois.some(p => p.f) || (kind === 'store' || kind === 'mall') && bldgs.length > 0;
  if (kind === 'store' || (kind === 'mall' && !bldgs.length)) { if (!bldgs.length) bldgs = [{ id: 'b1', n: kind === 'store' ? '店舗' : '本館', ring: null, fl: [], pos: '' }]; }
  else if (hasIndoor && !bldgs.length) bldgs = [{ id: 'b1', n: '本館', ring: null, fl: [], pos: '' }];
  const bById = new Map(bldgs.map(b => [b.id, b])), bByKey = new Map(bldgs.map(b => [nameKey(b.n), b]));
  const findB = s => { if (!s) return null; if (bById.has(s)) return bById.get(s); const k = nameKey(s); if (bByKey.has(k)) return bByKey.get(k); for (const b of bldgs) { const bk = nameKey(b.n); if (bk && k && (bk.includes(k) || k.includes(bk))) return b; } return null; };
  const indoorKind = bldgs.length > 0;
  for (const p of pois) {
    let b = null;
    if (!p.ex) {
      b = findB(p.b);
      if (!b && indoorKind) {
        if (p.f) b = bldgs.find(x => x.fl.includes(p.f)) || bldgs[0];
        else if ((kind === 'store' || kind === 'mall') && p.c !== 'parking') b = bldgs[0];
      }
    }
    if (b && !p.f) p.f = addFloor('1F');
    p.b = b && p.f ? b.id : '';
    if (!p.b && p.f && !indoorKind) p.f = '';
    if (p.b) { const bb = bById.get(p.b); if (!bb.fl.includes(p.f)) bb.fl.push(p.f); }
  }
  for (const b of bldgs) { for (const f of b.fl) addFloor(f); b.fl.sort((a, c) => floorLv(a) - floorLv(c)); }
  if (indoorKind) for (const b of bldgs) if (!b.fl.length) { b.fl = ['1F']; addFloor('1F'); }
  /* --- 輪郭・建物のかたちが無いときの仮の形 --- */
  if (!site) {
    if (kind === 'mall' || kind === 'store') site = null;
    else site = defaultSite(kind);
  }
  const needSynth = bldgs.filter(b => !b.ring);
  if (needSynth.length) {
    const real = bldgs.filter(b => b.ring), base = real.length ? obbOf(real.flatMap(b => b.ring)) : site ? obbOf(site) : { cx: 0, cy: 0, rot: 0 };
    const sizes = needSynth.map(b => {
      const per = {}; for (const p of pois) if (p.b === b.id) per[p.f] = (per[p.f] || 0) + sizeWeight(p);
      const maxW = Math.max(6, ...Object.values(per));
      const A = clamp(maxW * 190 * 1.45, kind === 'store' ? 5000 : 1800, kind === 'store' ? 18000 : 70000);
      const asp = kind === 'store' ? 1.5 : 2.5, w = Math.sqrt(A * asp), d = A / w;
      return { w, d };
    });
    const gap = 40, tot = sizes.reduce((a, s) => a + s.w, 0) + gap * (sizes.length - 1);
    let u = real.length ? base.w / 2 + gap : -tot / 2; const cr = Math.cos(base.rot), sr = Math.sin(base.rot);
    needSynth.forEach((b, k) => { const s = sizes[k], uc = u + s.w / 2; u += s.w + gap; b.ring = rectPoly(base.cx + uc * cr, base.cy + uc * sr, s.w, s.d, base.rot); b.synth = true; });
    if (!site) { const all = bldgs.flatMap(b => b.ring); const ob = obbOf(all); site = rectPoly(ob.cx, ob.cy, ob.w + 120, ob.d + 120, ob.rot); }
  }
  if (!site) site = defaultSite(kind);
  /* --- 建物の中：階ごとにならべる --- */
  const placed = new Set();
  const corridors = {};
  const entrance = (() => {
    if (kind !== 'store' || !bldgs[0]) return null;
    const b = bldgs[0], c = polyCentroid(b.ring);
    let best = null, bd = 1e9; for (const kk of ctx.k) { const q = polyCentroid(kk), d = Math.hypot(q[0] - c[0], q[1] - c[1]); if (d < bd && d < 200) { bd = d; best = q; } }
    if (!best) best = nearestOnRoads(ctx.r, c[0], c[1], 160);
    if (!best) return [0, -1]; const v = [best[0] - c[0], best[1] - c[1]], L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L];
  })();
  for (const b of bldgs) {
    for (const f of b.fl) {
      const items = pois.filter(p => p.b === b.id && p.f === f);
      if (!items.length) continue;
      const ob = obbOf(b.ring);
      let res;
      if (kind === 'store') res = storeLayout(b.ring, items, entrance);
      else if (Math.min(ob.w, ob.d) < 16 && items.length <= 6) res = gridLayout(b.ring, items);
      else res = stripLayout(b.ring, items);
      for (const c of res.cells) { const p = items[c.i]; p.x = c.x; p.y = c.y; p.w = c.w; p.l = c.d; p.r = r2(c.rot); p.ps = 'est'; placed.add(p.id); }
      if (res.corridor && !b.cor) b.cor = res.corridor.map(q => [q[0], q[1]]);
    }
  }
  /* --- 屋外：OSMで場所が分かっているものはそのまま、ほかはエリアごとに空いた所へ --- */
  const region = (kind === 'mall' || kind === 'store') ? expandRect(site, kind === 'store' ? 70 : 90) : site;
  const fixed = [];
  for (const p of pois) {
    if (placed.has(p.id) || p.b) continue;
    const o = p.osm; if (!o || o.x == null) continue;
    let w, l, r = 0, ring = null;
    if (o.ring && o.ring.length >= 3 && o.area > 6) { const ob = obbOf(o.ring); w = Math.max(3, ob.w); l = Math.max(3, ob.d); r = ob.rot; ring = o.ring; p.x = r1(polyCentroid(o.ring)[0]); p.y = r1(polyCentroid(o.ring)[1]); }
    else { [w, l] = shapeOf(p); p.x = o.x; p.y = o.y; }
    p.w = r1(w); p.l = r1(l); p.r = r2(r); if (ring) p.ring = ring; p.ps = 'osm'; placed.add(p.id);
    fixed.push({ x: p.x, y: p.y, w: p.w, d: p.l, rot: p.r });
  }
  /* エリア */
  const zlist = (plan.zones || []).map((z, i) => ({ id: z.id || 'z' + (i + 1), n: z.n || z.name || '', pos: z.pos || '', c: z.c || '' }));
  const zById = new Map(zlist.map(z => [z.id, z])), zByKey = new Map(zlist.map(z => [nameKey(z.n), z]));
  for (const p of pois) { if (!p.z) continue; const z = zById.get(p.z) || zByKey.get(nameKey(p.z)) || zlist.find(zz => { const a = nameKey(zz.n), b = nameKey(p.z); return a && b && (a.includes(b) || b.includes(a)); }); p.z = z ? z.id : ''; }
  for (const z of zlist) { const mem = pois.filter(p => p.z === z.id && p.ps === 'osm'); z.seed = mem.length ? [mem.reduce((a, p) => a + p.x, 0) / mem.length, mem.reduce((a, p) => a + p.y, 0) / mem.length] : null; z.hint = parsePos(z.pos); }
  const free = pois.filter(p => !placed.has(p.id));
  const sb = bboxOf(region);
  const obst = []; for (const bb of ctx.b) { const b0 = bboxOf(bb.p); if (b0[2] > sb[0] - 40 && b0[0] < sb[2] + 40 && b0[3] > sb[1] - 40 && b0[1] < sb[3] + 40) obst.push(bb.p); }
  for (const b of bldgs) obst.push(b.ring);
  const paths = ctx.r.filter(r => r.t === 'p' || r.t === 'n').map(r => r.p);
  let zonePolys = [];
  if (free.length || zlist.length) {
    const bring = bldgs.map(b => b.ring);
    const bias = (p, x, y) => {
      let sc = 0;
      if (p.c === 'parking' && (sizeWeight(p) >= 4 || /駐車場/.test(p.n))) { for (const k of ctx.k) if (inPoly(x, y, k)) { sc += 2.2; break; } }
      if (bring.length && (p.c === 'gate' || (p.c === 'parking' && /バス|タクシー|乗り場|駐輪/.test(p.n)))) sc -= Math.abs(distToRings(x, y, bring) - 11) * 0.1;
      return sc;
    };
    const rr = parkLayout(region, fixed, free, zlist.length ? zlist : [{ id: '_', seed: null, hint: null }], obst, paths, hashN(plan.name || 'x') ^ 7919, bias);
    free.forEach((p, k) => { const q = rr.placed[k]; p.x = q.x; p.y = q.y; p.w = q.w; p.l = q.d; p.r = q.rot; p.ps = 'est'; });
    zonePolys = rr.zonePolys;
  }
  const zones = zlist.map((z, k) => ({ id: z.id, n: z.n, ring: zlist.length > 1 && zonePolys[k] ? zonePolys[k] : null, c: z.c || '' })).filter(z => z.n);
  /* --- 出来上がり --- */
  const floors = [...fmap.values()].sort((a, b) => a.lv - b.lv);
  const ptsAll = []; for (const q of site) ptsAll.push(q); for (const b of bldgs) for (const q of b.ring) ptsAll.push(q); for (const p of pois) ptsAll.push([p.x, p.y]);
  const eb = bboxOf(ptsAll); const ext = [r1(eb[0] - 25), r1(eb[1] - 25), r1(eb[2] + 25), r1(eb[3] + 25)];
  const outP = pois.map(p => {
    const o = { id: p.id, n: p.n, c: p.c, x: p.x, y: p.y, w: p.w, l: p.l, r: p.r };
    if (p.f) o.f = p.f; if (p.b) o.b = p.b; if (p.z) o.z = p.z; if (p.ring) o.ring = p.ring;
    for (const k of ['ds', 'hrs', 'url', 'tel', 'pos']) if (p[k]) o[k] = String(p[k]).slice(0, 400);
    o.src = p.src || 'ai'; o.ps = p.ps || 'est'; if (p.tg && p.tg.length) o.tg = p.tg.slice(0, 8); if (p.ht) o.ht = p.ht; if (p.cf) o.cf = p.cf;
    return o;
  });
  return {
    v: 1, id: plan.id, name: plan.name, kind, addr: plan.addr || '', ll: plan.ll || null, created: plan.created || Date.now(), updated: Date.now(), sample: plan.sample ? 1 : 0,
    ext, site: site.map(q => [r1(q[0]), r1(q[1])]), ctx, floors,
    bldgs: bldgs.map(b => ({ id: b.id, n: b.n, ring: b.ring.map(q => [r1(q[0]), r1(q[1])]), fl: b.fl, cor: b.cor || null, synth: b.synth ? 1 : 0 })),
    zones, pois: outP, info: plan.info || {},
  };
}
