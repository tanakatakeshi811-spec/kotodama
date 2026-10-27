
/* ---------- 操作のつなぎ込み（クリック・入力・キー） ---------- */
const selPoi = () => (M.sel && M.map ? M.map.pois.find(x => x.id === M.sel) : null);
function hideDrop() { const d = $('.mm-sr', M.el); if (d && !d.hidden) d.hidden = true; }
function tapMap(id, w) {
  if (M.place) { doPlace(w); return; }
  hideDrop();
  if (id) { select(id, { focus: false, scroll: true }); }
  else if (M.sel) select(null);
  else if (M.narrow && M.sheet !== 'peek') setSheet('peek');
}
function stepFloor(d) {
  const fl = M.V.R.floors; if (fl.length < 2) return;
  const i = fl.findIndex(f => f.id === M.V.floor); M.V.setFloor(fl[clamp(i + d, 0, fl.length - 1)].id);
}

function viewMenu(btn) {
  const m = M.map, sm = !!m.sample;
  menu(btn, [
    ...(sm ? [{ icon: 'copy', label: 'コピーして自分のマップにする', sub: '見本を編集できるようにします', run: copySample }] : [
      { icon: 'plus', label: 'スポットを追加', run: () => editPoi(null) },
      { icon: 'edit', label: 'マップの名前を変える', run: renameMap },
      { icon: 'refresh', label: '最新の情報で作り直す', sub: '同じ場所をもう一度調べます', run: () => remake(m.id) },
      { icon: 'download', label: 'ファイルに書き出す', run: () => exportOne(m.id) },
    ]),
    { icon: 'image', label: 'いまの画面を画像で保存', run: saveShot },
    { icon: 'camera', label: 'AIにマップの画面を見せる', sub: M.shotOn ? 'オン：質問やLIVEのたびに画面も送ります' : 'オフ：画面は送りません', on: M.shotOn, run: () => { M.shotOn = !M.shotOn; const c = $('input[data-m=shotck]', M.el); if (c) c.checked = M.shotOn; toast(M.shotOn ? 'AIにマップの画面も見せます' : 'マップの画面は送りません', { ms: 2000 }); } },
    ...(m.ll && !sm ? [{ icon: 'map', label: 'Googleマップで開く', run: () => window.open(gmapsUrl(null), '_blank', 'noopener') }] : []),
    ...(MC.chat ? ['-', { icon: 'compose', label: 'AIとの会話をチャット画面で開く', run: () => MC.openInChat() }, { icon: 'refresh', label: 'AIとの会話を新しくする', run: () => MC.fresh() }] : []),
    ...(sm ? [] : ['-', { icon: 'trash', label: 'このマップを削除', danger: true, run: delMap }]),
  ], { align: 'right' });
}
async function renameMap() {
  const m = M.map; const v = await promptBox('マップの名前', m.name, { label: '名前', ok: '変更' }); if (!v || !v.trim()) return;
  m.name = v.trim().slice(0, 60); await Store.put(m); paintHead(); paintInfo();
}
async function delMap() {
  const m = M.map; if (!m || m.sample) return;
  if (!(await confirmBox('このマップを削除しますか？', `「${esc(m.name)}」を削除します。元に戻せません。`, '削除する', true))) return;
  await Store.del(m.id); try { LS.del('mmchat:' + m.id); } catch (e) {} toast('削除しました'); closeGps(); showScreen('lib'); renderLib();
}
async function saveShot() {
  const V = M.V; if (!V || !V.map) return;
  const cv = V.snapshot(V.W, V.H, { useView: true, dpr: Math.min(2, devicePixelRatio || 1) });
  const b = await canvasBlob(cv, 'image/png'); if (b) saveOut(`map-${safeName(M.map.name)}.png`, b);
}

