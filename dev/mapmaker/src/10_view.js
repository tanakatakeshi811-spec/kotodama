
/* ---------- マップを見る画面 ---------- */
function viewHTML() {
  return `<div class="mm-stage">
  <canvas class="mm-cv" aria-label="マップ"></canvas>
  <div class="mm-top">
    <div class="mm-r1"><button class="mm-b" data-m="back" aria-label="マップの一覧へ">${ic('chevL')}</button><div class="mm-ttl"><b></b><small></small></div><button class="mm-wx" data-m="wx" aria-label="気温・天気" hidden><span class="mm-wxe"></span><span class="mm-wxt"></span></button><button class="mm-b" data-m="more" aria-label="そのほかの操作">${ic('more')}</button><button class="mm-b mm-xl" data-m="close" aria-label="マップを閉じる">${ic('x')}</button></div>
    <div class="mm-r2"><div class="mm-search"><span class="mm-si">${ic('search')}</span><input type="search" data-m="q" placeholder="お店・アトラクション・トイレなどを探す" aria-label="マップの中を検索" autocomplete="off" enterkeyhint="search"><button class="mm-clr" data-m="sclear" aria-label="検索をクリア" hidden>${ic('x')}</button><div class="mm-sr" hidden></div></div><div class="mm-seg" role="group" aria-label="表示"><button data-m="d2" aria-pressed="true">2D</button><button data-m="d3" aria-pressed="false">3D</button></div></div>
    <div class="mm-chips" role="group" aria-label="種類で絞りこむ"></div>
    <div class="mm-gstat" hidden></div>
    <div class="mm-banner" hidden></div>
  </div>
  <div class="mm-floors" role="group" aria-label="階" hidden></div>
  <div class="mm-ctl"><button data-m="zin" aria-label="拡大">＋</button><button data-m="zout" aria-label="縮小">－</button><button data-m="rotl" class="mm-r3" aria-label="左にまわす">${ic('mm-rot')}</button><button data-m="rotr" class="mm-r3 flip" aria-label="右にまわす">${ic('mm-rot')}</button><button data-m="north" class="mm-cmp" aria-label="北を上にする">${ic('mm-compass')}</button><button data-m="fit" aria-label="全体を見る">${ic('map')}</button><button data-m="gps" class="mm-gps" aria-label="現在地を表示" aria-pressed="false">${ic('crosshair')}</button></div>
  <div class="mm-attr"></div>
  <div class="mm-pcard" hidden></div>
</div>
<aside class="mm-side">
  <div class="mm-grab" data-m="grab" aria-hidden="true"><i></i></div>
  <div class="mm-tabs" role="tablist"><button role="tab" data-m="tab" data-t="spots">スポット</button><button role="tab" data-m="tab" data-t="info">情報</button><button role="tab" data-m="tab" data-t="ai">AI</button></div>
  <div class="mm-pane" data-p="spots"></div><div class="mm-pane" data-p="info" hidden></div><div class="mm-pane" data-p="ai" hidden></div>
</aside>`;
}
function ensureView() {
  if (M.V) return;
  M.V = createView($('.mm-cv', M.el), {
    onTap: (id, w) => tapMap(id, w),
    onMode: () => paintMode(),
    onFloor: () => { paintFloors(); },
    onChange: v => { const a = Math.round(v.cam.h * 573) / 10; if (a !== M.cmpA) { M.cmpA = a; const c = $('.mm-cmp svg', M.el); if (c) c.style.transform = `rotate(${(-v.cam.h * 180 / Math.PI).toFixed(1)}deg)`; } },
  });
  themeSync(); bindExtra();
}

/* ---------- マップを開く ---------- */
async function openMap(id, o = {}) {
  shell();
  if (!M.on) { M.on = true; M.el.hidden = false; doc.body.classList.add('mm-on'); themeSync(); }
  const m = /^sample-/.test(id) ? Samples.get(id) : await Store.get(id);
  if (!m) { toast('マップを開けませんでした', { err: true }); showScreen('lib'); renderLib(); return; }
  closeGps(); clearInterval(M.wxT);
  Object.assign(M, { map: m, sel: null, q: '', filter: 'all', hits: null, hitList: null, tab: o.tab || 'spots', edit: false, place: null, listN: 90, lk: '', wx: null, route: null });
  if (!m.sample) Store.touch(id);
  showScreen('view'); ensureView();
  const inp = $('input[data-m=q]', M.el); if (inp) inp.value = '';
  paintHead(); paintTabs(); layout();
  M.V.setMap(m); M.V.setHits(null); M.V.setFilter('all'); M.V.setMode(!!o.mode3d, false); M.V.setGps(null, false);
  themeSync(); paintAll(); setSheet(M.narrow && o.tab ? 'half' : 'peek', true);
  startWx(); firstNote(); MC.chat = null; MC.load();
  if (o.sel) setTimeout(() => select(o.sel, { focus: true }), 60);
  if (o.query) setTimeout(() => { if (inp) { inp.value = o.query; searchInput(o.query); } }, 60);
}
function paintAll() { paintHead(); paintChips(); paintFloors(); paintMode(); paintSpots(); paintInfo(); paintCard(); paintGps(); paintAttr(); if (M.tab === 'ai') renderMsgs(); }
function paintHead() {
  const m = M.map; if (!m) return;
  $('.mm-ttl b', M.el).textContent = m.name; $('.mm-ttl small', M.el).textContent = [kindN(m.kind), m.addr].filter(Boolean).join(' ・ ').slice(0, 60);
}
function paintAttr() {
  const m = M.map; const a = $('.mm-attr', M.el); if (!m || !a) return;
  a.innerHTML = m.sample ? '見本（架空の場所）' : (m.info && m.info.acc === 'ai' ? '地図データ © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors ・ 店の情報：AI' : '地図データ © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors');
}
function firstNote() {
  const m = M.map, b = $('.mm-banner', M.el); if (!b) return;
  let n = 0; try { n = LS.get('mmnote:' + m.id, 0); } catch (e) {}
  if (n === true || n >= 2 || m.sample) { b.hidden = true; return; }
  try { LS.set('mmnote:' + m.id, (+n || 0) + 1); } catch (e) {}
  const acc = m.info && m.info.acc, dn = m.info && m.info.aiDown;
  const lack = acc !== 'osm' ? '' : dn === 'relay' ? '（PCのClaudeのログインが切れていたため、お店の情報は少なめです。ログインし直して「作り直す」と増やせます）' : dn === 'key' ? '（APIキーが正しくなかったため、お店の情報は少なめです。設定で確かめて「作り直す」と増やせます）' : dn === 'session' ? '（Claudeのログインの期限が切れていたため、お店の情報は少なめです。ログインし直して「作り直す」と増やせます）' : '（AIにつながっていなかったため、お店の情報は少なめです）';
  b.innerHTML =`<span>${ic('info', 'sm')}</span><span>建物の外の位置は<b>OpenStreetMap</b>の実際の位置です。建物の中の店の並びは、AIが調べた情報から作った<b>見取り図の目安</b>です${lack}。</span><button data-m="notex" aria-label="閉じる">${ic('x', 'sm')}</button>`;
  b.className = 'mm-banner note'; b.hidden = false; clearTimeout(M.bannerT); M.bannerT = setTimeout(() => { b.hidden = true; layout(); }, 10000);
}

