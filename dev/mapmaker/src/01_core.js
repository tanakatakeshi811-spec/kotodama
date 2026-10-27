/* ---- 89d_mapmaker.js ---- */
/* ========== マップ制作：場所（ショッピングモール・テーマパーク・店など）の地図をAIが作る ==========
   ・場所の名前 → OpenStreetMap(位置・建物・道・水・緑・名前付きの場所) ＋ AI(ネット検索つき)で、店やアトラクションを1つずつ調べてマップにする
   ・2D（見取り図）と3D（立体・階を重ねて表示）を切り替え。保存して、いつでも見返せる
   ・その場所の今の気温（Open-Meteo）、検索、GPSの現在地、AIと見ながらチャット／LIVEで話す
   ・店の位置は、OpenStreetMapに載っている分は実際の位置、載っていない分はAIの情報から作る見取り図（目安）。 */
const MapMaker = (() => {

/* ---------- 種類・カテゴリ・アイコン ---------- */
Object.assign(ICONS, {
  'mm-layers': '<path d="M12 3.5 3.5 8 12 12.5 20.5 8z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
  'mm-mall': '<path d="M4.5 20.5v-11l7.5-5 7.5 5v11zM9.5 20.5v-6h5v6M8 11.2h.01M12 11.2h.01M16 11.2h.01"/>',
  'mm-ride': '<circle cx="12" cy="10" r="6.5"/><path d="M12 3.5v13M5.5 10h13M7.4 5.4l9.2 9.2M16.6 5.4l-9.2 9.2M8 21l4-4.5 4 4.5"/>',
  'mm-store': '<path d="M3.5 5h2.4l2 10h9.7l1.9-7.5H7"/><path d="M9.5 19.5h.01M16.5 19.5h.01"/>',
  'mm-station': '<rect x="5.5" y="3.5" width="13" height="14" rx="3"/><path d="M5.5 11.5h13M9 20.5l1.5-3M15 20.5l-1.5-3M9 14.5h.01M15 14.5h.01"/>',
  'mm-campus': '<path d="M3.5 9.5 12 5l8.5 4.5L12 14zM7 11.5v4.5c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5v-4.5"/>',
  'mm-show': '<path d="M12 3.5l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.8 5.4-.7z"/>',
  'mm-food': '<path d="M7 3.5v7M5 3.5v5a2 2 0 0 0 4 0v-5M7 10.5v10M16.5 3.5c-2 1.5-2.5 4.5-2.5 7h2.5v10"/>',
  'mm-cafe': '<path d="M5 8.5h11v5.5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2M11 3.5v2"/>',
  'mm-shop': '<path d="M5.5 8h13l-1 11.5h-11zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
  'mm-goods': '<path d="M4.5 9h15v3h-15zM6 12v8h12v-8M12 9v11M12 9c-1-3-5-3.5-5-1.2C7 9.5 9 9 12 9zM12 9c1-3 5-3.5 5-1.2 0 1.7-2 1.2-5 1.2z"/>',
  'mm-service': '<path d="M6.5 16.5v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14zM10.5 20.5h3"/>',
  'mm-wc': '<circle cx="12" cy="5" r="2"/><path d="M8.5 21v-7l-1.5-1.5V9.5h10v3L15.5 14v7M12 9.5V21"/>',
  'mm-gate': '<path d="M6.5 20.5v-16h11v16M3.5 20.5h17M14 12.5h.01"/>',
  'mm-parking': '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M10 16.5v-9h3a2.5 2.5 0 0 1 0 5h-3"/>',
  'mm-compass': '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  'mm-flat': '<path d="M3.5 7.5 9 5l6 2.5L20.5 5v11.5L15 19l-6-2.5-5.5 2.5z"/><path d="M9 5v11.5M15 7.5V19"/>',
  'mm-rot': '<path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path d="M19.5 4v4.5H15"/>',
  'mm-up': '<path d="M6 15l6-6 6 6"/>',
  'mm-sun': '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
});
const KINDS = {
  mall: { n: 'ショッピングモール', ic: 'mm-mall' },
  park: { n: 'テーマパーク・遊園地', ic: 'mm-ride' },
  store: { n: '大型店・スーパー', ic: 'mm-store' },
  station: { n: '駅・空港', ic: 'mm-station' },
  campus: { n: '学校・大きな施設', ic: 'mm-campus' },
  other: { n: 'その他の場所', ic: 'locate' },
};
/* cat: アイコン・色・立体にしたときの高さ(m)・絞り込みのグループ */
const CATS = {
  ride: { n: 'アトラクション', ic: 'mm-ride', c: '#E4572E', h: 16, g: 'ride' },
  play: { n: 'エンタメ・体験', ic: 'joystick', c: '#6A5ACD', h: 7, g: 'ride' },
  show: { n: 'ショー・劇場', ic: 'mm-show', c: '#A14CC7', h: 10, g: 'show' },
  food: { n: 'レストラン・フード', ic: 'mm-food', c: '#E8883A', h: 5, g: 'food' },
  cafe: { n: 'カフェ・スイーツ', ic: 'mm-cafe', c: '#B9794B', h: 4.5, g: 'food' },
  shop: { n: 'ショップ', ic: 'mm-shop', c: '#2E8FD6', h: 4.5, g: 'shop' },
  fashion: { n: 'ファッション', ic: 'shirt', c: '#D0488C', h: 4.5, g: 'shop' },
  goods: { n: '雑貨・生活', ic: 'mm-goods', c: '#2FA37A', h: 4.5, g: 'shop' },
  grocery: { n: '食品・スーパー', ic: 'mm-store', c: '#7DB02E', h: 5, g: 'shop' },
  service: { n: 'サービス', ic: 'mm-service', c: '#5B7C99', h: 4, g: 'service' },
  facility: { n: '案内・施設', ic: 'info', c: '#78868F', h: 3, g: 'facility' },
  wc: { n: 'トイレ・休憩', ic: 'mm-wc', c: '#3FA0C4', h: 3, g: 'facility' },
  gate: { n: '出入口', ic: 'mm-gate', c: '#2B3A55', h: 3, g: 'facility' },
  parking: { n: '駐車場・乗り場', ic: 'mm-parking', c: '#8A94A0', h: 2, g: 'facility' },
  other: { n: 'その他', ic: 'locate', c: '#8E8E93', h: 3, g: 'facility' },
};
const GROUPS = [
  { id: 'all', n: 'すべて' }, { id: 'ride', n: 'アトラクション・体験' }, { id: 'show', n: 'ショー' }, { id: 'food', n: 'グルメ' },
  { id: 'shop', n: 'ショップ' }, { id: 'service', n: 'サービス' }, { id: 'facility', n: '施設・トイレ' },
];
const catOf = id => CATS[id] || CATS.other;
const KIND_WORDS = [
  ['wc', /トイレ|お手洗い|化粧室|授乳|ベビー|休憩|喫煙/], ['gate', /入口|出口|ゲート|入場|エントランス|改札/], ['parking', /駐車|駐輪|バス停|乗り場|タクシー|モノレール|駅/],
  ['service', /銀行|ATM|郵便|両替|クリニック|病院|薬局|美容|理容|ヘアサロン|クリーニング|修理|写真|カスタマー|サービス|旅行|携帯|ケータイ|スマホ|ネイル|マッサージ|眼科|歯科|保険|コインロッカー|レンタル|配送|宅配/],
  ['facility', /案内|インフォメーション|総合|事務所|ロッカー|ベンチ|広場|ホール|プラザ|ラウンジ|喫煙所|救護|迷子/],
  ['ride', /アトラクション|ライド|コースター|観覧車|メリーゴーラウンド|ゴーカート|乗り物|ボート|ジェットコースター|ウォークスルー|シアター型/],
  ['show', /ショー|パレード|劇場|ステージ|ライブ|イベント|プログラム|映画|シネマ|シアター/],
  ['play', /ゲーム|アミューズメント|ボウリング|カラオケ|ゲームセンター|プレイ|遊具|体験|スポーツ|フィットネス|ジム|キッズ|プール|アスレ|ラウンドワン|スケート/],
  ['cafe', /カフェ|コーヒー|喫茶|スイーツ|ケーキ|パン|ベーカリー|アイス|クレープ|ドーナツ|タピオカ|ジュース|和菓子|洋菓子|菓子|チョコ/],
  ['food', /レストラン|飲食|フード|食堂|居酒屋|ラーメン|寿司|焼肉|定食|うどん|そば|ファスト|バー|グリル|イタリアン|中華|洋食|和食|ビュッフェ|ピザ|バーガー|ハンバーガー|カレー|丼|スナック|ワゴン|ホットドッグ|チキン|フードコート/],
  ['grocery', /スーパー|食品|生鮮|青果|精肉|鮮魚|惣菜|コンビニ|マーケット|ドラッグ|ストア|ディスカウント|酒/],
  ['fashion', /ファッション|衣料|服|アパレル|靴|シューズ|バッグ|ジュエリー|アクセサリー|時計|メガネ|眼鏡|下着|インナー|婦人|紳士|メンズ|レディース|キッズ服|ベビー服|コスメ|化粧品/],
  ['goods', /雑貨|インテリア|家具|生活|文具|本|書店|おもちゃ|玩具|ホビー|家電|電器|キッチン|日用品|ペット|花|スポーツ用品|アウトドア|楽器|CD|レコード|ホームセンター|DIY/],
  ['shop', /ショップ|グッズ|お土産|おみやげ|専門店|販売|物販|ギフト|ストア/],
];
function guessCat(text) { const t = String(text || ''); for (const [c, re] of KIND_WORDS) if (re.test(t)) return c; return 'shop'; }

/* ---------- 小さな道具 ---------- */
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : (isFinite(+v) && v !== '' && v != null ? +v : d));
const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const DEG = Math.PI / 180;
const isDark = () => { try { return /dark/.test(getComputedStyle(root).colorScheme || ''); } catch (e) { return false; } };
const ER = 6378137;
const llToXY = (o, lat, lon) => [(lon - o.lon) * DEG * ER * Math.cos(o.lat * DEG), (lat - o.lat) * DEG * ER];
const xyToLL = (o, x, y) => ({ lat: o.lat + y / (ER * DEG), lon: o.lon + x / (ER * DEG * Math.cos(o.lat * DEG)) });
const compass8 = (dx, dy) => { const a = (Math.atan2(dx, dy) / DEG + 360) % 360; return ['北', '北東', '東', '南東', '南', '南西', '西', '北西'][Math.round(a / 45) % 8]; };
const fmtM = m => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)}m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)}km`);
const walkMin = m => { const t = Math.max(1, Math.round(m * 1.25 / 75)); return t >= 60 ? `徒歩${Math.floor(t / 60)}時間${t % 60}分` : `徒歩${t}分`; };

/* 店の名前をそろえて比べる（全角/半角・かな/カナ・記号・空白の違いを無視） */
function nameKey(s) {
  s = String(s == null ? '' : s).normalize('NFKC').toLowerCase();
  s = s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  s = s.replace(/（.*?）|\(.*?\)|【.*?】|\[.*?\]/g, '');
  s = s.replace(/[\s　・･·\-－―‐ー~〜、。,.!！?？:：;；'’"“”&＆/／_+＋*＊#＃]/g, '');
  return s;
}
function bigrams(s) { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; }
function nameSim(a, b) {
  if (!a || !b) return 0; if (a === b) return 1;
  const la = a.length, lb = b.length, mn = Math.min(la, lb), mx = Math.max(la, lb);
  if (mn >= 3 && (a.includes(b) || b.includes(a))) return 0.82 + 0.15 * mn / mx;
  if (mn < 3) return 0;
  const A = bigrams(a), B = bigrams(b); let inter = 0; for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return 2 * inter / ((la - 1) + (lb - 1));
}

/* ---------- 図形の道具 ---------- */
function polyArea(p) { let a = 0; for (let i = 0, n = p.length; i < n; i++) { const q = p[(i + 1) % n]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
function polyCentroid(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = p.length; i < n; i++) { const q = p[(i + 1) % n], f = p[i][0] * q[1] - q[0] * p[i][1]; a += f; cx += (p[i][0] + q[0]) * f; cy += (p[i][1] + q[1]) * f; }
  if (Math.abs(a) < 1e-6) { let sx = 0, sy = 0; for (const q of p) { sx += q[0]; sy += q[1]; } return [sx / p.length, sy / p.length]; }
  return [cx / (3 * a), cy / (3 * a)];
}
function bboxOf(p) { let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18; for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; } return [x0, y0, x1, y1]; }
function inPoly(x, y, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function ccw(p) { return polyArea(p) >= 0 ? p : p.slice().reverse(); }
function hullOf(pts) {
  const a = pts.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]); if (a.length < 3) return a;
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const lo = []; for (const p of a) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = []; for (let i = a.length - 1; i >= 0; i--) { const p = a[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
/* 最小の傾いた長方形（建物の向きと大きさ）。戻り値: 中心・長辺w・短辺d・傾きrot(ラジアン)・4隅 */
function obbOf(pts) {
  const h = hullOf(pts); if (h.length < 3) { const b = bboxOf(pts); return { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, w: Math.max(b[2] - b[0], 1), d: Math.max(b[3] - b[1], 1), rot: 0 }; }
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(-ang), s = Math.sin(-ang);
    let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    for (const p of h) { const x = p[0] * c - p[1] * s, y = p[0] * s + p[1] * c; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const ar = (x1 - x0) * (y1 - y0);
    if (!best || ar < best.ar) best = { ar, ang, x0, y0, x1, y1 };
  }
  let w = best.x1 - best.x0, d = best.y1 - best.y0, ang = best.ang;
  const mx = (best.x0 + best.x1) / 2, my = (best.y0 + best.y1) / 2, cx = mx * Math.cos(ang) - my * Math.sin(ang), cy = mx * Math.sin(ang) + my * Math.cos(ang);
  if (d > w) { const t = w; w = d; d = t; ang += Math.PI / 2; }
  ang = ((ang % Math.PI) + Math.PI) % Math.PI; if (ang > Math.PI / 2) ang -= Math.PI;
  return { cx, cy, w, d, rot: ang };
}
/* Douglas-Peucker（線を簡単にする） */
function dp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1; const A = pts[a], B = pts[b], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) { const P = pts[i]; const d = L < 1e-9 ? Math.hypot(P[0] - A[0], P[1] - A[1]) : Math.abs(dy * P[0] - dx * P[1] + B[0] * A[1] - B[1] * A[0]) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  const out = []; for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]); return out;
}
const rectPoly = (cx, cy, w, d, rot = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [r1(cx + x * c - y * s), r1(cy + x * s + y * c)]);
};
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbStr = (c, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
const shade = (rgb, k) => [clamp(rgb[0] * k, 0, 255), clamp(rgb[1] * k, 0, 255), clamp(rgb[2] * k, 0, 255)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ---------- 保存（この端末／アカウント。KVの仕組みをそのまま使う） ----------
   索引 kd_mm_idx に一覧、各マップは kd_mm_<id>。大きいときは 180KBごとに分けて kd_mm_<id>_p<n> に置く（アカウント保存の1件の上限対策）。 */
const Store = {
  idx: null, cache: new Map(), thumbs: new Map(),
  async list() {
    if (!this.idx) { try { this.idx = (await KV.get('kd_mm_idx')) || {}; } catch (e) { this.idx = {}; } if (!this.idx.maps) this.idx = { v: 1, maps: {} }; }
    return Object.entries(this.idx.maps).map(([id, e]) => Object.assign({ id }, e)).sort((a, b) => (b.o || b.u || 0) - (a.o || a.u || 0));
  },
  saveIdx() { KV.put('kd_mm_idx', this.idx); },
  async get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    let m = null;
    try {
      const d = await KV.get('kd_mm_' + id);
      if (d && d.parts) { let s = ''; for (let k = 0; k < d.parts; k++) { const p = await KV.get(`kd_mm_${id}_p${k}`); s += (p && p.s) || ''; } m = JSON.parse(s); }
      else m = d;
    } catch (e) { m = null; }
    if (m) this.cache.set(id, m);
    return m;
  },
  async put(m, { touch = true } = {}) {
    await this.list();
    if (touch) m.updated = Date.now();
    this.cache.set(m.id, m);
    const s = JSON.stringify(m), big = byteLen(s) > 180 * 1024 && KV.be !== Local;
    const old = this.idx.maps[m.id];
    if (big) {
      const parts = []; let cur = '', size = 0;
      for (const ch of s) { const b = ch === '"' || ch === '\\' ? 2 : ch.charCodeAt(0) < 128 ? 1 : 3; if (size + b > 170 * 1024) { parts.push(cur); cur = ''; size = 0; } cur += ch; size += b; }
      if (cur) parts.push(cur);
      parts.forEach((p, k) => KV.put(`kd_mm_${m.id}_p${k}`, { s: p }));
      KV.put('kd_mm_' + m.id, { id: m.id, parts: parts.length });
      for (let k = parts.length; k < ((old && old.parts) || 0); k++) KV.del(`kd_mm_${m.id}_p${k}`);
      this.entry(m, parts.length);
    } else {
      KV.put('kd_mm_' + m.id, m);
      for (let k = 0; k < ((old && old.parts) || 0); k++) KV.del(`kd_mm_${m.id}_p${k}`);
      this.entry(m, 0);
    }
    this.saveIdx();
  },
  entry(m, parts) {
    const o = this.idx.maps[m.id] && this.idx.maps[m.id].o; this.idx.maps[m.id] = { n: m.name, k: m.kind, u: m.updated || Date.now(), c: m.created || Date.now(), p: (m.pois || []).length, f: (m.floors || []).length, a: m.addr || '', ll: m.ll || null, parts, sample: m.sample ? 1 : 0 };
    if (o) this.idx.maps[m.id].o = o;
  },
  async del(id) {
    await this.list();
    const e = this.idx.maps[id]; delete this.idx.maps[id]; this.cache.delete(id); this.thumbs.delete(id);
    KV.del('kd_mm_' + id); KV.del('kd_mm_th_' + id); for (let k = 0; k < ((e && e.parts) || 0); k++) KV.del(`kd_mm_${id}_p${k}`);
    try { LS.del('mmnote:' + id); LS.del('mmchat:' + id); } catch (e2) {}   // このマップ用の端末内の目印（注意書きを出した回数・AIとの会話）も消す
    this.saveIdx();
  },
  touch(id) { const e = this.idx && this.idx.maps[id]; if (!e) return; e.o = Date.now(); this.saveIdx(); },
  async thumb(id) { if (this.thumbs.has(id)) return this.thumbs.get(id); let t = ''; try { const d = await KV.get('kd_mm_th_' + id); t = (d && d.d) || ''; } catch (e) {} this.thumbs.set(id, t); return t; },
  putThumb(id, d) { this.thumbs.set(id, d); KV.put('kd_mm_th_' + id, { d }); },
};

/* ---------- 天気（Open-Meteo。キー不要・ブラウザから直接）---------- */
const WX_CODE = (c, day = true) => {
  if (c === 0) return day ? ['快晴', '☀️'] : ['快晴', '🌙'];
  if (c === 1) return day ? ['晴れ', '🌤️'] : ['晴れ', '🌙'];
  if (c === 2) return ['薄曇り', '⛅'];
  if (c === 3) return ['曇り', '☁️'];
  if (c === 45 || c === 48) return ['霧', '🌫️'];
  if (c >= 51 && c <= 57) return ['霧雨', '🌦️'];
  if (c >= 61 && c <= 67) return ['雨', '🌧️'];
  if (c >= 71 && c <= 77) return ['雪', '❄️'];
  if (c >= 80 && c <= 82) return ['にわか雨', '🌦️'];
  if (c === 85 || c === 86) return ['にわか雪', '🌨️'];
  if (c >= 95) return ['雷雨', '⛈️'];
  return ['—', '🌡️'];
};
const Wx = {
  cache: new Map(),
  key: (lat, lon) => lat.toFixed(2) + ',' + lon.toFixed(2),
  async get(lat, lon, force) {
    if (T.wx) return T.wx(lat, lon);
    const k = this.key(lat, lon), c = this.cache.get(k);
    if (c && !force && Date.now() - c.at < 10 * 60 * 1000) return c;
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day&hourly=temperature_2m,precipitation_probability,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=2&wind_speed_unit=ms`;
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(u, { signal: ctl.signal }); if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json(), cu = j.current || {}, h = j.hourly || {}, dly = j.daily || {};
      const out = { at: Date.now(), lat, lon, t: cu.temperature_2m, feel: cu.apparent_temperature, hum: cu.relative_humidity_2m, wind: cu.wind_speed_10m, rain: cu.precipitation, code: cu.weather_code, day: cu.is_day !== 0, time: cu.time || '',
        tmax: dly.temperature_2m_max && dly.temperature_2m_max[0], tmin: dly.temperature_2m_min && dly.temperature_2m_min[0], pop: dly.precipitation_probability_max && dly.precipitation_probability_max[0],
        sunrise: dly.sunrise && dly.sunrise[0], sunset: dly.sunset && dly.sunset[0], hours: [] };
      const now = cu.time || '';
      for (let i = 0; i < (h.time || []).length; i++) { if (h.time[i] >= now.slice(0, 13)) out.hours.push({ t: h.time[i], v: h.temperature_2m[i], p: h.precipitation_probability ? h.precipitation_probability[i] : null, c: h.weather_code ? h.weather_code[i] : 0 }); if (out.hours.length >= 12) break; }
      if (typeof out.t !== 'number') throw new Error('nodata');
      this.cache.set(k, out); return out;
    } finally { clearTimeout(to); }
  },
  label(w) { const [n, e] = WX_CODE(w.code, w.day); return { name: n, em: e }; },
  line(w) {
    if (!w) return '';
    const l = this.label(w), bits = [`${l.name} ${Math.round(w.t)}℃`];
    if (typeof w.feel === 'number') bits.push(`体感${Math.round(w.feel)}℃`);
    if (typeof w.hum === 'number') bits.push(`湿度${Math.round(w.hum)}%`);
    if (typeof w.wind === 'number') bits.push(`風${w.wind.toFixed(1)}m/s`);
    if (typeof w.tmax === 'number') bits.push(`今日の最高${Math.round(w.tmax)}℃・最低${Math.round(w.tmin)}℃`);
    if (typeof w.pop === 'number') bits.push(`降水確率${Math.round(w.pop)}%`);
    return bits.join('、');
  },
};