const ACTS = {
  close: () => close(),
  back: () => { closeGps(); cancelPlace(); showScreen('lib'); renderLib(); },
  new: () => openCreate(),
  openmap: b => openMap(b.dataset.id),
  libmenu: b => libMenu(b, b.dataset.id),
  import: () => importFile(),
  wx: () => wxDetail(),
  more: b => viewMenu(b),
  d2: () => M.V.setMode(false),
  d3: () => M.V.setMode(true),
  chip: b => { M.filter = b.dataset.g; M.V.setFilter(M.filter); M.listN = 90; paintChips(); paintSpots(); },
  floor: b => M.V.setFloor(b.dataset.f),
  zin: () => M.V.zoomBy(1.45),
  zout: () => M.V.zoomBy(1 / 1.45),
  rotl: () => M.V.rotateBy(-0.35),
  rotr: () => M.V.rotateBy(0.35),
  north: () => M.V.resetNorth(),
  fit: () => M.V.fit(true),
  gps: () => gpsToggle(),
  grab: () => { if (M.dragged) return; setSheet(M.sheet === 'peek' ? 'half' : M.sheet === 'half' ? 'full' : 'peek'); },
  tab: b => setTab(b.dataset.t),
  pick: b => {
    if (b.closest('.mm-sr')) { hideDrop(); if (COARSE) { const i = $('input[data-m=q]', M.el); if (i) i.blur(); } }
    select(b.dataset.id, { focus: true });
  },
  selx: () => select(null),
  route: () => { if (M.sel) routeTo(M.sel); },
  askp: () => { const p = selPoi(); if (p) askAI(`「${p.n}」について教えてください。どんな${catOf(p.c).n}で、どのあたりにありますか？${M.gps.on && M.gps.inside ? 'いまの場所からの行き方も教えてください。' : ''}`); },
  askq: () => { const q = M.q.trim(); hideDrop(); askAI(q ? `マップで「${q}」を探しています。このマップのどのあたりにありますか？載っていなければ、近いものを教えてください。` : 'このマップのみどころを教えてください。'); },
  gmap: () => { const p = selPoi(); window.open(gmapsUrl(p), '_blank', 'noopener'); },
  editp: () => { if (M.sel) editPoi(M.sel); },
  add: () => editPoi(null),
  'more-list': () => { M.listN += 120; paintSpots(); },
  notex: () => { const b = $('.mm-banner', M.el); if (b) { b.hidden = true; if (b.classList.contains('note') && M.map) try { LS.set('mmnote:' + M.map.id, true); } catch (e) {} } clearTimeout(M.bannerT); layout(); },
  remake: () => remake(M.map.id),
  export: () => exportOne(M.map.id),
  copy: () => copySample(),
  sclear: () => { clearSearch(); const i = $('input[data-m=q]', M.el); if (i) i.focus(); },
  'ai-live': () => startLive(),
  'ai-stop': () => stopGen(),
  'ai-q': b => askAI(b.dataset.q),
  'ai-pin': b => { applyTag(b.dataset.k, b.dataset.q); if (M.narrow && M.sheet !== 'peek') setSheet('peek'); },
  'ai-retry': b => MC.retry(b.dataset.id),
};
function onClick(e) {
  const t = e.target, b = t.closest('[data-m]');
  if (!t.closest('.mm-search')) hideDrop();
  if (!b || !M.el.contains(b)) return;
  const fn = ACTS[b.dataset.m]; if (fn) fn(b, e);
}
function onInput(e) {
  const t = e.target, k = t.dataset && t.dataset.m;
  if (k === 'q') searchDeb(t.value);
  else if (k === 'libq') { M.libQ = t.value; libDeb(); }
  else if (k === 'aiin') { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 120) + 'px'; }
}
const searchDeb = debounce(v => { if (M.V && M.map) searchInput(v); }, 110);
const libDeb = debounce(async () => {
  const had = doc.activeElement && doc.activeElement.dataset && doc.activeElement.dataset.m === 'libq';
  await renderLib();
  if (had) { const i = $('input[data-m=libq]', M.el); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
}, 160);
function onChange(e) { const t = e.target; if (t.dataset && t.dataset.m === 'shotck') M.shotOn = !!t.checked; }
function onSubmit(e) { if (e.target.dataset && e.target.dataset.f === 'ai') { e.preventDefault(); sendFromInput(); } }
function onKey(e) {
  const t = e.target; if (!t.matches) return;
  if (t.matches('input[data-m=q]')) {
    if (e.key === 'Enter') { e.preventDefault(); const r = M.hitList && M.hitList[0]; if (r) { select(r.p.id, { focus: true }); hideDrop(); if (COARSE) t.blur(); } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (t.value) clearSearch(); else t.blur(); }
    else if (e.key === 'ArrowDown') { const f = $('.mm-sri', M.el); if (f) { e.preventDefault(); f.focus(); } }
    return;
  }
  if (t.matches('.mm-sri')) {
    if (e.key === 'ArrowDown') { e.preventDefault(); const n = t.nextElementSibling; if (n && n.matches('.mm-sri')) n.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const p = t.previousElementSibling; if (p && p.matches('.mm-sri')) p.focus(); else { const i = $('input[data-m=q]', M.el); if (i) i.focus(); } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideDrop(); const i = $('input[data-m=q]', M.el); if (i) i.focus(); }
    return;
  }
  if (t.matches('textarea[data-m=aiin]')) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && (SET.enterSend || e.ctrlKey || e.metaKey)) { e.preventDefault(); sendFromInput(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); t.blur(); }
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && t.matches('.mm-lc, .mm-grp h4[role=button]')) { e.preventDefault(); t.click(); }
}
function mmGlobalKey(ev) {
  if (M.docked && !M.el.contains(ev.target)) return;
  const t = ev.target, typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || (t && t.isContentEditable);
  if (ev.key === 'Escape') {
    if (M.place) { ev.preventDefault(); ev.stopPropagation(); cancelPlace(); return; }
    if (typing) return;
    if (M.screen === 'view' && M.sel) { ev.preventDefault(); ev.stopPropagation(); select(null); return; }
    if (M.docked) return;
    ev.preventDefault(); ev.stopPropagation();
    if (M.screen === 'view') { closeGps(); showScreen('lib'); renderLib(); } else close();
    return;
  }
  if (typing || ev.ctrlKey || ev.metaKey || ev.altKey || M.screen !== 'view' || !M.V) return;
  const k = ev.key;
  if (k === '+' || k === '=') M.V.zoomBy(1.4);
  else if (k === '-' || k === '_') M.V.zoomBy(1 / 1.4);
  else if (k === '2') M.V.setMode(false);
  else if (k === '3') M.V.setMode(true);
  else if (k === '0' || k === 'f' || k === 'F') M.V.fit(true);
  else if (k === 'n' || k === 'N') M.V.resetNorth();
  else if (k === 'ArrowLeft' && ev.shiftKey) M.V.rotateBy(-0.2);
  else if (k === 'ArrowRight' && ev.shiftKey) M.V.rotateBy(0.2);
  else if (k === '/') { const i = $('input[data-m=q]', M.el); if (i) i.focus(); }
  else if (k === '[' || k === ']') stepFloor(k === ']' ? 1 : -1);
  else return;
  ev.preventDefault();
}
/* 下のシート（せまい画面）：つまみをドラッグして 小／中／大 */
function bindExtra() {
  const g = $('.mm-grab', M.el), side = $('.mm-side', M.el); let d = null;
  g.addEventListener('pointerdown', e => {
    if (!M.narrow) return; try { g.setPointerCapture(e.pointerId); } catch (er) {}
    const hs = sheetHeights(); d = { y: e.clientY, h0: parseFloat(M.el.style.getPropertyValue('--mm-sh')) || hs.peek, t: performance.now(), moved: false, hs };
  });
  g.addEventListener('pointermove', e => {
    if (!d) return; const dy = e.clientY - d.y; if (Math.abs(dy) > 5) d.moved = true; if (!d.moved) return;
    M.el.style.setProperty('--mm-sh', clamp(d.h0 - dy, d.hs.peek, d.hs.full) + 'px'); side.classList.add('drag');
  });
  const end = e => {
    if (!d) return; const q = d; d = null; side.classList.remove('drag'); if (!q.moved) return;
    M.dragged = true; setTimeout(() => { M.dragged = false; }, 60);
    const dy = e.clientY - q.y, v = dy / Math.max(1, performance.now() - q.t), cur = clamp(q.h0 - dy, q.hs.peek, q.hs.full);
    let best = 'peek', bd = 1e9; for (const k of ['peek', 'half', 'full']) { const dd = Math.abs(q.hs[k] - (cur - v * 140)); if (dd < bd) { bd = dd; best = k; } }
    setSheet(best);
  };
  g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  M.el.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('input[data-m=q]') && M.q.trim() && M.hitList) { const dd = $('.mm-sr', M.el); if (dd && dd.innerHTML) dd.hidden = false; } });
}