/* ---------- 画面の大きさ・下のシート ---------- */
function layout() {
  if (!M.built || !M.on || M.screen !== 'view') return;
  const r = M.el.getBoundingClientRect(); if (!r.width) return;
  const narrow = r.width < 760; M.narrow = narrow; M.el.classList.toggle('narrow', narrow);
  const H = r.height, hs = sheetHeights();
  const sh = narrow ? hs[M.sheet] || hs.peek : 0;
  M.el.style.setProperty('--mm-sh', sh + 'px');
  const stage = $('.mm-stage', M.el), sr = stage.getBoundingClientRect(), w = Math.round(sr.width), h = Math.round(sr.height);
  if (!w || !h) return;
  const chips = $('.mm-chips', M.el), top = $('.mm-top', M.el), tr = top.getBoundingClientRect();
  const padT = Math.max(48, Math.round(tr.bottom - sr.top) + 6);
  M.el.style.setProperty('--mm-top', padT + 'px');
  const card = $('.mm-pcard', M.el), cardH = card && !card.hidden && narrow ? Math.round(card.getBoundingClientRect().height) + 12 : 0;
  const padB = narrow ? (M.sheet === 'peek' ? sh + cardH : Math.min(sh, h * 0.5)) : 0;
  const key = [w, h, padT, padB, devicePixelRatio].join();
  void chips;
  if (key !== M.lk) {
    M.lk = key; M.V.pad = { l: 0, r: 0, t: padT, b: padB }; M.V.resize(w, h, Math.min(2, devicePixelRatio || 1));
    if (!M.V.moved) M.V.fit(false); else M.V.render();
  }
}
function sheetHeights() { const H = M.el.getBoundingClientRect().height; return { peek: 76, half: Math.round(H * 0.46), full: Math.max(240, H - 70) }; }
function setSheet(s, quiet) {
  M.sheet = s; M.el.dataset.sheet = s; layout(); if (!quiet) M.V && M.V.render();
}
function setTab(t) {
  if (M.narrow && M.tab === t && M.sheet !== 'peek') { setSheet('peek'); return; }
  M.tab = t; paintTabs();
  if (t === 'ai') renderMsgs(); if (t === 'info') paintInfo();
  if (M.narrow && M.sheet === 'peek') setSheet('half');
}
function paintTabs() {
  for (const b of $$('.mm-tabs [data-t]', M.el)) { const on = b.dataset.t === M.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
  for (const p of $$('.mm-pane', M.el)) p.hidden = p.dataset.p !== M.tab;
  if (M.docked) { const a = $('[data-t=ai]', M.el); if (a) a.hidden = true; }
}

/* ---------- 2D/3D・階・種類 ---------- */
function paintMode() {
  const is3 = M.V && M.V.is3d(); const b2 = $('[data-m=d2]', M.el), b3 = $('[data-m=d3]', M.el);
  if (!b2) return; b2.classList.toggle('on', !is3); b3.classList.toggle('on', is3); b2.setAttribute('aria-pressed', String(!is3)); b3.setAttribute('aria-pressed', String(is3));
  M.el.classList.toggle('is3d', !!is3);
}
function paintFloors() {
  const box = $('.mm-floors', M.el); if (!box || !M.V || !M.V.R) return;
  const fl = M.V.R.floors; box.hidden = fl.length < 2; if (fl.length < 2) return;
  box.innerHTML = fl.slice().reverse().map(f => `<button data-m="floor" data-f="${esc(f.id)}" class="${f.id === M.V.floor ? 'on' : ''}" aria-label="${esc(floorLabel(f.id))}" aria-pressed="${f.id === M.V.floor}">${esc(f.id === 'RF' ? '屋上' : f.id)}</button>`).join('');
}
function paintChips() {
  const box = $('.mm-chips', M.el); if (!box || !M.map) return;
  const cnt = {}; for (const p of M.map.pois) { const g = catOf(p.c).g; cnt[g] = (cnt[g] || 0) + 1; }
  const gs = GROUPS.filter(g => g.id === 'all' || cnt[g.id]);
  box.hidden = gs.length < 3;
  box.innerHTML = gs.map(g => `<button class="mm-chip${M.filter === g.id ? ' on' : ''}" data-m="chip" data-g="${g.id}">${esc(g.n)}${g.id === 'all' ? '' : `<em>${cnt[g.id]}</em>`}</button>`).join('');
}

/* ---------- スポットの一覧 ---------- */
const GORDER = ['ride', 'show', 'food', 'shop', 'service', 'facility'];
function floorShort(f) { return f === 'RF' ? '屋上' : /^B\d+$/.test(f) ? '地下' + f.slice(1) + '階' : parseInt(f, 10) + '階'; }
function spotGroups() {
  const m = M.map, bl = m.bldgs || [], zn = new Map((m.zones || []).map(z => [z.id, z.n])); let arr = M.q.trim() && M.hitList ? M.hitList.map(x => x.p) : m.pois;
  arr = arr.filter(p => M.filter === 'all' || catOf(p.c).g === M.filter);
  const groups = new Map();
  for (const p of arr) {
    let key, title, ord, fid = '';
    if (p.b && p.f) { const bi = bl.findIndex(b => b.id === p.b); key = p.b + '|' + p.f; title = floorShort(p.f) + (bl.length > 1 && bl[bi] ? ' ' + (bl[bi].n || '建物' + (bi + 1)) : ''); ord = Math.max(0, bi) * 1000 + floorLv(p.f) + 50; fid = p.f; }
    else if (p.z && zn.has(p.z)) { key = 'z|' + p.z; title = zn.get(p.z); ord = 100000 + (m.zones || []).findIndex(z => z.id === p.z); }
    else if (bl.length && p.src === 'osm') { key = 'osm'; title = 'まわりのお店・施設（OpenStreetMap）'; ord = 210000; }
    else { key = 'out'; title = bl.length ? '建物の外' : 'そのほか'; ord = 200000; }
    let g = groups.get(key); if (!g) groups.set(key, g = { key, title, ord, fid, items: [] }); g.items.push(p);
  }
  const out = [...groups.values()].sort((a, b) => a.ord - b.ord);
  const gi = p => { const i = GORDER.indexOf(catOf(p.c).g); return i < 0 ? 9 : i; };
  for (const g of out) { if (M.q.trim()) { const sc = new Map(M.hitList.map(x => [x.p.id, x.s])); g.items.sort((a, b) => (sc.get(b.id) || 0) - (sc.get(a.id) || 0)); } else g.items.sort((a, b) => gi(a) - gi(b) || a.n.localeCompare(b.n, 'ja')); }
  return out;
}
function distText(p) {
  const g = M.gps; if (!g.on || !g.pos || !g.inside) return ''; const d = dist2(g.pos.x, g.pos.y, p.x, p.y); return fmtM(d);
}
function paintSpots() {
  const pane = $('.mm-pane[data-p=spots]', M.el); if (!pane || !M.map) return;
  const m = M.map, groups = spotGroups(), total = groups.reduce((s, g) => s + g.items.length, 0);
  let h = `<div class="mm-sh"><span>${M.q.trim() ? `「${esc(M.q.trim())}」の検索結果 <b>${total}件</b>` : `スポット <b>${m.pois.length}件</b>${M.filter !== 'all' ? ` ・ 絞りこみ <b>${total}件</b>` : ''}`}</span>${m.sample ? '' : `<button class="btn sm" data-m="add" aria-label="スポットを追加">${ic('plus')}追加</button>`}</div>`;
  const near = nearSpots(5); if (near.length && !M.q.trim()) h += `<div class="mm-near"><small>いまの現在地の近く</small>${near.map(x => `<button class="chip" data-m="pick" data-id="${esc(x.p.id)}">${esc(x.p.n.length > 12 ? x.p.n.slice(0, 12) + '…' : x.p.n)}<em>${esc(fmtM(x.d))}</em></button>`).join('')}</div>`;
  if (!total) { h += `<div class="mm-none"><p>${M.q.trim() ? '見つかりませんでした。' : 'ここには何もありません。'}</p>${M.q.trim() && !m.sample ? `<button class="btn sm" data-m="askq">${ic('sparkle')}AIに聞いてみる</button>` : ''}</div>`; pane.innerHTML = h; return; }
  let shown = 0; const lim = M.listN;
  for (const g of groups) {
    if (shown >= lim) break;
    const items = g.items.slice(0, Math.max(0, lim - shown)); shown += items.length;
    h += `<div class="mm-grp"><h4 ${g.fid ? `data-m="floor" data-f="${esc(g.fid)}" role="button" tabindex="0"` : ''}>${esc(g.title)}<em>${g.items.length}</em></h4>${items.map(p => spotItem(p)).join('')}</div>`;
  }
  if (shown < total) h += `<button class="btn sm mm-more" data-m="more-list">もっと見る（あと${total - shown}件）</button>`;
  pane.innerHTML = h; markSel();
}
function spotItem(p) {
  const loc = [p.b && p.f ? floorShort(p.f) : '', catOf(p.c).n].filter(Boolean).join(' ・ '), d = distText(p);
  return `<button class="mm-it${M.sel === p.id ? ' sel' : ''}" data-m="pick" data-id="${esc(p.id)}">${catIcon(p.c)}<span><b>${esc(p.n)}</b><small>${esc(loc)}${d ? ' ・ ' + esc(d) : ''}</small></span></button>`;
}
function markSel() { for (const b of $$('.mm-it', M.el)) b.classList.toggle('sel', b.dataset.id === M.sel); }
function nearSpots(n) {
  const g = M.gps; if (!g.on || !g.pos || !g.inside || !M.map) return [];
  return M.map.pois.filter(p => !p.f || p.f === (M.V && M.V.floor)).map(p => ({ p, d: dist2(g.pos.x, g.pos.y, p.x, p.y) })).filter(x => x.d < 400).sort((a, b) => a.d - b.d).slice(0, n);
}

/* ---------- 選ぶ・カード ---------- */
function select(id, o = {}) {
  const q = id && M.V.R && M.V.R.byId.get(id); if (id && !q) return;
  M.sel = id || null; M.route = null; M.V.route = null; M.V.select(id || null);
  paintCard(); layout();
  if (id && o.focus !== false) M.V.focusPoi(id, { at: focusAt() });
  markSel();
  if (id && M.narrow && M.sheet !== 'peek') setSheet('peek');
  const row = id && $(`.mm-it[data-id="${CSS.escape(id)}"]`, M.el); if (row && !M.narrow && o.scroll !== false) row.scrollIntoView({ block: 'nearest' });
}
/* 広い画面：選んだスポットを、左下のカードや右のボタンにかくれない位置に出す */
function focusAt() {
  if (M.narrow || !M.V) return null;
  const card = $('.mm-pcard', M.el); if (!card || card.hidden) return null;
  const st = $('.mm-stage', M.el).getBoundingClientRect(), cr = card.getBoundingClientRect(), W = st.width, H = st.height;
  const top = Math.max(48, $('.mm-top', M.el).getBoundingClientRect().bottom - st.top + 6);
  const x0 = cr.right - st.left + 10, x1 = W - 64;
  if (x1 - x0 >= 150) return [(x0 + x1) / 2, (top + H) / 2];
  const y1 = cr.top - st.top - 8;
  return y1 - top >= 100 ? [W / 2, (top + y1) / 2] : null;
}
function poiSrcChips(p) {
  const c = [];
  if (p.src === 'osm+ai') c.push('<span class="mm-tg ok">OpenStreetMapと一致</span>'); else if (p.src === 'osm') c.push('<span class="mm-tg ok">OpenStreetMap</span>'); else if (p.src === 'ai') c.push('<span class="mm-tg">AIの情報</span>'); else if (p.src === 'user') c.push('<span class="mm-tg">自分で追加</span>'); else if (p.src === 'sample') c.push('<span class="mm-tg">見本</span>');
  c.push(p.ps === 'osm' ? '<span class="mm-tg ok">位置：実測</span>' : p.ps === 'user' ? '<span class="mm-tg">位置：自分で指定</span>' : '<span class="mm-tg warn">位置：見取り図の目安</span>');
  return c.join('');
}
function paintCard() {
  const box = $('.mm-pcard', M.el); if (!box) return;
  const p = M.sel && M.map ? M.map.pois.find(x => x.id === M.sel) : null;
  if (!p) { box.hidden = true; box.innerHTML = ''; return; }
  const m = M.map, bl = m.bldgs || [], bi = bl.findIndex(b => b.id === p.b), zn = (m.zones || []).find(z => z.id === p.z);
  const where = [p.b && p.f ? floorShort(p.f) + (bl.length > 1 && bl[bi] ? ' ' + bl[bi].n : '') : (bl.length ? (p.src === 'osm' ? 'まわり（OpenStreetMapの位置）' : '建物の外') : ''), zn ? zn.n : ''].filter(Boolean).join(' ・ ');
  const d = distText(p), hasLL = !!(m.ll && !m.sample);
  box.innerHTML = `<div class="mm-pc-h">${catIcon(p.c, 'lg')}<div><b>${esc(p.n)}</b><small>${esc([catOf(p.c).n, where].filter(Boolean).join(' ・ '))}${d ? ' ・ 現在地から' + esc(d) : ''}</small></div><button class="mm-b" data-m="selx" aria-label="選択をやめる">${ic('x')}</button></div>
    ${p.ds ? `<p class="mm-pc-d">${esc(p.ds)}</p>` : ''}${p.hrs ? `<p class="mm-pc-m">${ic('timer', 'sm')}${esc(p.hrs)}</p>` : ''}${p.pos && p.ps !== 'osm' ? `<p class="mm-pc-m">${ic('locate', 'sm')}${esc(p.pos)}</p>` : ''}
    <div class="mm-pc-t">${poiSrcChips(p)}</div>
    <div class="mm-pc-a"><button class="btn sm primary" data-m="route">${ic('route')}道すじ</button><button class="btn sm" data-m="askp">${ic('sparkle')}AIに聞く</button>${hasLL ? `<button class="btn sm" data-m="gmap">${ic('map')}Googleマップ</button>` : ''}${p.url && /^https?:\/\//.test(p.url) ? `<a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener">公式サイト</a>` : ''}${m.sample ? '' : `<button class="btn sm" data-m="editp">${ic('edit')}編集</button>`}</div>`;
  box.hidden = false;
}

/* ---------- 検索 ---------- */
function searchPois(m, q) {
  const words = String(q || '').normalize('NFKC').toLowerCase().split(/[\s　]+/).filter(Boolean); if (!words.length) return [];
  const zn = new Map((m.zones || []).map(z => [z.id, z.n])), bl = m.bldgs || [];
  const kws = words.map(nameKey).filter(Boolean); if (!kws.length) return [];
  const out = [];
  for (const p of m.pois) {
    if (!p._h) { const bi = bl.findIndex(b => b.id === p.b); Object.defineProperty(p, '_h', { value: { n: nameKey(p.n), d: nameKey(p.ds || ''), c: nameKey(catOf(p.c).n), w: nameKey([p.f ? floorShort(p.f) + p.f : '', p.b && bl[bi] ? bl[bi].n : '', zn.get(p.z) || '', p.pos || ''].join(' ')) }, enumerable: false, configurable: true }); }
    const h = p._h; let s = 0, ok = true;
    for (const k of kws) {
      let w = 0;
      if (h.n === k) w = 100; else if (h.n.startsWith(k)) w = 82; else if (h.n.includes(k)) w = 64; else if (k.length >= 3 && nameSim(h.n, k) >= 0.6) w = 40;
      else if (h.c.includes(k)) w = 28; else if (h.d.includes(k)) w = 22; else if (h.w.includes(k)) w = 16;
      if (!w) { ok = false; break; } s += w;
    }
    if (ok) out.push({ p, s: s + catPri(p.c) * 0.1 });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, 80);
}
function searchInput(v) {
  M.q = v; const res = v.trim() ? searchPois(M.map, v) : []; M.hitList = res; M.hits = res.length ? new Set(res.map(x => x.p.id)) : null;
  M.V.setHits(M.hits); paintSearchDrop(res, v); paintSpots();
  const c = $('.mm-clr', M.el); if (c) c.hidden = !v;
}
function paintSearchDrop(res, v) {
  const d = $('.mm-sr', M.el); if (!d) return;
  if (!v || !v.trim()) { d.hidden = true; d.innerHTML = ''; return; }
  if (!res.length) { d.innerHTML = `<div class="mm-srn">「${esc(v.trim())}」は見つかりませんでした${M.map.sample ? '' : `<button class="btn sm" data-m="askq">${ic('sparkle')}AIに聞く</button>`}</div>`; d.hidden = false; return; }
  const bl = M.map.bldgs || [];
  d.innerHTML = res.slice(0, 9).map(x => { const p = x.p, bi = bl.findIndex(b => b.id === p.b); return `<button class="mm-sri" data-m="pick" data-id="${esc(p.id)}" data-from="s">${catIcon(p.c)}<span><b>${esc(p.n)}</b><small>${esc([catOf(p.c).n, p.b && p.f ? floorShort(p.f) + (bl.length > 1 && bl[bi] ? ' ' + bl[bi].n : '') : ''].filter(Boolean).join(' ・ '))}</small></span></button>`; }).join('') + (res.length > 9 ? `<div class="mm-srn">ほか${res.length - 9}件（下の一覧にあります）</div>` : '');
  d.hidden = false;
}
function clearSearch() { const i = $('input[data-m=q]', M.el); if (i) i.value = ''; searchInput(''); }

/* ---------- 気温 ---------- */
function wxCoord() { const m = M.map; return m && m.ll && isFinite(m.ll.lat) && isFinite(m.ll.lon) ? m.ll : null; }
function startWx() { clearInterval(M.wxT); refreshWx(); M.wxT = setInterval(() => { if (M.on && M.map) refreshWx(true); }, 10 * 60 * 1000); }
async function refreshWx(force) {
  const c = wxCoord(), id = M.map && M.map.id; if (!c) { M.wx = null; paintWx(); return; }
  try { const w = await Wx.get(c.lat, c.lon, force); if (M.map && M.map.id === id) { M.wx = w; M.wxErr = ''; paintWx(); } }
  catch (e) { if (M.map && M.map.id === id) { M.wx = null; M.wxErr = 'x'; paintWx(); } }
}
function paintWx() {
  const b = $('.mm-wx', M.el); if (!b) return; const c = wxCoord();
  if (!c) { b.hidden = true; return; } b.hidden = false;
  const w = M.wx; $('.mm-wxe', b).textContent = w ? Wx.label(w).em : '🌡️'; $('.mm-wxt', b).textContent = w ? `${Math.round(w.t)}℃` : (M.wxErr ? '—' : '…');
  b.title = w ? `${M.map.sample ? '（見本：東京の気温）' : ''}${Wx.line(w)}` : (M.wxErr ? '気温を取得できませんでした（ネットにつながっていないか、混み合っています）' : '気温を取得しています');
  paintInfo();
}
function wxDetail() {
  const w = M.wx, m = M.map;
  if (!w) { toast(M.wxErr ? '気温を取得できませんでした。しばらくしてからもう一度試してください' : '気温を取得しています…', { err: !!M.wxErr }); refreshWx(true); return; }
  const l = Wx.label(w), hh = s => (s || '').slice(11, 16), hours = (w.hours || []).slice(0, 9);
  const mx = Math.max(...hours.map(h => h.v), w.t), mn = Math.min(...hours.map(h => h.v), w.t), span = Math.max(4, mx - mn);
  const body = `<div class="mm-wxd"><div class="mm-wxb"><span>${l.em}</span><b>${Math.round(w.t)}<small>℃</small></b><div><strong>${esc(l.name)}</strong><small>体感 ${Math.round(w.feel)}℃</small></div></div>
    <dl><div><dt>今日の最高／最低</dt><dd>${Math.round(w.tmax)}℃ ／ ${Math.round(w.tmin)}℃</dd></div><div><dt>降水確率</dt><dd>${w.pop != null ? Math.round(w.pop) + '%' : '—'}</dd></div><div><dt>湿度</dt><dd>${Math.round(w.hum)}%</dd></div><div><dt>風</dt><dd>${w.wind.toFixed(1)}m/s</dd></div><div><dt>日の出／日の入り</dt><dd>${hh(w.sunrise)} ／ ${hh(w.sunset)}</dd></div></dl>
    ${hours.length ? `<div class="mm-wxh">${hours.map(h => `<div><small>${esc(h.t.slice(11, 13))}時</small><i style="height:${Math.round(18 + 44 * (h.v - mn) / span)}px"></i><b>${Math.round(h.v)}°</b>${h.p != null ? `<small class="p">${Math.round(h.p)}%</small>` : '<small class="p"></small>'}</div>`).join('')}</div>` : ''}
    <p class="mm-hint">${m.sample ? '見本は架空の場所のため、東京の気温を表示しています。' : `「${esc(m.name)}」のあたりの予報です。`} データ：Open-Meteo ・ 更新 ${new Date(w.at).getHours()}:${String(new Date(w.at).getMinutes()).padStart(2, '0')}</p></div>`;
  dialog({ title: `${m.sample ? '東京' : m.name}の気温`, body, actions: [{ label: '更新する', value: 'r' }, { label: '閉じる', value: null, primary: true }] }).then(v => { if (v === 'r') refreshWx(true); });
}

/* ---------- 現在地（GPS）---------- */
function closeGps(keepUI) {
  const g = M.gps; if (g.wid != null) { try { navigator.geolocation.clearWatch(g.wid); } catch (e) {} } g.wid = null;
  if (!keepUI) { g.on = false; g.pos = null; g.inside = false; }
  if (M.V) M.V.setGps(null, false); if (M.V && !keepUI) M.V.route = null; paintGps();
}
function gpsToggle() {
  if (M.gps.on) { closeGps(); toast('現在地の表示をやめました', { ms: 1800 }); return; }
  const m = M.map; if (!m) return;
  if (m.sample || !m.ll) { toast('見本は架空の場所なので、現在地は表示できません', { ms: 3200 }); return; }
  if (T.geo) { M.gps.on = true; M.gps.first = true; gpsSet(T.geo); return; }
  if (!navigator.geolocation) { toast('この端末では位置情報を使えません', { err: true }); return; }
  if (typeof isSecureContext !== 'undefined' && !isSecureContext) { toast('この開き方では位置情報を使えません（https で開いてください）', { err: true, ms: 4200 }); return; }
  M.gps.on = true; M.gps.first = true; M.gps.err = ''; paintGps();
  M.gps.wid = navigator.geolocation.watchPosition(p => gpsSet({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }), e => { const den = e && e.code === 1; closeGps(); toast(den ? '位置情報の利用が許可されていません。ブラウザの設定で許可してください' : '現在地を取得できませんでした', { err: true, ms: 4200 }); }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 25000 });
}
function gpsSet(p) {
  const m = M.map; if (!m || !m.ll || !M.gps.on) return;
  const xy = llToXY(m.ll, p.lat, p.lon), e = m.ext, near = xy[0] > e[0] - 120 && xy[0] < e[2] + 120 && xy[1] > e[1] - 120 && xy[1] < e[3] + 120;
  const fx = (e[0] + e[2]) / 2, fy = (e[1] + e[3]) / 2, far = Math.hypot(xy[0] - fx, xy[1] - fy);
  const pos = { x: xy[0], y: xy[1], acc: Math.max(5, p.acc || 20), lat: p.lat, lon: p.lon };
  Object.assign(M.gps, { pos, inside: near, far, dir: compass8(xy[0] - fx, xy[1] - fy) });
  M.V.setGps(far < 4000 ? pos : null, near);
  if (M.gps.first) {
    M.gps.first = false;
    if (near) { M.V.focusPoint(pos.x, pos.y, Math.max(M.V.goal.s, 2.2)); toast('現在地を表示しました（誤差 約' + Math.round(pos.acc) + 'm）', { ms: 2400 }); }
    else toast(`いまの場所は、このマップから約${fmtM(far)}（${M.gps.dir}）はなれています`, { ms: 4200 });
  }
  if (M.pendingRoute) { const id = M.pendingRoute; M.pendingRoute = null; routeTo(id); }
  else if (M.routeId) routeTo(M.routeId, true);
  paintGps(); if (M.tab === 'spots') paintSpots();
}
function paintGps() {
  const b = $('.mm-gps', M.el); if (!b) return; const g = M.gps;
  b.classList.toggle('on', g.on); b.setAttribute('aria-pressed', String(g.on));
  const s = $('.mm-gstat', M.el); if (!s) return;
  if (!g.on) { s.hidden = true; return; }
  s.hidden = false;
  s.innerHTML = !g.pos ? `${ic('locate', 'sm')}現在地を取得しています…` : g.inside ? `${ic('locate', 'sm')}現在地：このマップの中（誤差 約${Math.round(g.pos.acc)}m）${M.V && M.V.R && M.V.R.floors.length > 1 ? '<small>階は端末ではわかりません</small>' : ''}` : `${ic('locate', 'sm')}現在地：このマップから約${fmtM(g.far)}（${g.dir}）はなれています`;
}
function routeTo(id, quiet) {
  const p = M.map.pois.find(x => x.id === id); if (!p) return;
  const g = M.gps;
  if (!g.on || !g.pos) { if (!g.on) { M.pendingRoute = id; gpsToggle(); toast('現在地をオンにして、道すじを表示します', { ms: 2600 }); } return; }
  if (!g.inside) { if (!quiet) toast(`いまの場所は、このマップから約${fmtM(g.far)}はなれています。Googleマップで行き方を調べられます`, { ms: 4200 }); return; }
  const d = dist2(g.pos.x, g.pos.y, p.x, p.y); M.routeId = id; M.V.route = [[g.pos.x, g.pos.y], [p.x, p.y]]; M.V.render();
  if (!quiet) { if (p.f && M.V.R.floors.length > 1) M.V.setFloor(p.f); banner(`${p.n}まで：直線で約${fmtM(d)}（${compass8(p.x - g.pos.x, p.y - g.pos.y)}の方向・${walkMin(d)}）${p.f ? ` ・ ${floorShort(p.f)}` : ''}`); }
}
function banner(t) {
  const b = $('.mm-banner', M.el); if (!b) return; b.className = 'mm-banner'; b.innerHTML = `<span>${ic('route', 'sm')}</span><span>${esc(t)}</span><button data-m="notex" aria-label="閉じる">${ic('x', 'sm')}</button>`; b.hidden = false; clearTimeout(M.bannerT); M.bannerT = setTimeout(() => { b.hidden = true; layout(); }, 12000);
}
function gmapsUrl(p) {
  const m = M.map;
  if (p) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.n + ' ' + m.name)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.name + (m.addr ? ' ' + m.addr : ''))}`;
}

/* ---------- 編集（自分のマップだけ）---------- */
function floorOptions(sel) { const R = M.V.R; return `<option value="">屋外（建物の外）</option>` + (M.map.bldgs || []).flatMap(b => (b.fl || []).map(f => `<option value="${esc(b.id + '|' + f)}" ${sel === b.id + '|' + f ? 'selected' : ''}>${esc(floorShort(f))}${(M.map.bldgs || []).length > 1 ? ' ' + esc(b.n || '') : ''}</option>`)).join('') + (void R, '');
}
const catOptions = sel => Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(v.n)}</option>`).join('');
async function editPoi(id) {
  const m = M.map, p = id ? m.pois.find(x => x.id === id) : null; if (m.sample) { toast('見本は編集できません。「情報」から、コピーして自分のマップにできます'); return; }
  const v = await dialog({
    title: p ? 'スポットを編集' : 'スポットを追加', cls: 'mm-dlg',
    body: `<div class="mm-fm"><label class="field"><span>名前</span><input name="n" value="${esc(p ? p.n : '')}" maxlength="60" autofocus></label><label class="field"><span>種類</span><select name="c">${catOptions(p ? p.c : 'shop')}</select></label><label class="field"><span>場所（階）</span><select name="f">${floorOptions(p && p.b && p.f ? p.b + '|' + p.f : (M.V.floor && (m.bldgs || []).length && !p ? ((m.bldgs[0] && m.bldgs[0].id) + '|' + M.V.floor) : ''))}</select></label><label class="field"><span>説明</span><textarea name="ds" rows="2" maxlength="200">${esc(p ? p.ds || '' : '')}</textarea></label><label class="field"><span>営業時間</span><input name="hrs" value="${esc(p ? p.hrs || '' : '')}" maxlength="80"></label></div>`,
    actions: [...(p ? [{ label: '削除', danger: true, value: 'del' }] : []), { label: 'キャンセル', value: null }, ...(p ? [{ label: '位置を動かす', value: n => ({ k: 'move', d: formData(n) }) }] : []), { label: p ? '保存' : '地図で場所を決める', primary: true, value: n => { const d = formData(n); if (!d.n.trim()) { toast('名前を入れてください', { err: true }); return false; } return { k: 'ok', d }; } }],
  });
  if (!v) return;
  if (v === 'del') { if (!(await confirmBox('このスポットを削除しますか？', `「${esc(p.n)}」をマップから消します。`, '削除する', true))) return; m.pois = m.pois.filter(x => x.id !== p.id); if (M.sel === p.id) M.sel = null; await afterEdit(); toast('削除しました'); return; }
  const d = v.d; if (!d.n.trim()) return;
  if (p) { applyForm(p, d); await afterEdit(); if (v.k === 'move') startPlace({ id: p.id }); else toast('保存しました'); }
  else startPlace({ nw: d });
}
const formData = n => ({ n: $('[name=n]', n).value, c: $('[name=c]', n).value, f: $('[name=f]', n).value, ds: $('[name=ds]', n).value, hrs: $('[name=hrs]', n).value });
function applyForm(p, d) {
  p.n = d.n.trim().slice(0, 60); p.c = CATS[d.c] ? d.c : p.c; p.ds = d.ds.trim().slice(0, 200) || undefined; p.hrs = d.hrs.trim().slice(0, 80) || undefined; p.u = 1;
  if (!p.ds) delete p.ds; if (!p.hrs) delete p.hrs;
  if (d.f) { const [b, f] = d.f.split('|'); if (b !== p.b || f !== p.f) { p.b = b; p.f = f; delete p.z; const bd = (M.map.bldgs || []).find(x => x.id === b); if (bd && !inPoly(p.x, p.y, bd.ring)) { const c = polyCentroid(bd.ring); p.x = r1(c[0]); p.y = r1(c[1]); p.ps = 'user'; } } }
  else if (p.b) { delete p.b; delete p.f; }
}
function startPlace(o) { M.place = o; banner('地図をタップして、場所を決めてください（やめる：Escキー・または「×」）'); M.el.classList.add('placing'); if (M.narrow) setSheet('peek'); }
function cancelPlace() { M.place = null; M.el.classList.remove('placing'); const b = $('.mm-banner', M.el); if (b) b.hidden = true; }
async function doPlace(w) {
  const m = M.map, pl = M.place; if (!pl) return; const x = r1(w[0]), y = r1(w[1]); cancelPlace();
  if (pl.id) { const p = m.pois.find(q => q.id === pl.id); if (!p) return; p.x = x; p.y = y; p.ps = 'user'; p.u = 1; delete p.ring; const b = p.b && (m.bldgs || []).find(bb => bb.id === p.b); if (b && !inPoly(x, y, b.ring)) { delete p.b; delete p.f; } await afterEdit(); select(p.id, { focus: false }); toast('位置を動かしました'); return; }
  const d = pl.nw, p = { id: 'u' + Date.now().toString(36), n: d.n.trim().slice(0, 60), c: CATS[d.c] ? d.c : 'shop', x, y, w: 8, l: 6, r: 0, src: 'user', ps: 'user', u: 1 };
  if (d.ds.trim()) p.ds = d.ds.trim().slice(0, 200); if (d.hrs.trim()) p.hrs = d.hrs.trim().slice(0, 80);
  if (d.f) { const [b, f] = d.f.split('|'); const bd = (m.bldgs || []).find(bb => bb.id === b); if (bd) { p.b = b; p.f = f; if (!inPoly(x, y, bd.ring)) { const c = polyCentroid(bd.ring); p.x = r1(c[0]); p.y = r1(c[1]); } } }
  m.pois.push(p); await afterEdit(); select(p.id, { focus: false }); toast('追加しました');
}
async function afterEdit() {
  const m = M.map; await Store.put(m); M.V.refresh(); paintChips(); paintFloors(); paintSpots(); paintCard(); paintInfo(); layout();
}
async function copySample() {
  const s = M.map; if (!s || !s.sample) return; const m = clone(s); m.id = uid('m'); m.sample = 0; m.name = s.name + '（コピー）'; m.created = Date.now(); delete m.cand;
  m.addr = m.addr.replace('（見本）', '') || '自分用のコピー'; m.info = Object.assign({}, m.info, { acc: 'sample' }); await Store.put(m); try { Store.putThumb(m.id, await makeThumb(m)); } catch (e) {}
  toast('コピーしました。スポットを追加・編集できます'); openMap(m.id);
}

