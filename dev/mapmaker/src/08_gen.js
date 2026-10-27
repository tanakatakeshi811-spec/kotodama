
/* ---------- マップを作る：場所をさがす → 敷地と周りの地図 → AIが店・施設を調べる → 配置 → 保存 ----------
   ・位置・建物・道・水・緑・名前のある場所 … OpenStreetMap（実測）
   ・店・アトラクションの一覧、階、営業時間 … AI（ネット検索ができるときは公式の情報を調べる）
   ・建物の中の店の「並び」は、AIの情報から作る見取り図（目安）。屋外でOpenStreetMapに位置がある物は実際の位置。 */

/* ---- AIの返事から JSON を取り出す（途中で切れていても、できあがっている分は使う）---- */
function jsonSrc(t) {
  t = String(t || '').replace(/<\/?(thinking|review|plan|draft)>/g, '');
  const m = t.match(/```(?:json|JSON)?[ \t]*\r?\n?([\s\S]*?)(?:```|$)/);
  return m && /[\[{]/.test(m[1]) ? m[1] : t;
}
function scanTop(s, from, stopAtBracket) {
  const out = []; let depth = 0, inS = false, esc2 = false, st = -1;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (inS) { if (esc2) esc2 = false; else if (ch === '\\') esc2 = true; else if (ch === '"') inS = false; continue; }
    if (ch === '"') { inS = true; continue; }
    if (ch === '{') { if (!depth) st = i; depth++; }
    else if (ch === '}') { if (depth && --depth === 0 && st >= 0) { out.push(s.slice(st, i + 1)); st = -1; } }
    else if (ch === ']' && !depth && stopAtBracket) break;
  }
  return out;
}
const tryParse = s => { try { return JSON.parse(s); } catch (e) { try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')); } catch (e2) { return null; } } };
function parseObject(t) { const s = jsonSrc(t), i = s.indexOf('{'); if (i < 0) return null; const a = scanTop(s, i, false); return a.length ? tryParse(a[0]) : null; }
function parseList(t) {
  const s = jsonSrc(t), j = s.indexOf('{'), k = s.indexOf('[');
  const from = k >= 0 && (j < 0 || k < j || /^\{\s*"[^"]+"\s*:\s*\[/.test(s.slice(j, j + 80))) ? k + 1 : Math.max(0, j);
  const out = []; for (const x of scanTop(s, from, true)) { const o = tryParse(x); if (o && typeof o === 'object') out.push(o); }
  return out;
}
/* 配列が最後まで書かれていたか（途中で切れていないか） */
const listClosed = t => { const s = jsonSrc(t).trimEnd(); return /\]\s*(`+)?$/.test(s) || /^\s*\[\s*\]/.test(s); };

/* ---- AIにたずねる（ネット検索つき・やめられる）---- */
async function mmAI(system, user, { signal, onText, search } = {}) {
  if (T.ai) return T.ai(system, user, { search: !!search, signal });
  if (!engineReady()) throw { code: 'no_engine' };
  const model = SET.model, useSearch = !!search && canWeb();
  if (Engine.kind === 'api') {
    const r = await callApi({ conv: { system, msgs: [{ role: 'user', text: user, m: null }], imgs: [], native: new Set() }, model, effort: 'medium', think: false, signal, onText, search: useSearch, maxTokens: 20000 });
    return r.text || '';
  }
  const r = await callSample({ turns: [{ role: 'user', content: system + '\n\n' + user }], images: [], model, effort: 'medium', signal, onText, search: useSearch });
  return stripTags(r.text || '');
}
const aiAvail = () => !!T.ai || (typeof engineReady === 'function' && engineReady());
const aiCanSearch = () => !!T.ai || (typeof canWeb === 'function' && canWeb());
async function mmAIRetry(system, user, o) {
  let last = null;
  for (let i = 0; i < 3; i++) {
    try { return await mmAI(system, user, o); }
    catch (e) {
      last = e; const c = e && e.code;
      if (c === 'cancelled' || (o && o.signal && o.signal.aborted)) throw { code: 'cancelled' };
      if (!(c === 'rate_limited' || c === 'api_overloaded' || c === 'network' || c === 'upstream_error' || c === 'relay_error')) throw e;
      await sleep(4000 + i * 9000);
    }
  }
  throw last;
}

/* ---- AIの返事（1件）→ スポット ---- */
function normPoi(o, force) {
  if (!o || typeof o !== 'object') return null;
  const n = String(o.n != null ? o.n : (o.name != null ? o.name : '')).replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!n || /^(不明|なし|未定|—|－|-)$/.test(n)) return null;
  const ds = String(o.ds != null ? o.ds : (o.d != null ? o.d : '')).trim();
  const p = { n, c: CATS[o.c] ? o.c : guessCat(n + ' ' + ds) };
  if (ds) p.ds = ds.slice(0, 120);
  const hrs = String(o.hrs != null ? o.hrs : (o.h != null ? o.h : '')).trim(); if (hrs) p.hrs = hrs.slice(0, 80);
  if (o.pos) p.pos = String(o.pos).trim().slice(0, 80);
  if (o.url) p.url = String(o.url).slice(0, 200);
  if (o.tel) p.tel = String(o.tel).slice(0, 40);
  const w = parseFloat(o.w); if (isFinite(w) && w > 0) p.w = clamp(w, 0.4, 10);
  if (o.out === true || o.out === 1 || o.out === 'true') p.out = true;
  if (o.f != null && o.f !== '') p.f = String(o.f);
  if (o.z != null && o.z !== '') p.z = String(o.z);
  return Object.assign(p, force || {});
}
const poiKey = p => nameKey(p.n) + '|' + (p.f || p.z || (p.out ? 'o' : ''));

/* ---- 調べる単位（階ごと・エリアごと・建物の外）---- */
function planChunks(kind, d, name) {
  const ch = [];
  const bl = (d.buildings || []).filter(b => b && (b.n || (b.fl && b.fl.length)));
  const zs = (d.zones || []).filter(z => z && z.n);
  const nb = bl.length;
  if (kind === 'store') {
    ch.push({ id: 'in', t: 'store', label: '店内の売り場・部門・設備（レジ・フードコート・会員カウンターなど）', b: 'b1', f: '1F', expect: 18 });
  } else if (kind !== 'park' && nb) {
    bl.forEach((b, bi) => {
      const fl = (b.fl || []).map(normFloor).filter(Boolean); const fls = fl.length ? fl : ['1F'];
      for (const f of fls) ch.push({ id: 'b' + (bi + 1) + '|' + f, t: 'floor', label: `${b.n ? b.n + ' ' : ''}${floorLabel(f)}`, bn: b.n || '', b: 'b' + (bi + 1), f, expect: f === '1F' || /B1/.test(f) ? 30 : 24 });
    });
  }
  if (zs.length) for (const z of zs) ch.push({ id: 'z|' + z.id, t: 'zone', label: z.n, z: z.id, pos: z.pos || '', expect: 26 });
  if (!ch.length) ch.push({ id: 'all', t: 'all', label: `${name}の中`, expect: 30 });
  ch.push({ id: 'out', t: 'out', label: kind === 'park' ? '園内の出入口・駅・駐車場・乗り場・トイレや案内所などの共通施設' : '建物の外（出入口・駐車場・駐輪場・バス乗り場・タクシー乗り場・屋外広場など）', expect: 14 });
  return ch.slice(0, 22);
}
const CAT_HELP = 'ride（アトラクション・乗り物） play（ゲーム・体験・スポーツ） show（ショー・劇場・映画館・パレード） food（食事） cafe（カフェ・スイーツ・パン） shop（専門店・お土産） fashion（服・靴・バッグ・コスメ） goods（雑貨・本・家電・生活用品） grocery（食品・スーパー） service（銀行・美容院・病院・携帯などのサービス） facility（案内所・エレベーター・授乳室・広場） wc（トイレ） gate（出入口） parking（駐車場・駐輪場・バス乗り場）';
const SYS_ALL = 'あなたは、実在する施設の館内図・園内マップをつくるための調査員です。\nネット検索が使えるときは、公式サイトのフロアガイド・パークマップ・店舗一覧などを必ず調べてから答えてください。検索できないときは、確かな知識だけで答え、わからないことは空にします。もっともらしい作り話はしません。\n出力は、指定されたJSONだけ（前置き・説明・コードブロックは書かない）。';
function chunkPrompt(name, ch, hints, more) {
  const L = [`「${name}」の「${ch.label}」にある、お店・アトラクション・施設を、見つかるかぎり全部、1つずつ書いてください（目安：${ch.expect}件前後。多ければもっと）。`];
  if (ch.t === 'out') L.push('建物の中にあるものは書かず、建物の外・敷地の中のものだけを書いてください。必ず "out":true を付けます。');
  else if (ch.t === 'zone') L.push(`このエリアの中にある、アトラクション・ショー・レストラン・ショップ・トイレなどを書いてください。エリアのどのへんか（北・南東・奥・入口近く など）を pos に書くと、地図に置きやすくなります。${ch.pos ? `（このエリアは敷地の${ch.pos}あたり）` : ''}`);
  else if (ch.t === 'floor') L.push(`この階の中での位置（北・南東・フードコートの隣・エスカレーター前 など）がわかるときは pos に書いてください。トイレ・案内所・エレベーター・授乳室・ATMも1つずつ入れます。`);
  else if (ch.t === 'store') L.push('商品ひとつひとつではなく、売り場・部門・コーナー・設備（精肉、生鮮、ベーカリー、フードコート、タイヤセンター、会員カウンター、レジ、ガソリンスタンドなど）を書いてください。入口から見た位置を pos に書いてください。');
  else L.push('どの階（f：B1、1F、2F…）や、どのエリアかがわかるときは f や pos に書いてください。建物の外のものは "out":true にします。');
  if (hints && hints.length) L.push(`参考：OpenStreetMapには、次の名前が載っています（古い・まちがいもあります。実際に合うものだけ使い、載っていない店も書いてください）。\n${hints.join('、')}`);
  if (more && more.length) L.push(`すでに書いた分：${more.join('、')}\nこれ以外で、まだ載せていないものがあれば、続きを書いてください。もうなければ [] だけを出力します。`);
  L.push('決まり：', '・実在して、いま営業しているものだけ。確信がないものは書かない。名前は正式な表記で。', '・出力は JSON の配列だけ。', `・1件の形：{"n":"名前","c":"種類","ds":"ひとこと説明（30字くらいまで）","hrs":"営業時間（わかれば）","pos":"位置のヒント（わかれば）","w":広さ,"out":true（建物の外のときだけ）}`, `・c は次のどれか：${CAT_HELP}`, '・w は広さの目安：1=小さな店、2=ふつう、4=大きな店、6=とても大きい（フードコート・映画館・大型専門店・大型アトラクション）。', ch.t === 'floor' || ch.t === 'store' ? '・書く順番は、入口やエスカレーターから見て、同じ通路ぞいに近いものが続くように。' : '・書く順番は、近くにあるものが続くように。');
  return L.join('\n');
}
function dossierPrompt(q, cand, kind) {
  return [`場所：「${q}」`,
    cand ? `OpenStreetMapの検索結果：${cand.name}（${cand.label || ''}）、種類の推定：${(KINDS[kind] || KINDS.other).n}、座標 ${cand.lat.toFixed(5)}, ${cand.lon.toFixed(5)}` : '',
    '', 'この場所について、次のJSONを1つだけ出力してください。', '{',
    ' "name": "正式な名称",',
    ' "kind": "mall | park | store | station | campus | other のどれか（mall=ショッピングモール・商業施設・百貨店、park=遊園地・テーマパーク・動物園・公園など屋外が中心、store=コストコ・スーパー・ホームセンターなど1つの大型店、station=駅・空港、campus=学校・病院・大きな施設）",',
    ' "addr": "住所",', ' "sum": "どんな場所か。2〜3文",', ' "hours": "営業時間・休業日（わかる範囲）",', ' "access": "行き方（最寄り駅・車・駐車場）をひとこと",', ' "web": "公式サイトのURL（わかれば）",',
    ' "lat": 緯度の数値（わかれば）, "lon": 経度の数値（わかれば）,',
    ' "buildings": [ {"id":"b1","n":"建物・館の名前","fl":["B1","1F","2F","3F"]} ],',
    ' "zones": [ {"id":"z1","n":"エリアの名前","pos":"敷地の中での向き（北・南東・中央など）"} ],',
    ' "tips": ["行く前に知っておくとよいこと（短く、3つまで）"],', ' "notes": "調べきれなかったこと・不確かなこと"', '}',
    '決まり：',
    '・buildings は、屋内に階がある場所（モール・百貨店・駅ビルなど）で、館や棟ごとに書く。階は 地下が B1・B2、地上が 1F・2F…、屋上が RF。建物が1つなら1件。階がわからなければ fl は空。遊園地・テーマパークのような屋外が中心の場所と、1つの大型店（kind が store）は [] にする。',
    '・zones は、遊園地・テーマパーク・動物園などのエリア（ランド、ワールド、ゾーンなど）。モールで「〇〇ゾーン」のような公式のエリア分けがあるときだけ書いてもよい。なければ []。',
    '・id は b1,b2… / z1,z2… と通し番号にする。'].filter(x => x !== '').join('\n');
}

/* ---- 場所さがし（候補を出す）---- */
async function searchPlaces(q, signal) {
  q = String(q || '').trim(); if (!q) return [];
  const bias = typeof Geo !== 'undefined' && Geo.on && Geo.ok ? Geo.here() : null;
  let r = await OSMX.search(q, bias, signal);
  if (!r.length) { const q2 = q.replace(/[（(].*?[）)]/g, '').replace(/\s+/g, ' ').trim(); if (q2 && q2 !== q) r = await OSMX.search(q2, bias, signal); }
  return r;
}

/* ---- 敷地のかたち・周りの範囲 ---- */
const R0 = { mall: 240, park: 600, store: 220, station: 300, campus: 400, other: 240 };
async function geometry(cand, kind, signal) {
  let o = { lat: cand.lat, lon: cand.lon }, site = null, area = 0, real = false;
  const out = await OSMX.outline(cand, signal);
  if (out && out.length) {
    const xy = out.map(r => r.map(g => llToXY(o, g.lat, g.lon)));
    let bi = 0, ba = -1; xy.forEach((r, i) => { const a = Math.abs(polyArea(r)); if (a > ba) { ba = a; bi = i; } });
    if (ba > 40) { const c = polyCentroid(xy[bi]); o = xyToLL(o, c[0], c[1]); site = ccw(dp(xy[bi].map(q => [q[0] - c[0], q[1] - c[1]]), 1.2)); area = ba; real = true; }
  }
  if (!site && cand.bbox) {
    const [s, n, w, e] = cand.bbox, a = llToXY(o, s, w), b = llToXY(o, n, e), W = Math.abs(b[0] - a[0]), H = Math.abs(b[1] - a[1]);
    if (Math.max(W, H) > 60 && Math.max(W, H) < 6000) { const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2; o = xyToLL(o, cx, cy); site = rectPoly(0, 0, W, H, 0); area = W * H; }
  }
  let ext;
  if (site) { const bb = bboxOf(site), m = kind === 'park' || kind === 'campus' ? 110 : 150; ext = [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m]; }
  else { const R = R0[kind] || 240; ext = [-R, -R * 0.8, R, R * 0.8]; }
  const cl = (a, c) => { if (a[2] - a[0] > 5200) { const m = (a[0] + a[2]) / 2; a[0] = m - 2600; a[2] = m + 2600; } if (a[3] - a[1] > 5200) { const m = (a[1] + a[3]) / 2; a[1] = m - 2600; a[3] = m + 2600; } return a; };
  ext = cl(ext);
  const fine = site ? (() => { const bb = bboxOf(site); return cl([bb[0] - 40, bb[1] - 40, bb[2] + 40, bb[3] + 40]); })() : ext;
  return { o, site, area, real, ext, fine };
}
const llBox = (o, b) => { const sw = xyToLL(o, b[0], b[1]), ne = xyToLL(o, b[2], b[3]); return [sw.lat, sw.lon, ne.lat, ne.lon]; };

/* ---- OSMの階（level）→ 1F/B1 ---- */
function levelMapper(feats) {
  const vs = feats.map(f => f.lv).filter(v => v != null); const zero = vs.some(v => v === 0);
  return lv => (lv == null ? '' : lv < 0 ? 'B' + (-lv) : zero ? (lv + 1) + 'F' : (lv >= 1 ? lv : 1) + 'F');
}

/* ---- 建物にする（OSMのかたちを使う）---- */
function pickOsmBuildings(kind, geo, ctx, cand, need) {
  const site = geo.site;
  const bs = ctx.b.map((b, i) => ({ i, p: b.p, n: b.n || '', a: Math.abs(polyArea(b.p)), c: polyCentroid(b.p) }));
  const res = { rings: [], drop: new Set(), siteOut: null };
  if (!site) return res;
  const inside = bs.filter(x => inPoly(x.c[0], x.c[1], site) && x.a >= 250).sort((a, b) => b.a - a.a);
  const siteA = Math.abs(polyArea(site));
  const asBuilding = cand.cls === 'building' || (siteA <= 70000 && (!inside.length || inside.length === 1 || inside[0].a / siteA > 0.45) && !/^(park|garden|theme_park|zoo|aquarium)$/.test(cand.type));
  if (asBuilding) {
    res.rings.push({ p: site, n: cand.name }); res.siteOut = expandRect(site, 48);
    for (const x of bs) if (inPoly(x.c[0], x.c[1], site) && x.a >= siteA * 0.25) res.drop.add(x.i);
    return res;
  }
  const maxA = inside.length ? inside[0].a : 0;
  const pick = inside.filter(x => x.a >= Math.max(400, maxA * 0.1)).slice(0, Math.max(1, need));
  for (const x of pick) { res.rings.push({ p: x.p, n: x.n }); res.drop.add(x.i); }
  return res;
}

/* ---- 組み立て ---- */
function composePlan(I) {
  const { cand, geo, ctx, named, dossier: d, ai } = I; let kind = I.kind;
  const bl = [];
  let site = geo.site, bResult = { rings: [], drop: new Set(), siteOut: null };
  const dB = (d.buildings || []).filter(b => b && (b.n || (b.fl && b.fl.length))).map((b, i) => ({ id: 'b' + (i + 1), n: b.n || '', fl: (b.fl || []).map(normFloor).filter(Boolean) }));
  const indoorKind = kind === 'mall' || kind === 'store' || dB.length > 0;
  if (kind !== 'park' && indoorKind) {
    const need = kind === 'store' ? 1 : Math.max(1, dB.length);
    bResult = pickOsmBuildings(kind, geo, ctx, cand, need);
    for (let i = 0; i < need; i++) { const r = bResult.rings[i]; bl.push({ id: 'b' + (i + 1), n: (dB[i] && dB[i].n) || (r && r.n) || (need > 1 ? '建物' + (i + 1) : (kind === 'store' ? '' : '本館')), ring: r ? r.p : null, fl: dB[i] ? dB[i].fl : [] }); }
    if (bResult.siteOut) site = bResult.siteOut;
    ctx.b = ctx.b.filter((_, i) => !bResult.drop.has(i));
  }
  /* --- スポット：AIの一覧 ＋ OpenStreetMapにあるもの --- */
  const regionPoly = site ? (kind === 'mall' || kind === 'store' ? expandRect(site, 90) : site) : null;
  const inRegion = f => !regionPoly || inPoly(f.x, f.y, regionPoly) || (bl.some(b => b.ring && inPoly(f.x, f.y, b.ring)));
  const feats = (named || []).filter(inRegion);
  const lvF = levelMapper(feats);
  const pois = ai.map(p => Object.assign({}, p)), used = new Set();
  const inBuilding = f => { for (const b of bl) if (b.ring && inPoly(f.x, f.y, b.ring)) return b; return null; };
  const feKeys = feats.map(f => [f.n, ...(f.alt || [])].map(nameKey).filter(Boolean));
  let nBoth = 0;
  for (const p of pois) {
    const ka = nameKey(p.n); if (!ka || ka.length < 2) continue;
    let best = -1, bs2 = 0;
    for (let i = 0; i < feats.length; i++) {
      if (used.has(i)) continue; let s = 0; for (const k of feKeys[i]) s = Math.max(s, nameSim(ka, k));
      if (feats[i].lv != null && p.f && lvF(feats[i].lv) && lvF(feats[i].lv) !== normFloor(p.f)) s -= 0.12;
      if (s > bs2) { bs2 = s; best = i; }
    }
    if (best >= 0 && bs2 >= 0.8) {
      const f = feats[best]; used.add(best); nBoth++;
      p.osm = { x: f.x, y: f.y, ring: f.ring || null, area: f.area || 0 }; p.src = 'osm+ai';
      if (!p.hrs && f.hrs) p.hrs = f.hrs.slice(0, 80); if (!p.url && f.web) p.url = f.web.slice(0, 200); if (!p.tel && f.tel) p.tel = f.tel.slice(0, 40);
    } else p.src = 'ai';
  }
  let nOsm = 0; const cap = kind === 'park' || kind === 'campus' ? 420 : 320;
  const seenKey = new Set(pois.map(poiKey));
  const KEEP_BLD = /^(park|campus|other|station)$/.test(kind);
  const selfKeys = [d.name, cand.name].filter(Boolean).map(nameKey).filter(k => k && k.length >= 2);
  feats.forEach((f, i) => {
    if (used.has(i) || nOsm >= cap) return;
    if (f.cat === 'other' || !f.n) return;
    if ((kind === 'mall' && f.ty === 'mall') || ((kind === 'mall' || kind === 'store') && selfKeys.some(k => nameSim(nameKey(f.n), k) >= 0.9))) return; /* 館そのもの・棟は、お店ではない */
    if (kind === 'mall' && f.bldg && f.ty === 'retail' && f.area >= 300) return; /* 「北館」「南館」のように、お店の印(shop・amenity等)がなく建物の名前だけの大きなもの(棟)は、お店ではない */
    if (f.bldg && f.cat === 'facility' && (!KEEP_BLD || f.area < 200)) return;
    if (f.cat === 'parking' && f.area && f.area < 60) return;
    const b = inBuilding(f); const p = { n: f.n, c: f.cat, src: 'osm' };
    if (f.hrs) p.hrs = f.hrs.slice(0, 80); if (f.web) p.url = f.web.slice(0, 200); if (f.tel) p.tel = f.tel.slice(0, 40);
    if (b) { p.b = b.id; p.f = f.lv != null ? lvF(f.lv) || '1F' : '1F'; } else { p.out = true; p.osm = { x: f.x, y: f.y, ring: f.ring || null, area: f.area || 0 }; }
    const k = poiKey(p); if (seenKey.has(k)) return; seenKey.add(k); pois.push(p); nOsm++;
  });
  /* --- 仕上げ --- */
  const zones = (d.zones || []).filter(z => z && z.n).map((z, i) => ({ id: 'z' + (i + 1), n: z.n, pos: z.pos || '' }));
  const dz = new Map((d.zones || []).filter(z => z && z.n).map((z, i) => [z.id || 'z' + (i + 1), 'z' + (i + 1)]));
  for (const p of pois) if (p.z) p.z = dz.get(p.z) || p.z;
  return {
    plan: { id: I.id, name: d.name || cand.name, kind, addr: d.addr || cand.label || '', ll: geo.o, created: I.created, site, bldgs: bl, floors: [], zones, pois, ctx },
    stat: { both: nBoth, osm: nOsm, ai: pois.filter(p => p.src === 'ai').length, total: pois.length },
  };
}

/* ---- サムネイル ---- */
IconImg.warm = function () {
  return new Promise(res => {
    const names = [...new Set(Object.values(CATS).map(c => c.ic))], prev = IconImg.onload; let done = false;
    const fin = () => { if (done) return; done = true; IconImg.onload = prev; res(); };
    const check = () => { if (names.every(n => { const e = IconImg.cache.get(n + '|#ffffff'); return e && e.ok; })) fin(); };
    IconImg.onload = () => { prev && prev(); check(); };
    for (const n of names) IconImg.get(n, '#ffffff');
    setTimeout(fin, 1000); check();
  });
};
async function makeThumb(map, o = {}) {
  await IconImg.warm();
  const R = prepare(map), W = 440, H = 270, is3 = o.mode3d !== false && (R.stack || (map.kind === 'park' || (map.bldgs || []).length > 0));
  const h = is3 ? -0.55 : 0, el3 = R.stack ? STACK_EL : 0.92, f = fitCam(map, W, H, h, el3, is3, 1.04), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const gf = R.floors[R.ground];
  drawScene(cv.getContext('2d'), { map, R, W, H, dpr: 1, cam: { cx: f.cx, cy: f.cy, s: f.s, h, el3, t3: is3 ? 1 : 0 }, floor: gf ? gf.id : '', sel: null, hits: null, filter: 'all', gps: null, route: null, dark: !!o.dark, accent: '#1C7A62', labels: false, hud: false, out: null, ox: 0, oy: 0 });
  return cv.toDataURL('image/jpeg', 0.74);
}

/* ---- 全体の流れ ---- */
const Gen = {
  start(opts, prog) {
    const job = { ctl: new AbortController(), finish: false, partial: new Map(), cancelled: false };
    job.cancel = () => { job.cancelled = true; job.ctl.abort(); };
    job.finishNow = () => { job.finish = true; job.ctl.abort(); };
    job.promise = Gen.run(opts, prog || (() => {}), job);
    return job;
  },
  async run(opts, prog, job) {
    const signal = job.ctl.signal, cand = opts.cand, say = (step, msg, extra) => prog(Object.assign({ step, msg }, extra || {}));
    const id = opts.id || uid('m'), created = opts.created || Date.now();
    const useAI = opts.ai !== false && aiAvail(), useSearch = !!opts.search && aiCanSearch();
    let kind = opts.kind || cand.kind || 'other', notes = [], failed = 0;
    /* 1) 敷地と周りの地図 ＋ 2) AIの下調べ（同時に）*/
    say('osm', '敷地のかたちを調べています');
    const geoP = (async () => {
      const geo = await geometry(cand, kind, signal);
      let ctx = { b: [], r: [], w: [], wl: [], g: [], k: [] }, named = [];
      say('osm', '周りの建物・道路・名前のある場所を取り込んでいます');
      const big = kind === 'park' || kind === 'campus', lim = big ? { b: 1500, r: 2600, g: 260, k: 260 } : undefined;
      /* 公開サーバーに同時に2本は聞かない（混んでいると断られる）。重い問い合わせ(建物・道路)→軽い問い合わせ(名前のある場所)の順に。後のほうは、いま答えたサーバーから聞く */
      const [c] = await Promise.allSettled([OSMX.overpass(OSMX.ctxQuery(llBox(geo.o, geo.ext), llBox(geo.o, geo.fine)), 45000, signal, { kind: 'ctx' })]);
      if (c.status === 'fulfilled') ctx = parseCtx(c.value.elements, geo.o, lim); else if (c.reason && c.reason.code === 'cancelled') throw c.reason; else notes.push('周りの建物・道路のデータを取得できませんでした');
      say('osm', '名前のある場所（お店・施設）を取り込んでいます');
      const [n] = await Promise.allSettled([OSMX.overpass(OSMX.namedQuery(llBox(geo.o, geo.fine)), 40000, signal, { kind: 'named', first: c.status === 'fulfilled' ? OSMX._good.ctx : undefined, hedge: 8000 })]);
      if (n.status === 'fulfilled') named = parseNamed(n.value.elements, geo.o); else if (n.reason && n.reason.code === 'cancelled') throw n.reason;
      return { geo, ctx, named };
    })();
    const dosP = (async () => {
      if (!useAI) return null;
      say('ai', useSearch ? 'ネットで公式の情報を調べています' : 'AIが場所について調べています');
      try {
        const t = await mmAIRetry(SYS_ALL, dossierPrompt(opts.query || cand.name, cand, kind), { signal, search: useSearch });
        return parseObject(t);
      } catch (e) { if (e && e.code === 'cancelled') throw e; notes.push('AIの下調べに失敗しました'); return null; }
    })();
    let geoR, dossier;
    try { [geoR, dossier] = await Promise.all([geoP, dosP]); }
    catch (e) { if (job.cancelled) throw { code: 'cancelled' }; throw e; }
    const dos = dossier && typeof dossier === 'object' ? dossier : {};
    if (!opts.kind && dos.kind && KINDS[dos.kind]) kind = dos.kind;
    if (!Array.isArray(dos.buildings)) dos.buildings = []; if (!Array.isArray(dos.zones)) dos.zones = [];
    /* 3) 店・アトラクションを1つずつ調べる */
    const ai = []; const seen = new Set();
    const addAI = (list, force) => { let n = 0; for (const o of list) { const p = normPoi(o, force); if (!p) continue; const k = poiKey(p); if (seen.has(k)) continue; seen.add(k); ai.push(p); n++; } return n; };
    if (useAI) {
      const chunks = planChunks(kind, dos, dos.name || cand.name), hintsFor = ch => {
        const named = geoR.named; if (!named.length) return [];
        const lvF = levelMapper(named);
        let f = named.filter(x => x.cat !== 'other' && !(x.bldg && x.cat === 'facility'));
        if (ch.t === 'floor') { const known = f.filter(x => x.lv != null); if (known.length >= 5) f = known.filter(x => lvF(x.lv) === ch.f); }
        else if (ch.t === 'zone') f = f.filter(x => /^(ride|show|play)$/.test(x.cat));
        else if (ch.t === 'out') f = f.filter(x => /^(parking|gate)$/.test(x.cat));
        return [...new Set(f.map(x => x.n))].slice(0, ch.t === 'zone' ? 70 : 50);
      };
      let doneN = 0; const total = chunks.length; const deep = opts.deep !== false;
      say('list', `${total}か所に分けて、店・施設を調べます`, { done: 0, total, found: 0 });
      const forceOf = ch => (ch.t === 'floor' ? { f: ch.f, b: ch.b } : ch.t === 'zone' ? { z: ch.z } : ch.t === 'out' ? { out: true } : ch.t === 'store' ? { f: '1F', b: 'b1' } : {});
      const runChunk = async ch => {
        if (job.finish || job.cancelled) return;
        const sys = SYS_ALL, name = dos.name || cand.name, hints = hintsFor(ch);
        let text = '', all = [];
        try {
          let mine = [];
          for (let pass = 0; pass < (deep ? 3 : 2); pass++) {
            if (job.finish || job.cancelled) break;
            const names = mine.map(x => x.n).slice(0, 80);
            let cur = '';
            const t = await mmAIRetry(sys, chunkPrompt(name, ch, pass ? [] : hints, pass ? names : null), { signal, search: useSearch, onText: x => { cur = x; job.partial.set(ch.id + '#' + pass, x); } });
            text = t; job.partial.delete(ch.id + '#' + pass);
            const got = parseList(t); const before = mine.length; const seenN = new Set(mine.map(x => nameKey(x.n)));
            for (const o of got) { const k = nameKey(o && (o.n || o.name)); if (k && !seenN.has(k)) { seenN.add(k); mine.push(o); } }
            const closed = listClosed(t), gained = mine.length - before;
            if (pass === 0 && (closed ? (!deep && mine.length < 28) : false)) break;   /* 1回で書ききったら（ふつう）ここまで */
            if (pass >= 1 && gained < 2) break;
            if (pass === 0 && closed && mine.length < 8) break;
          }
          all = mine;
        } catch (e) {
          if (e && e.code === 'cancelled') { /* やめた・ここまでで作る → 書きかけも使う */ for (const [k, t] of [...job.partial]) if (k.startsWith(ch.id + '#')) { all = all.concat(parseList(t)); job.partial.delete(k); } }
          else { failed++; notes.push(`「${ch.label}」を調べられませんでした`); }
        }
        const n = addAI(all, forceOf(ch)); doneN++;
        say('list', `${ch.label}：${n}件`, { done: doneN, total, found: ai.length, latest: all.slice(0, 6).map(x => x && (x.n || x.name)).filter(Boolean) });
      };
      const conc = Engine.relay ? 3 : 3; let qi = 0;
      await Promise.all(Array.from({ length: Math.min(conc, chunks.length) }, async () => { while (qi < chunks.length && !job.finish && !job.cancelled) await runChunk(chunks[qi++]); }));
      if (job.cancelled) throw { code: 'cancelled' };
      if (!ai.length && !failed) notes.push('AIから店・施設の一覧が得られませんでした');
    }
    if (job.cancelled) throw { code: 'cancelled' };
    /* 4) 位置を決めて組み立てる */
    say('build', '店やアトラクションの位置を決めています');
    await sleep(30);
    const { plan, stat } = composePlan({ id, created, cand, kind, geo: geoR.geo, ctx: geoR.ctx, named: geoR.named, dossier: dos, ai });
    if (!plan.pois.length) throw { code: 'empty', msg: '店・施設の情報が見つかりませんでした。場所の名前を変えて試してください。' };
    plan.sample = 0;
    const acc = useAI ? (stat.both ? 'osm+ai' : 'ai') : 'osm';
    plan.info = { sum: String(dos.sum || '').slice(0, 600), hours: String(dos.hours || '').slice(0, 300), access: String(dos.access || '').slice(0, 300), web: String(dos.web || '').slice(0, 300), tips: (Array.isArray(dos.tips) ? dos.tips : []).map(x => String(x).slice(0, 120)).slice(0, 4), notes: [String(dos.notes || '').slice(0, 400), ...notes].filter(Boolean).join(' ／ '), acc, ai: useAI ? 1 : 0, search: useSearch ? 1 : 0, made: created, st: stat, src: [{ t: 'OpenStreetMap（位置・建物・道・名前のある場所）', u: 'https://www.openstreetmap.org/copyright' }].concat(useAI ? [{ t: useSearch ? 'AI＋ネット検索（店・施設の一覧、営業時間など）' : 'AI（店・施設の一覧、営業時間など）', u: '' }] : []) };
    if (!plan.ll && dos.lat && dos.lon) plan.ll = { lat: +dos.lat, lon: +dos.lon };
    const map = assemble(plan, hashN(plan.name));
    map.query = opts.query || cand.name; map.cand = { id: cand.id, osmType: cand.osmType, osmId: cand.osmId, name: cand.name, lat: cand.lat, lon: cand.lon, kind: cand.kind, cls: cand.cls, type: cand.type, bbox: cand.bbox, label: cand.label };
    map.opts = { ai: useAI ? 1 : 0, search: useSearch ? 1 : 0 };
    if (opts.keep) { for (const k of ['chat', 'created']) if (opts.keep[k] != null) map[k] = opts.keep[k]; }
    /* 5) 保存・サムネイル */
    say('save', '保存しています');
    await Store.put(map);
    try { Store.putThumb(map.id, await makeThumb(map, { dark: false })); } catch (e) {}
    return map;
  },
};