/* ---------- AIとのチャット（このマップ専用の会話） ---------- */
const MAP_TAG_SRC = '\\[\\[(マップ階|マップ表示|マップ案内|マップ絞込|マップ)[:：]\\s*([^\\]]+?)\\s*\\]\\]';
function mapTags(raw) {
  const out = [], seen = new Set();
  for (const m of String(raw || '').matchAll(new RegExp(MAP_TAG_SRC, 'g'))) { if (m[1] !== 'マップ' && m[1] !== 'マップ案内') continue; const k = m[1] + m[2]; if (!seen.has(k)) { seen.add(k); out.push([m[1], m[2]]); } }
  return out.slice(0, 8);
}
function findPoi(name) {
  const m = M.map, k = nameKey(name); if (!m || !k) return null;
  let best = null, bs = 0;
  for (const p of m.pois) {
    const pk = nameKey(p.n); if (!pk) continue; let s = 0;
    if (pk === k) s = 100;
    else if (pk.startsWith(k) || k.startsWith(pk)) s = 80 - Math.abs(pk.length - k.length) * 0.5;
    else if (pk.includes(k) || k.includes(pk)) s = 60 - Math.abs(pk.length - k.length) * 0.3;
    else { const sim = nameSim(pk, k); if (sim >= 0.6) s = 40 * sim; }
    if (s > bs) { bs = s; best = p; }
  }
  return bs >= 30 ? best : null;
}
function applyTag(kind, arg) {
  if (!M.map || !M.V || M.screen !== 'view' || !M.on) return false;
  arg = String(arg || '').trim();
  if (kind === 'マップ' || kind === 'マップ案内') {
    const p = findPoi(arg); if (!p) { toast(`「${arg}」はマップで見つかりませんでした`, { ms: 2600 }); return false; }
    select(p.id, { focus: true });
    if (kind === 'マップ案内') { if (M.gps.on && M.gps.pos) routeTo(p.id); else banner(`${p.n}はここです。「現在地」をオンにすると、現在地からの道すじも出せます`); }
    return true;
  }
  if (kind === 'マップ階') { const f = normFloor(arg); if (f && M.V.R.fidx.has(f)) { M.V.setFloor(f); return true; } return false; }
  if (kind === 'マップ表示') {
    const is3 = /3|３|立体/.test(arg), is2 = /2|２|平面|地図/.test(arg);
    if (is3 && !is2) M.V.setMode(true); else if (is2 && !is3) M.V.setMode(false); return true;
  }
  if (kind === 'マップ絞込') {
    const g = /すべて|全部|解除|全て/.test(arg) ? GROUPS[0] : GROUPS.find(x => x.n === arg || x.id === arg || (arg.length >= 2 && (x.n.includes(arg) || arg.includes(x.n))));
    if (g) { M.filter = g.id; M.V.setFilter(g.id); paintChips(); M.listN = 90; paintSpots(); } return !!g;
  }
  return false;
}
function applyTagsFrom(raw, key) {
  for (const m of String(raw || '').matchAll(new RegExp(MAP_TAG_SRC, 'g'))) {
    const k = key + ':' + m.index + ':' + m[0]; if (M.tagSeen.has(k)) continue; M.tagSeen.add(k); applyTag(m[1], m[2]);
  }
}
async function fromTag(kind, name) {
  const id = (S.view && S.view.mapId) || (M.map && M.map.id); if (!id) return;
  if (!(M.on && M.map && M.map.id === id && M.screen === 'view')) { await open({ id }); await sleep(250); }
  applyTag(kind, name);
}