/* ---------- 情報 ---------- */
function paintInfo() {
  const pane = $('.mm-pane[data-p=info]', M.el); if (!pane || !M.map) return;
  const m = M.map, i = m.info || {}, cnt = {}; for (const p of m.pois) { const g = catOf(p.c); cnt[p.c] = (cnt[p.c] || 0) + 1; void g; }
  const cats = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8), mx = Math.max(1, ...cats.map(x => x[1]));
  const st = i.st || {}, w = M.wx;
  let h = `<section class="mm-is"><h4>${esc(m.name)}</h4><p class="mm-sub">${esc(kindN(m.kind))}${m.addr ? ' ・ ' + esc(m.addr) : ''}</p>${i.sum ? `<p>${esc(i.sum)}</p>` : ''}</section>`;
  if (w && wxCoord()) h += `<section class="mm-is"><h4>いまの気温</h4><button class="mm-wxc" data-m="wx"><span>${Wx.label(w).em}</span><b>${Math.round(w.t)}<small>℃</small></b><span><strong>${esc(Wx.label(w).name)}</strong><small>体感${Math.round(w.feel)}℃ ・ 最高${Math.round(w.tmax)}℃／最低${Math.round(w.tmin)}℃ ・ 降水${w.pop != null ? Math.round(w.pop) : '—'}%</small>${m.sample ? '<small>（見本：東京の気温）</small>' : ''}</span></button></section>`;
  const rows = [['営業時間', i.hours], ['行き方', i.access]].filter(r => r[1]);
  if (rows.length || (i.web && /^https?:\/\//.test(i.web))) h += `<section class="mm-is"><h4>基本の情報</h4><dl class="mm-dl">${rows.map(r => `<div><dt>${r[0]}</dt><dd>${esc(r[1])}</dd></div>`).join('')}${i.web && /^https?:\/\//.test(i.web) ? `<div><dt>公式サイト</dt><dd><a href="${esc(i.web)}" target="_blank" rel="noopener">${esc(i.web.replace(/^https?:\/\//, '').slice(0, 40))}</a></dd></div>` : ''}</dl></section>`;
  if ((i.tips || []).length) h += `<section class="mm-is"><h4>ひとこと</h4><ul class="mm-ul">${i.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`;
  h += `<section class="mm-is"><h4>スポットの内訳<small>${m.pois.length}件</small></h4><div class="mm-bars">${cats.map(([c, n]) => `<div><span>${esc(catOf(c).n)}</span><i style="--w:${Math.round(100 * n / mx)}%;--c:${catOf(c).c}"></i><b>${n}</b></div>`).join('')}</div></section>`;
  h += `<section class="mm-is mm-data"><h4>このマップのデータについて</h4><p class="mm-hint">${esc(accLabel(i.acc) || '')}</p><ul class="mm-ul">`;
  if (m.sample) h += '<li>これは見本です。実在しない場所の、架空のデータです。</li>';
  else {
    h += '<li>建物・道路・水・緑・駐車場のかたちと、外の位置は<b>OpenStreetMap</b>の実際のデータです。</li>';
    h += `<li>お店・アトラクションの一覧は${i.ai ? (i.search ? '<b>AIがネットで調べた</b>情報' : '<b>AIの知識</b>') : 'OpenStreetMapにのっているもの'}です。古い・まちがいがあることもあります。</li>`;
    h += '<li>建物の中の店の並びは、<b>見取り図の目安</b>です。実際の位置とは違うことがあります。</li>';
    if (st.total) h += `<li>内訳：OpenStreetMapと一致 ${st.both || 0}件 ／ AIの情報 ${st.ai || 0}件 ／ OpenStreetMapのみ ${st.osm || 0}件</li>`;
    if (i.notes) h += `<li>調べきれなかったこと：${esc(i.notes)}</li>`;
    if (i.made) h += `<li>作った日：${esc(fmtDate(i.made))}（最新にするには「作り直す」）</li>`;
  }
  h += '</ul></section>';
  h += `<section class="mm-is mm-acts">${m.sample ? `<button class="btn" data-m="copy">${ic('copy')}コピーして自分のマップにする</button>` : `<button class="btn" data-m="remake">${ic('refresh')}最新の情報で作り直す</button><button class="btn" data-m="export">${ic('download')}ファイルに書き出す</button>`}${m.ll && !m.sample ? `<button class="btn" data-m="gmap">${ic('map')}Googleマップで開く</button>` : ''}<p class="mm-hint">現在地をオンにして、チャットやLIVEでAIに話しかけると、AIにもこのマップの中での現在地が伝わります。</p></section>`;
  pane.innerHTML = h;
}
