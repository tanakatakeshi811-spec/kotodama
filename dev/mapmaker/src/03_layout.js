
/* ---------- 配置：店やアトラクションに「場所」をあたえる ----------
   OpenStreetMapに実際の位置がある分は、そこをそのまま使う。ない分は、建物のかたち・通路・エリアをもとに見取り図として並べる（目安）。 */
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hashN = s => { let h = 2166136261; s = String(s || ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/* 店の広さの目安（相対）。AIが w を返したらそれを使う */
function sizeWeight(p) {
  if (p.w != null && isFinite(+p.w) && +p.w > 0) return clamp(+p.w, 0.4, 10);
  const n = p.n || '';
  if (/フードコート|映画|シネマ|TOHO|109|ラウンドワン|ROUND1|スーパー|イオン|ヨドバシ|ビックカメラ|アリーナ|百貨店|デパート/.test(n)) return 6;
  if (/ユニクロ|UNIQLO|ニトリ|無印|MUJI|ロフト|LOFT|ハンズ|ドン・キホーテ|ドンキ|ダイソー|GU|ジーユー|しまむら|H&M|ZARA|西松屋|書店|ブックス|TSUTAYA|蔦屋|ゲーム|ボウリング|スポーツ|ゴルフ|ホール|アカチャン|バースデイ|キッズ|ABC/.test(n)) return 4;
  if (p.c === 'service' || p.c === 'wc' || p.c === 'facility' || p.c === 'gate') return 0.7;
  if (p.c === 'cafe') return 0.9;
  if (p.c === 'food') return 1.3;
  if (p.c === 'fashion' || p.c === 'goods' || p.c === 'shop' || p.c === 'grocery') return 1.2;
  return 1;
}
/* 向きのヒント（北・南東など）→ 単位ベクトル。北が +y */
const DIRW = [['北東', [1, 1]], ['北西', [-1, 1]], ['南東', [1, -1]], ['南西', [-1, -1]], ['北', [0, 1]], ['南', [0, -1]], ['東', [1, 0]], ['西', [-1, 0]]];
function parsePos(t) {
  t = String(t || ''); if (!t) return null;
  for (const [k, d] of DIRW) if (t.includes(k)) { const L = Math.hypot(d[0], d[1]) || 1; return [d[0] / L, d[1] / L]; }
  if (/中央|真ん中|まんなか|中心|真中/.test(t)) return [0, 0];
  return null;
}

/* 軸にそった線(v=一定)と多角形の交わる区間のうち、いちばん長いもの */
function scanInterval(polyLocal, v) {
  const xs = [];
  for (let i = 0, n = polyLocal.length; i < n; i++) {
    const a = polyLocal[i], b = polyLocal[(i + 1) % n];
    if ((a[1] > v) !== (b[1] > v)) xs.push(a[0] + (v - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
  }
  xs.sort((p, q) => p - q);
  const iv = []; for (let i = 0; i + 1 < xs.length; i += 2) iv.push([xs[i], xs[i + 1]]);
  const merged = [];
  for (const s of iv) { const last = merged[merged.length - 1]; if (last && s[0] - last[1] < 7) last[1] = Math.max(last[1], s[1]); else merged.push(s.slice()); }
  merged.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
  return merged[0] || null;
}
/* 重みに比例した幅をならべる（幅の下限・上限をおさえつつ、全体に合わせる） */
function fitWidths(weights, total, minW, maxW) {
  const n = weights.length; if (!n) return [];
  let w = weights.slice(), fixed = new Array(n).fill(false), left = total;
  for (let pass = 0; pass < 4; pass++) {
    let sw = 0; for (let i = 0; i < n; i++) if (!fixed[i]) sw += weights[i];
    if (sw <= 0) break;
    let changed = false;
    for (let i = 0; i < n; i++) if (!fixed[i]) {
      w[i] = weights[i] / sw * left;
      if (w[i] < minW) { w[i] = minW; fixed[i] = true; left -= minW; changed = true; }
      else if (w[i] > maxW) { w[i] = maxW; fixed[i] = true; left -= maxW; changed = true; }
    }
    if (!changed) break;
    left = Math.max(0, left);
  }
  return w;
}
/* 建物のかたち ring の中に、真ん中の通路をはさんで店を2列(せまければ4列)に並べる
   items: [{n, c, w, pos}]  戻り: { cells:[{i,x,y,w,d,rot}], corridor: ring|null, rot } */
function stripLayout(ring, items, opt = {}) {
  const ob = obbOf(ring), L = ob.w, D = ob.d, rot = ob.rot;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const toW = (u, v) => [ob.cx + u * cr - v * sr, ob.cy + u * sr + v * cr];
  const toL = ([x, y]) => { const dx = x - ob.cx, dy = y - ob.cy; return [dx * cr + dy * sr, -dx * sr + dy * cr]; };
  const polyL = ring.map(toL);
  const n = items.length, out = { cells: [], corridor: null, rot, ob };
  if (!n) return out;
  const gap = 0.6, margin = 1.5;
  const ws = items.map(sizeWeight);
  /* せまい建物は通路なしの1列 */
  const noCor = D < 24 || opt.noCorridor;
  const cw = noCor ? 0 : clamp(D * 0.17, 7, 13);
  const rows = [];   // 各列: {v0, v1, u0, u1}
  const sides = noCor ? [0] : [1, -1];
  const rdTotal = noCor ? D - 2 * margin : (D - cw) / 2 - margin;
  /* 1辺に列がいくつ要るか */
  const avgW = (2 * L * 0.9) / n;
  const sub = !noCor && avgW < 5.5 && rdTotal >= 16 ? 2 : (noCor && L * 0.9 / n < 5.5 && rdTotal >= 16 ? 2 : 1);
  for (const sd of sides) {
    for (let k = 0; k < sub; k++) {
      const rd = rdTotal / sub;
      let vc;
      if (noCor) vc = (k - (sub - 1) / 2) * rd;
      else vc = sd * (cw / 2 + margin * 0.5 + rd * (k + 0.5));
      const iv = scanInterval(polyL, vc) || [-L / 2, L / 2];
      const u0 = iv[0] + margin + 0.5, u1 = iv[1] - margin - 0.5;
      if (u1 - u0 < 4) continue;
      rows.push({ vc, rd, u0, u1, side: sd });
    }
  }
  if (!rows.length) rows.push({ vc: 0, rd: Math.max(4, D - 2), u0: -L / 2 + 1, u1: L / 2 - 1, side: 0 });
  const cap = rows.reduce((s, r) => s + (r.u1 - r.u0), 0);
  /* 並べる順番：AIが向きをくれていればそれで、なければ書かれた順 */
  const axis = [cr, sr], cross = [-sr, cr];
  const hints = items.map(it => parsePos(it.pos));
  const nh = hints.filter(h => h && (h[0] || h[1])).length;
  let order = items.map((_, i) => i);
  const rowOf = new Array(n).fill(-1);
  const total = ws.reduce((a, b) => a + b, 0);
  if (nh >= Math.max(3, n * 0.5) && rows.length > 1) {
    /* 向きで列と前後を決める */
    const key = hints.map(h => (h ? h[0] * axis[0] + h[1] * axis[1] : null));
    let prev = -1; for (let i = 0; i < n; i++) { if (key[i] == null) key[i] = prev; else prev = key[i]; }
    const crs = hints.map(h => (h ? h[0] * cross[0] + h[1] * cross[1] : 0));
    const load = rows.map(() => 0), want = rows.map(r => (r.u1 - r.u0) / cap * total);
    for (let i = 0; i < n; i++) {
      let best = -1;
      if (Math.abs(crs[i]) > 0.35) { const side = crs[i] > 0 ? 1 : -1; const cand = rows.map((r, j) => j).filter(j => rows[j].side === side); if (cand.length) best = cand.reduce((a, b) => (load[a] / want[a] <= load[b] / want[b] ? a : b)); }
      if (best < 0) best = rows.map((r, j) => j).reduce((a, b) => (load[a] / want[a] <= load[b] / want[b] ? a : b));
      rowOf[i] = best; load[best] += ws[i];
    }
    order = order.sort((a, b) => (rowOf[a] - rowOf[b]) || (key[a] - key[b]) || (a - b));
  } else {
    /* 書かれた順に、列をつなげて1周するようにならべる（となり合う店が実際にもとなりになりやすい） */
    let acc = 0, ri = 0;
    const rowW = rows.map(r => (r.u1 - r.u0) / cap * total);
    for (let i = 0; i < n; i++) {
      while (ri < rows.length - 1 && acc + ws[i] / 2 > rowW[ri]) { acc -= rowW[ri]; ri++; }
      rowOf[i] = ri; acc += ws[i];
    }
  }
  for (let ri = 0; ri < rows.length; ri++) {
    const mine = order.filter(i => rowOf[i] === ri); if (!mine.length) continue;
    const r = rows[ri], len = r.u1 - r.u0;
    const widths = fitWidths(mine.map(i => ws[i]), len * 0.97, 3.2, Math.min(60, len));
    const tot = widths.reduce((a, b) => a + b, 0);
    /* 書かれた順にならべる場合、反対側の列は東→西にたどる（建物をぐるっと1周する並び）*/
    const rev = !(nh >= Math.max(3, n * 0.5) && rows.length > 1) && r.side < 0;
    const us = []; let cursor = rev ? r.u1 - (len - tot) / 2 : r.u0 + (len - tot) / 2;
    mine.forEach((_, k) => { if (rev) { us[k] = cursor - widths[k] / 2; cursor -= widths[k]; } else { us[k] = cursor + widths[k] / 2; cursor += widths[k]; } });
    mine.forEach((i, k) => {
      const [x, y] = toW(us[k], r.vc);
      out.cells.push({ i, x: r1(x), y: r1(y), w: r1(Math.max(2.4, widths[k] - gap)), d: r1(Math.max(2.4, r.rd - gap)), rot });
    });
  }
  if (!noCor) {
    const iv = scanInterval(polyL, 0) || [-L / 2, L / 2];
    out.corridor = rectPoly(...toW((iv[0] + iv[1]) / 2, 0), Math.max(4, iv[1] - iv[0] - 2), cw, rot);
  }
  return out;
}
/* 輪郭がほぼ正方形/小さいときのマス目並び */
function gridLayout(ring, items) {
  const ob = obbOf(ring), n = items.length; if (!n) return { cells: [], corridor: null, rot: ob.rot, ob };
  const cols = Math.max(1, Math.round(Math.sqrt(n * ob.w / Math.max(ob.d, 1)))), rowsN = Math.ceil(n / cols);
  const cw = (ob.w - 3) / cols, ch = (ob.d - 3) / rowsN, cr = Math.cos(ob.rot), sr = Math.sin(ob.rot), cells = [];
  for (let k = 0; k < n; k++) {
    const c = k % cols, r = Math.floor(k / cols), u = -ob.w / 2 + 1.5 + cw * (c + 0.5), v = -ob.d / 2 + 1.5 + ch * (r + 0.5);
    cells.push({ i: k, x: r1(ob.cx + u * cr - v * sr), y: r1(ob.cy + u * sr + v * cr), w: r1(Math.max(2.4, cw - 0.6)), d: r1(Math.max(2.4, ch - 0.6)), rot: ob.rot });
  }
  return { cells, corridor: null, rot: ob.rot, ob };
}
/* ツリーマップ（面積に比例した長方形に分ける）。rect = {x,y,w,h}（x,yは左下）。戻り: rect の配列（入力と同じ順）*/
function treemap(rect, weights) {
  const n = weights.length; if (!n) return [];
  const sumW = weights.reduce((a, b) => a + b, 0) || 1, A = rect.w * rect.h;
  const areas = weights.map(w => w / sumW * A);
  const idx = areas.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
  const res = new Array(n);
  let r = { ...rect }, row = [];
  const worst = (row0, side) => { const s = row0.reduce((a, i) => a + areas[i], 0), mx = Math.max(...row0.map(i => areas[i])), mn = Math.min(...row0.map(i => areas[i])); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
  const layoutRow = rowIdx => {
    const s = rowIdx.reduce((a, i) => a + areas[i], 0);
    if (r.w >= r.h) { const w = s / r.h; let y = r.y; for (const i of rowIdx) { const h = areas[i] / w; res[i] = { x: r.x, y, w, h }; y += h; } r = { x: r.x + w, y: r.y, w: r.w - w, h: r.h }; }
    else { const h = s / r.w; let x = r.x; for (const i of rowIdx) { const w = areas[i] / h; res[i] = { x, y: r.y, w, h }; x += w; } r = { x: r.x, y: r.y + h, w: r.w, h: r.h - h }; }
  };
  for (const i of idx) {
    const side = Math.min(r.w, r.h);
    if (!row.length || worst(row.concat(i), side) <= worst(row, side)) row.push(i); else { layoutRow(row); row = [i]; }
  }
  if (row.length) layoutRow(row);
  return res;
}
/* 大型店：入口側を手前にして、売り場を面積に比例して並べる */
function storeLayout(ring, sections, entrance) {
  const ob = obbOf(ring), cr = Math.cos(ob.rot), sr = Math.sin(ob.rot);
  const toW = (u, v) => [ob.cx + u * cr - v * sr, ob.cy + u * sr + v * cr];
  /* 入口がある側（entrance = 世界座標の向きベクトル）を v のマイナス側（手前）にそろえる */
  let flip = 1;
  if (entrance) { const dv = entrance[0] * (-sr) + entrance[1] * cr; if (dv > 0) flip = -1; }
  const front = /入口|入り口|レジ|会計|カウンター|カート|サービス|フードコート|出口|メンバーシップ|受付|ロッカー|案内/;
  const back = /生鮮|青果|精肉|鮮魚|惣菜|ベーカリー|パン|冷凍|冷蔵|乳製品|チルド|デリ|ミート|ワイン|お酒|フラワー/;
  const bands = [[], [], []];
  sections.forEach((s, i) => { const t = (s.n || '') + (s.pos || ''); (front.test(t) ? bands[0] : back.test(t) ? bands[2] : bands[1]).push(i); });
  const cells = [];
  const props = [0.16, 0.6, 0.24];
  const act = bands.map((b, k) => ({ b, k })).filter(x => x.b.length);
  const ps = act.reduce((a, x) => a + props[x.k], 0) || 1;
  let v0 = -ob.d / 2 + 1;
  for (const { b, k } of act) {
    const h = (ob.d - 2) * props[k] / ps;
    const rects = treemap({ x: -ob.w / 2 + 1, y: 0, w: ob.w - 2, h }, b.map(i => Math.max(0.5, sizeWeight(sections[i]))));
    b.forEach((i, j) => {
      const q = rects[j]; const u = q.x + q.w / 2, v = (flip > 0 ? v0 : -v0 - h) + q.y + q.h / 2;
      const [x, y] = toW(u, v);
      cells.push({ i, x: r1(x), y: r1(y), w: r1(Math.max(2.4, q.w - 0.8)), d: r1(Math.max(2.4, q.h - 0.8)), rot: ob.rot });
    });
    v0 += h;
  }
  return { cells, corridor: null, rot: ob.rot, ob };
}

/* 多角形を「点 s に近い側」の半平面で切る（ボロノイの1辺ぶん）*/
function clipHalf(poly, s, t, wBias = 0) {
  /* 点 p が s に近い ⇔ |p-s|² - |p-t|² <= wBias */
  const f = p => (p[0] - s[0]) ** 2 + (p[1] - s[1]) ** 2 - ((p[0] - t[0]) ** 2 + (p[1] - t[1]) ** 2) - wBias;
  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa <= 0) !== (fb <= 0)) { const k = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
  }
  return out;
}
function voronoiZones(site, seeds) {
  return seeds.map((s, i) => {
    let p = site.slice();
    for (let j = 0; j < seeds.length && p.length >= 3; j++) if (j !== i) p = clipHalf(p, s, seeds[j]);
    return p.length >= 3 ? p.map(q => [r1(q[0]), r1(q[1])]) : null;
  });
}
/* 名前の特徴から、アトラクションなどの大きさ(m)の目安 */
const SHAPE_DEF = {
  ride: [24, 24], play: [18, 14], show: [30, 22], food: [18, 13], cafe: [12, 9], shop: [15, 11], fashion: [13, 10], goods: [13, 10], grocery: [18, 12], service: [10, 8], facility: [9, 8], wc: [6, 5], gate: [10, 6], parking: [40, 22], other: [10, 8],
};
function shapeOf(p) {
  let [w, d] = SHAPE_DEF[p.c] || SHAPE_DEF.other; const k = Math.sqrt(sizeWeight(p) / (p.c === 'ride' ? 1 : 1.2));
  if (p.c === 'ride') { if (/コースター|マウンテン|ドロップ|タワー|フリーフォール|ウォーターコースター/.test(p.n || '')) { w = 44; d = 22; } else if (/観覧車|ホイール/.test(p.n || '')) { w = 30; d = 30; } else if (/メリーゴー|カルーセル|回転/.test(p.n || '')) { w = 20; d = 20; } else if (/シアター|ショー|ステージ/.test(p.n || '')) { w = 34; d = 26; } }
  else if (p.c !== 'wc' && p.c !== 'gate' && p.c !== 'parking') { w *= clamp(k, 0.7, 1.7); d *= clamp(k, 0.7, 1.7); }
  return [r1(w), r1(d)];
}
/* 屋外の広い場所（テーマパーク・キャンパスなど）：エリアごとに、道ぞいの空いているところへ置く
   site: 敷地の輪郭 / fixed: すでに場所が決まっているもの [{x,y,w,d,rot}] / free: 置くもの [{c,n,z,pos,w}]
   zones: [{id, seed:[x,y]|null, hint:[dx,dy]|null}] / obstacles: 建物の輪郭の配列 / paths: 道の配列(点列) */
function parkLayout(site, fixed, free, zones, obstacles, paths, seed, bias) {
  const rng = mulberry(seed || 1);
  const sb = bboxOf(site), cx0 = (sb[0] + sb[2]) / 2, cy0 = (sb[1] + sb[3]) / 2, sw = sb[2] - sb[0], sh = sb[3] - sb[1];
  /* 空間の索引（20mの格子）*/
  const CELL = 20, grid = new Map();
  const gk = (i, j) => i * 100003 + j;
  const put = (x0, y0, x1, y1, ref) => { for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) { const k = gk(i, j); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(ref); } };
  const near = (x0, y0, x1, y1) => { const s = new Set(); for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) { const a = grid.get(gk(i, j)); if (a) for (const r of a) s.add(r); } return s; };
  for (const ring of obstacles || []) { const b = bboxOf(ring); put(b[0], b[1], b[2], b[3], { b, ring }); }
  const circ = (x, y, w, d, rot) => { const r = Math.hypot(w, d) / 2; return { x, y, r, w, d, rot }; };
  for (const f of fixed || []) { const r = Math.hypot(f.w, f.d) / 2; put(f.x - r, f.y - r, f.x + r, f.y + r, { b: [f.x - r, f.y - r, f.x + r, f.y + r], c: circ(f.x, f.y, f.w, f.d, f.rot) }); }
  const segs = []; for (const p of paths || []) for (let i = 0; i + 1 < p.length; i++) segs.push([p[i], p[i + 1]]);
  const pathGrid = new Map(); segs.forEach((s, k) => { const b = [Math.min(s[0][0], s[1][0]), Math.min(s[0][1], s[1][1]), Math.max(s[0][0], s[1][0]), Math.max(s[0][1], s[1][1])]; for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) { const kk = gk(i, j); let a = pathGrid.get(kk); if (!a) pathGrid.set(kk, a = []); a.push(k); } });
  const nearestPath = (x, y) => {
    let best = null, bd = 1e9;
    for (let i = Math.floor((x - 40) / CELL); i <= Math.floor((x + 40) / CELL); i++) for (let j = Math.floor((y - 40) / CELL); j <= Math.floor((y + 40) / CELL); j++) { const a = pathGrid.get(gk(i, j)); if (!a) continue; for (const k of a) { const [A, B] = segs[k], dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy || 1, t = clamp(((x - A[0]) * dx + (y - A[1]) * dy) / l2, 0, 1), px = A[0] + t * dx, py = A[1] + t * dy, d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = Math.atan2(dy, dx); } } }
    return { d: bd, ang: best };
  };
  /* 置いた長方形が、既存のものと重なっていないか（円の近似＋建物は輪郭の内外）*/
  const clash = (x, y, w, d) => {
    const r = Math.hypot(w, d) / 2; let pen = 0;
    for (const o of near(x - r, y - r, x + r, y + r)) {
      if (o.c) { const dd = Math.hypot(o.c.x - x, o.c.y - y), lim = (o.c.r + r) * 0.82; if (dd < lim) pen += 3 + (lim - dd) / lim * 4; }
      else if (o.ring) { if (x > o.b[0] - w / 2 && x < o.b[2] + w / 2 && y > o.b[1] - d / 2 && y < o.b[3] + d / 2) { if (inPoly(x, y, o.ring) || inPoly(x - w / 2, y - d / 2, o.ring) || inPoly(x + w / 2, y + d / 2, o.ring) || inPoly(x - w / 2, y + d / 2, o.ring) || inPoly(x + w / 2, y - d / 2, o.ring)) pen += 5; } }
    }
    return pen;
  };
  /* エリアの中心（なければ向きのヒントから、それもなければ外側へ）*/
  const nz = zones.length, zinfo = new Map();
  zones.forEach((z, k) => {
    let s = z.seed;
    if (!s && z.hint) s = [cx0 + z.hint[0] * sw * 0.3, cy0 + z.hint[1] * sh * 0.3];
    if (!s) { const a = (k / Math.max(1, nz)) * Math.PI * 2 + 0.4; s = [cx0 + Math.cos(a) * sw * 0.28, cy0 + Math.sin(a) * sh * 0.28]; }
    if (!inPoly(s[0], s[1], site)) { /* 輪郭の外なら、中心の方へ引きもどす */ for (let t = 1; t > 0 && !inPoly(s[0], s[1], site); t -= 0.1) s = [cx0 + (s[0] - cx0) * t, cy0 + (s[1] - cy0) * t]; }
    zinfo.set(z.id, { seed: s, poly: null });
  });
  const seeds = zones.map(z => zinfo.get(z.id).seed);
  const polys = nz > 1 ? voronoiZones(site, seeds) : [site.map(q => [q[0], q[1]])];
  zones.forEach((z, k) => { zinfo.get(z.id).poly = polys[k] || site; });
  /* 置く順番：大きいものから */
  const order = free.map((p, i) => i).sort((a, b) => { const sa = shapeOf(free[a]), sb2 = shapeOf(free[b]); return sb2[0] * sb2[1] - sa[0] * sa[1]; });
  const res = new Array(free.length);
  for (const i of order) {
    const p = free[i], [w, d] = shapeOf(p);
    const zi = zinfo.get(p.z) || null, poly = (zi && zi.poly) || site, zb = bboxOf(poly);
    const seedPt = zi ? zi.seed : [cx0, cy0];
    const hint = parsePos(p.pos);
    let best = null, bs = -1e9;
    for (let k = 0; k < 70; k++) {
      let x = zb[0] + rng() * (zb[2] - zb[0]), y = zb[1] + rng() * (zb[3] - zb[1]);
      if (!inPoly(x, y, poly)) { if (k < 69) continue; x = seedPt[0] + (rng() - 0.5) * 40; y = seedPt[1] + (rng() - 0.5) * 40; }
      if (!inPoly(x, y, site)) continue;
      const np = nearestPath(x, y);
      let sc = -clash(x, y, w, d) * 10 - Math.hypot(x - seedPt[0], y - seedPt[1]) * 0.012;
      if (isFinite(np.d)) sc -= Math.abs(np.d - (w + d) / 4 - 6) * 0.05; else sc -= 0;
      if (hint) sc += ((x - cx0) * hint[0] + (y - cy0) * hint[1]) / Math.max(sw, sh) * 1.4;
      if (bias) sc += bias(p, x, y);
      sc += rng() * 0.3;
      if (sc > bs) { bs = sc; best = { x, y, ang: np.ang }; }
    }
    if (!best) best = { x: seedPt[0] + (rng() - 0.5) * 30, y: seedPt[1] + (rng() - 0.5) * 30, ang: null };
    let rot = best.ang != null && isFinite(best.ang) ? best.ang : 0;
    rot = ((rot % Math.PI) + Math.PI) % Math.PI; if (rot > Math.PI / 2) rot -= Math.PI;
    if (p.c === 'wc' || p.c === 'facility') rot = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
    res[i] = { x: r1(best.x), y: r1(best.y), w, d, rot: r2(rot) };
    const r = Math.hypot(w, d) / 2; put(best.x - r, best.y - r, best.x + r, best.y + r, { b: [best.x - r, best.y - r, best.x + r, best.y + r], c: circ(best.x, best.y, w, d, rot) });
  }
  return { placed: res, zonePolys: zones.map(z => zinfo.get(z.id).poly), seeds: zones.map(z => zinfo.get(z.id).seed) };
}