const QUICK = {
  mall: ['おすすめのお店は？', 'トイレはどこ？', 'フードコートはある？', '子ども連れで楽しめる所は？', '2時間でまわるコースを作って'],
  park: ['人気のアトラクションは？', '午前中のまわり方を考えて', '子ども向けのアトラクションは？', 'ごはんが食べられる場所は？', '雨の日の過ごし方は？'],
  store: ['おすすめの売り場は？', 'フードコートはどこ？', '効率のいい回り方を教えて', 'トイレはどこ？'],
  station: ['乗り換えのコツは？', 'お土産が買える店は？', 'トイレはどこ？'],
  campus: ['見どころはどこ？', 'ごはんが食べられる所は？', 'おすすめの回り方は？'],
  other: ['ここのみどころは？', 'トイレはどこ？', 'ごはんが食べられる所は？', '回り方を教えて'],
};
function quickList() {
  const a = [], p = selPoi();
  if (p) a.push(`「${p.n}」について教えて`);
  if (M.gps.on && M.gps.inside) a.push('いまの場所から近いお店は？');
  a.push(...(QUICK[M.map.kind] || QUICK.other));
  return a.slice(0, 6);
}
function aiShell() {
  return `<div class="mm-log" role="log" aria-live="polite"></div>
  <div class="mm-quick" aria-label="質問の例"></div>
  <form class="mm-aif" data-f="ai" autocomplete="off">
    <div class="mm-aio"><label class="mm-ck sm"><input type="checkbox" data-m="shotck" ${M.shotOn ? 'checked' : ''}><span>マップの画面もAIに見せる</span></label><button type="button" class="btn sm" data-m="ai-live">${ic('wave')}LIVEで話す</button></div>
    <div class="mm-air"><textarea data-m="aiin" rows="1" placeholder="このマップのことをAIに聞く" aria-label="AIへの質問" enterkeyhint="${SET.enterSend ? 'send' : 'enter'}"></textarea><button class="mm-send" type="submit" data-m="ai-send" aria-label="送信">${ic('send')}</button></div>
  </form>`;
}
function renderMsgs() {
  const pane = $('.mm-pane[data-p=ai]', M.el); if (!pane || !M.map) return;
  if (pane.dataset.k !== M.map.id) { pane.dataset.k = M.map.id; pane.innerHTML = aiShell(); }
  const log = $('.mm-log', pane), c = MC.chat; if (!log) return;
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  const busyId = S.busy && c && S.busy.chatId === c.id ? S.busy.msgId : '';
  const ms = c ? c.msgs.slice(-60) : [];
  let h = '';
  if (!ms.length) h = `<div class="mm-aiw"><b>${ic('sparkle')}このマップを見ながら、AIに聞けます</b><p>お店の場所・おすすめ・回り方などを聞いてみてください。いま見ているマップの画面も、いっしょにAIへ送られます。声で話したいときは「LIVEで話す」を押してください。</p></div>`;
  for (const m of ms) {
    if (m.role === 'user') { h += `<div class="mm-m u"><div class="bubble">${esc(m.text || '')}</div>${m.mapShot ? `<small>${ic('image', 'sm')}マップの画面つき</small>` : ''}</div>`; continue; }
    const a = curAlt(m) || {}, busy = m.id === busyId, text = cleanAI(a.text || '');
    let body = '';
    if (text) body = `<div class="md">${MD.render(text, { streaming: busy })}</div>`;
    else if (busy) body = `<div class="waiting"><span class="dots"><i></i><i></i><i></i></span><span>${a.stage ? esc(a.stage) + 'をしています' : '考えています'}…</span></div>`;
    if (!busy) {
      if (a.err) body += `<div class="m-err">${ic('alert')}<p>${esc((a.err && a.err.msg) || 'うまくいきませんでした')}</p><button class="btn sm" data-m="ai-retry" data-id="${esc(m.id)}">もう一度</button></div>`;
      if (a.stopped) body += '<p class="m-stop">（途中で止めました）</p>';
      const tg = mapTags(a.text); if (tg.length) body += `<div class="mm-tg2">${tg.map(([k, n]) => `<button class="chip" data-m="ai-pin" data-k="${esc(k)}" data-q="${esc(n)}">${ic(k === 'マップ案内' ? 'route' : 'locate')}${esc(n)}${k === 'マップ案内' ? 'への道すじ' : 'を見る'}</button>`).join('')}</div>`;
    }
    h += `<div class="mm-m a${busy ? ' busy' : ''}" data-id="${esc(m.id)}"><div class="mm-ab">${body || '<span class="mm-dim">（空の回答）</span>'}</div></div>`;
  }
  log.innerHTML = h;
  try { hydrate(log); } catch (e) {}
  if (near || busyId) log.scrollTop = log.scrollHeight;
  const q = $('.mm-quick', pane);
  if (q) q.innerHTML = quickList().map(t => `<button type="button" class="chip" data-m="ai-q" data-q="${esc(t)}">${esc(t)}</button>`).join('');
  const sb = $('.mm-send', pane);
  if (sb) { sb.dataset.m = busyId ? 'ai-stop' : 'ai-send'; sb.type = busyId ? 'button' : 'submit'; sb.innerHTML = ic(busyId ? 'stop' : 'send'); sb.setAttribute('aria-label', busyId ? '止める' : '送信'); sb.classList.toggle('stop', !!busyId); }
  if (MC.applyId && c) {
    const am = c.msgs.find(x => x.id === MC.applyId);
    if (am) applyTagsFrom((curAlt(am) || {}).text || '', am.id);
    if (!busyId) MC.applyId = '';
  }
}
const kick = rafThrottle(() => { if (M.on && M.map) renderMsgs(); }, 60);
function sendFromInput() {
  const ta = $('textarea[data-m=aiin]', M.el); if (!ta) return; const t = ta.value.trim(); if (!t) return;
  ta.value = ''; ta.style.height = 'auto';
  MC.send(t).then(ok => { if (!ok && !ta.value) ta.value = t; });
}
function askAI(q) {
  if (M.docked) { if (typeof Live !== 'undefined' && Live.on) Live.send(q); return; }
  setTab('ai'); MC.send(q);
}
const MC = {
  chat: null, applyId: '', tm: 0,
  async load() {
    const id = M.map && M.map.id; if (!id) return; this.chat = null;
    let cid = ''; try { cid = LS.get('mmchat:' + id, ''); } catch (e) {}
    if (cid) { try { const c = await getChat(cid); if (c && c.mapId === id) this.chat = c; } catch (e) {} }
    if (M.map && M.map.id === id) renderMsgs();
  },
  async ensure() {
    const m = M.map;
    if (!this.chat) { const c = newChatObj(); c.mapId = m.id; c.title = 'マップ：' + m.name.slice(0, 30); S.chats.set(c.id, c); this.chat = c; try { LS.set('mmchat:' + m.id, c.id); } catch (e) {} }
    if (S.view !== this.chat) { try { saveDraft.flush(); } catch (e) {} setView(this.chat); }
    return this.chat;
  },
  async send(text) {
    text = String(text || '').trim(); if (!text || !M.map) return false;
    if (S.busy) { toast(this.chat && S.busy.chatId === this.chat.id ? '回答中です。終わるまで待つか、止めてください' : 'ほかのチャットで回答中です', { ms: 2600 }); return false; }
    if (!engineReady()) { showEngineHelp(); return false; }
    const c = await this.ensure();
    let images = [], label = '';
    if (M.shotOn && (Engine.kind === 'api' || Engine.imgMax > 0)) { try { const b = await shotBlob(); if (b) { images = [b]; label = shotLabel(); } } catch (e) {} }
    M.tagSeen = new Set();
    const before = c.msgs.length;
    const run = sendMessage(text, [], { images, imgLabel: label, onUpdate: kick, onDone: kick });
    if (c.msgs.length === before + 2) { const um = c.msgs[before], am = c.msgs[before + 1]; if (images.length) um.mapShot = 1; this.applyId = am.id; }
    renderMsgs(); this.watch();
    Promise.resolve(run).then(() => renderMsgs()).catch(() => renderMsgs());
    return true;
  },
  watch() {
    if (this.tm) return;
    this.tm = setInterval(() => {
      renderMsgs();
      if (!(S.busy && this.chat && S.busy.chatId === this.chat.id)) { clearInterval(this.tm); this.tm = 0; renderMsgs(); }
    }, 150);
  },
  retry(id) {
    const c = this.chat; if (!c) return; const am = c.msgs.find(x => x.id === id); if (!am) return;
    if (S.busy) { toast('回答中です'); return; }
    if (!engineReady()) { showEngineHelp(); return; }
    M.tagSeen = new Set(); this.applyId = am.id;
    retry(c, am); renderMsgs(); this.watch();
  },
  async fresh() {
    if (!(await confirmBox('AIとの会話を新しくしますか？', 'このマップでのこれまでの会話は、チャット一覧に残ります。', '新しくする'))) return;
    this.chat = null; try { LS.del('mmchat:' + M.map.id); } catch (e) {} renderMsgs();
  },
  openInChat() {
    const c = this.chat; if (!c) return; close(); setView(c);
  },
};
async function shotBlob() {
  const V = M.V, sc = Math.min(1, 1100 / Math.max(V.W, V.H)), cv = V.snapshot(V.W, V.H, { useView: true, dpr: sc });
  return canvasBlob(cv, 'image/jpeg', 0.82);
}
function shotLabel() {
  const V = M.V, p = selPoi();
  return `ユーザーがいま見ているマップ「${M.map.name}」の画面（${V.is3d() ? '3D' : '2D'}表示${V.R.floors.length > 1 ? '、' + V.floor + 'を表示中' : ''}${p ? '、選択中：' + p.n : ''}）`;
}

/* ---------- AIに渡すマップの情報（system に足す） ---------- */
const poiLine = p => {
  const bl = M.map.bldgs || [], b = bl.find(x => x.id === p.b);
  return `${p.n}（${catOf(p.c).n}${p.b && p.f ? '、' + floorShort(p.f) + (bl.length > 1 && b ? ' ' + b.n : '') : ''}${p.ds ? '、' + p.ds.slice(0, 60) : ''}${p.hrs ? '、' + p.hrs : ''}）`;
};
const PROMPT_ORDER = ['ride', 'show', 'play', 'wc', 'gate', 'facility', 'service', 'parking', 'food', 'cafe', 'shop', 'goods', 'fashion', 'grocery', 'other'];
function spotListLines(m, budget) {
  const bl = m.bldgs || [], zn = new Map((m.zones || []).map(z => [z.id, z.n]));
  const pri = c => { const i = PROMPT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
  const sorted = m.pois.slice().sort((a, b) => pri(a.c) - pri(b.c));
  const item = p => `${p.n}(${catOf(p.c).n})`;
  let used = 0; const pick = [];
  for (const p of sorted) { const w = item(p).length + 1; if (used + w > budget) break; used += w; pick.push(p); }
  const groups = new Map();
  for (const p of pick) {
    let key, title, ord;
    if (p.b && p.f) { const bi = bl.findIndex(b => b.id === p.b); key = p.b + '|' + p.f; title = (bl.length > 1 && bl[bi] ? (bl[bi].n || '建物') + ' ' : '') + floorShort(p.f); ord = Math.max(0, bi) * 1000 + floorLv(p.f) + 50; }
    else if (p.z && zn.has(p.z)) { key = 'z|' + p.z; title = zn.get(p.z); ord = 100000 + (m.zones || []).findIndex(z => z.id === p.z); }
    else { key = 'out'; title = bl.length ? '建物の外' : 'そのほか'; ord = 200000; }
    let g = groups.get(key); if (!g) groups.set(key, g = { title, ord, items: [] }); g.items.push(p);
  }
  const lines = [...groups.values()].sort((a, b) => a.ord - b.ord).map(g => `${g.title}：${g.items.map(item).join('、')}`);
  if (pick.length < m.pois.length) lines.push(`（ほか${m.pois.length - pick.length}件は長いため省略）`);
  return lines;
}
function ctxMap(chat) {
  if (M.docked) return M.map;
  if (!chat || !chat.mapId) return null;
  if (M.map && M.map.id === chat.mapId) return M.map;
  if (M.ctxMap && M.ctxMap.id === chat.mapId) return M.ctxMap;
  return null;
}
async function preload(chat) {
  if (!chat || !chat.mapId) return;
  if ((M.map && M.map.id === chat.mapId) || (M.ctxMap && M.ctxMap.id === chat.mapId)) return;
  try { const m = /^sample-/.test(chat.mapId) ? Samples.get(chat.mapId) : await Store.get(chat.mapId); if (m) M.ctxMap = m; } catch (e) {}
}
function promptLines(chat, live) {
  const m = ctxMap(chat); if (!m || !Array.isArray(m.pois)) return [];
  const viewing = m === M.map && M.V && M.V.map === m && M.V.R, V = M.V, i = m.info || {}, L = [];
  L.push('【いま開いているマップ（コトダマの「マップ制作」）】');
  L.push(`ユーザーは、コトダマのマップ制作で作った次のマップを${viewing && M.on ? 'いま画面で見ています' : 'さっきまで見ていました（いまは閉じているかもしれません）'}。マップの中のことを聞かれたら、このマップの情報をもとに答えてください。`);
  L.push(`・マップ名：${m.name}（${kindN(m.kind)}）${m.sample ? '　※コトダマに入っている見本で、実在しない架空の場所です' : ''}`);
  if (m.addr && !m.sample) L.push(`・場所：${m.addr}`);
  if (viewing && M.wx) L.push(`・いまの天気（${m.sample ? '見本のため東京の' : 'このマップの場所の'}天気）：${Wx.line(M.wx)}`);
  if (i.sum) L.push(`・概要：${i.sum}`);
  if (i.hours) L.push(`・営業時間：${i.hours}`);
  if (i.access) L.push(`・行き方：${i.access}`);
  if (viewing) {
    const fl = V.R.floors.map(f => f.id);
    L.push(`・画面の表示：${V.is3d() ? '3D' : '2D'}${fl.length > 1 ? `、見ている階：${V.floor}（階は ${fl.join('・')}）` : ''}${M.filter !== 'all' ? `、絞りこみ：${(GROUPS.find(g => g.id === M.filter) || {}).n}` : ''}${M.q.trim() ? `、検索中：「${M.q.trim()}」` : ''}`);
    const p = selPoi(); if (p) L.push(`・いま選んでいるスポット：${poiLine(p)}`);
    const g = M.gps;
    if (g.on && g.pos) {
      if (g.inside) { const nr = nearSpots(4); L.push(`・ユーザーの現在地：このマップの中にいます（誤差およそ${Math.round(g.pos.acc)}m。何階にいるかは端末ではわかりません）。${nr.length ? '近いスポット：' + nr.map(x => `${x.p.n}（約${fmtM(x.d)}）`).join('、') : ''}`); }
      else L.push(`・ユーザーの現在地：このマップから約${fmtM(g.far)}（${g.dir}の方向）はなれています`);
    } else if (g.on) L.push('・ユーザーの現在地：取得中');
    else L.push('・ユーザーの現在地：オフ（マップの「現在地」ボタンで表示できます）');
  }
  L.push(`・データについて：${m.sample ? '見本（架空）です。' : `建物・道路・水・緑のかたちと、外の位置はOpenStreetMapの実際のデータ。お店やアトラクションの一覧は${i.ai ? (i.search ? 'AIがネットで調べた情報' : 'AIの知識') : 'OpenStreetMapにのっているもの'}。建物の中の並び（どの階のどのあたりか）は「見取り図の目安」で、実際の位置とは違うことがあります。`}`);
  L.push('', `【マップのスポット一覧（全${m.pois.length}件）】`, '形式：「階またはエリア：名前(種類)、…」', ...spotListLines(m, live ? 6500 : 12500));
  L.push('', '【マップについての答え方】',
    '・お店やアトラクションの名前・階・種類は、上のスポット一覧にあるものだけを根拠に答える。一覧にないものは「このマップには載っていません」と伝え、マップ上の場所を勝手に作らない（一般的な知識として話すときは、そう断る）。',
    '・位置は「見取り図の目安」。「2階の北側あたり」のように、大まかに案内する。',
    '・営業時間・混雑・料金・今日の営業状況は変わるので、確かでないときは公式サイトでの確認をすすめる。');
  if (!live) L.push('・マップの画面の画像が添付されているときは、それがユーザーがいま見ている画面（選ばれたスポットや絞りこみも映っている）。');
  if (viewing && M.on) L.push('', '【マップを動かすタグ】', 'ユーザーのマップ画面を動かしたいときは、返事の中に次のタグを書くと画面が動く（読み上げられず、字幕にも出ない）。',
    '[[マップ:スポット名]]：そのスポットを選んで見せる（名前は一覧のとおりに書く）',
    '[[マップ案内:スポット名]]：そのスポットへの道すじを出す（現在地がオンのとき）',
    '[[マップ階:2F]]：その階を見せる（B1・1F・2F・RF など）',
    '[[マップ表示:3D]]：3D（または2D）に切りかえる',
    '[[マップ絞込:グルメ]]：種類で絞りこむ（アトラクション・ショー・グルメ・ショップ・サービス・施設・すべて）',
    'おすすめを聞かれたら、いちばん大事な1〜3件に[[マップ:…]]を付けるとよい。1回の返事でタグは多くても4つまで。');
  else L.push('', '【マップのタグ】', 'おすすめのスポットを案内するときは、スポット名に [[マップ:スポット名]] を付けると、チャットに「マップで見る」ボタンが出る（名前は一覧のとおりに書く。タグは読み上げられず、本文にも出ない）。1回の返事で多くても4つまで。');
  return L;
}

/* ---------- LIVE（音声会話）の画面にならべて表示 ---------- */
function dockEl() {
  if (!M.built) shell();
  const host = $('#live'); if (!host) return;
  if (M.el.parentElement !== host) host.appendChild(M.el);
  M.docked = true; M.on = true; M.el.hidden = false; M.el.classList.add('in-live');
  doc.body.classList.remove('mm-on'); doc.body.classList.add('mm-live');
  if (M.tab === 'ai') M.tab = 'spots';
  paintTabs(); requestAnimationFrame(() => { layout(); themeSync(); });
}
function undock(keepOpen) {
  if (!M.docked) return;
  M.docked = false; M.el.classList.remove('in-live'); doc.body.classList.remove('mm-live');
  if (M.el.parentElement !== doc.body) doc.body.appendChild(M.el);
  if (keepOpen) { doc.body.classList.add('mm-on'); M.on = true; M.el.hidden = false; }
  else { M.on = false; M.el.hidden = true; closeGps(); }
  paintTabs(); requestAnimationFrame(() => { layout(); themeSync(); });
}
async function openFromLive(o = {}) {
  shell();
  const was = M.on;
  if (!M.docked) { M.liveOrigin = !M.on; dockEl(); }
  if (o.id) await openMap(o.id, o);
  else if (was && M.map && M.screen === 'view') requestAnimationFrame(layout);
  else { showScreen('lib'); await renderLib(); }
}
function onLiveOpen() {
  if (!M.built || !M.on || M.docked) return;
  if (M.screen === 'view') { M.liveOrigin = false; dockEl(); } else close();
}
function onLiveClose() {
  if (!M.docked) return;
  if (M.liveOrigin) undock(false); else undock(true);
  M.liveOrigin = false;
}
async function liveShot() {
  if (!M.docked || !M.shotOn || !M.map || M.screen !== 'view' || !M.V || !M.V.map) return null;
  if (!(Engine.kind === 'api' || Engine.imgMax > 0)) return null;
  try { return await shotBlob(); } catch (e) { return null; }
}
async function startLive() {
  if (!engineReady()) { showEngineHelp(); return; }
  if (!M.map) return;
  await MC.ensure();
  M.liveOrigin = false;
  Live.open();
  if (Live.on) dockEl();
}

/* ---------- バックアップ ---------- */
async function exportAll() {
  const out = [];
  for (const e of await Store.list()) { if (e.sample) continue; const m = await Store.get(e.id); if (m) out.push(m); }
  return out;
}
async function importAll(arr) {
  let n = 0; const have = new Set((await Store.list()).map(e => e.id));
  for (const m of arr || []) {
    if (!m || !m.id || !Array.isArray(m.pois) || have.has(m.id)) continue;
    m.sample = 0; await Store.put(m, { touch: false }); try { Store.putThumb(m.id, await makeThumb(m)); } catch (e) {} n++;
  }
  return n;
}
