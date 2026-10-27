
/* ---------- 画面の土台・マップ一覧・新しく作る ---------- */
const M = {
  el: null, built: false, on: false, docked: false, screen: 'lib', map: null, V: null, tab: 'spots', sel: null, q: '', filter: 'all', hits: null, shotOn: true,
  sheet: 'peek', narrow: false, listN: 90, libQ: '', gps: { on: false, pos: null, wid: null, err: '', inside: false }, wx: null, wxT: 0, place: null, edit: false, sampleThumbs: new Map(), obs: null, lastQ: '', tagSeen: new Set(),
};
const kindN = k => (KINDS[k] || KINDS.other).n;
const fmtDate = t => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + '/'}${d.getMonth() + 1}/${d.getDate()}`; };
const catIcon = (c, cls) => `<i class="mm-ci ${cls || ''}" style="--c:${catOf(c).c}">${ic(catOf(c).ic)}</i>`;
const accLabel = a => ({ 'osm+ai': 'OpenStreetMap（実測）＋AI（店・施設の一覧）', ai: 'AI（店・施設の一覧）＋OpenStreetMap（周りの地図）', osm: 'OpenStreetMapのデータのみ', sample: '見本（架空の場所）' }[a] || '');

/* ---------- 全体の枠 ---------- */
function shell() {
  if (M.built) return;
  const e = el('section', 'mm'); e.hidden = true; e.setAttribute('aria-label', 'マップ制作');
  e.innerHTML = `<div class="mm-lib"><div class="mm-lh"><button class="mm-b" data-m="close" aria-label="閉じる">${ic('x')}</button><div class="mm-lt"><b>マップ制作</b><small>場所の名前から、お店やアトラクションまで載ったマップを作ります</small></div><button class="btn primary sm mm-new" data-m="new">${ic('plus')}新しいマップ</button></div><div class="mm-lb"></div></div>
  <div class="mm-view" hidden>${viewHTML()}</div>`;
  doc.body.appendChild(e); M.el = e; M.built = true;
  e.addEventListener('click', onClick);
  e.addEventListener('input', onInput);
  e.addEventListener('submit', onSubmit);
  e.addEventListener('keydown', onKey);
  e.addEventListener('change', onChange);
  doc.addEventListener('keydown', ev => { if (!M.on || Layer.top()) return; mmGlobalKey(ev); }, true);
  try { M.obs = new ResizeObserver(() => { if (M.on) layout(); }); M.obs.observe(e); } catch (er) {}
  try { new MutationObserver(() => { if (M.on) themeSync(); }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-scheme', 'data-accent', 'data-pixel', 'class'] }); } catch (er) {}
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (M.on) themeSync(); }); } catch (er) {}
  IconImg.onload = () => { if (M.V) M.V.render(); };
}
function themeSync() {
  if (!M.V) return; const dk = isDark(); let ac = ''; try { ac = getComputedStyle(root).getPropertyValue('--accent').trim(); } catch (e) {}
  M.V.dark = dk; if (/^#[0-9a-f]{6}$/i.test(ac)) M.V.accent = ac; M.V.render();
}

/* ---------- 開く・閉じる ---------- */
async function open(o = {}) {
  shell();
  if (typeof Live !== 'undefined' && Live.on) { /* LIVE中は、LIVEの画面にならべて表示 */ return openFromLive(o); }
  if (M.docked) undock(true);
  M.on = true; M.el.hidden = false; doc.body.classList.add('mm-on'); M.el.classList.remove('in-live');
  themeSync();
  if (o.id) { await openMap(o.id, o); return; }
  showScreen('lib'); await renderLib();
}
function close() {
  if (!M.el || !M.on) return;
  if (M.docked) { undock(false); }
  closeGps(); M.on = false; M.el.hidden = true; doc.body.classList.remove('mm-on');
  if (M.V) { M.V.setHits(null); }
  clearInterval(M.wxT); M.wxT = 0;
}
function showScreen(s) {
  M.screen = s; $('.mm-lib', M.el).hidden = s !== 'lib'; $('.mm-view', M.el).hidden = s !== 'view'; M.el.dataset.s = s;
  if (s === 'view') requestAnimationFrame(layout);
}

/* ---------- マップの一覧 ---------- */
async function renderLib() {
  const box = $('.mm-lb', M.el); if (!box) return;
  const saved = await Store.list(), samples = Samples.list(), q = nameKey(M.libQ);
  const match = a => !q || nameKey((a.n || '') + (a.a || '') + kindN(a.k)).includes(q);
  const card = (a, sample) => `<div class="mm-lc" data-m="openmap" data-id="${esc(a.id)}" role="button" tabindex="0" aria-label="${esc(a.n)}を開く"><div class="mm-th" data-th="${esc(a.id)}"><span class="mm-thp">${ic(KINDS[a.k] ? KINDS[a.k].ic : 'map')}</span></div><div class="mm-lcb"><b>${esc(a.n)}</b><small>${ic(KINDS[a.k] ? KINDS[a.k].ic : 'map', 'sm')}${esc(kindN(a.k))}${a.p ? ` ・ スポット${a.p}件` : ''}${a.f > 1 ? ` ・ ${a.f}フロア` : ''}</small><small class="mm-lca">${esc(sample ? a.a : (a.a || '')) || '&nbsp;'}</small>${sample ? '' : `<small class="mm-lcd">${esc(fmtDate(a.u))}に更新</small>`}</div>${sample ? '<span class="tag mm-st">見本</span>' : `<button class="icon-btn mm-lm" data-m="libmenu" data-id="${esc(a.id)}" aria-label="メニュー">${ic('more')}</button>`}</div>`;
  const mine = saved.filter(a => !a.sample && match(a)), sm = samples.filter(match);
  let h = '';
  if (!saved.length) h += `<div class="mm-hero"><div class="mm-hi">${ic('mm-layers')}</div><h2>行きたい場所のマップを、AIが作ります</h2><p>ららぽーと・ディズニー・遊園地・コストコ・動物園…。場所の名前を入れると、お店やアトラクションを1つずつ調べて、2Dと3Dで見られるマップにします。気温・検索・GPSの現在地・AIとのチャットやLIVEにも対応しています。</p><button class="btn primary" data-m="new">${ic('plus')}マップを作ってみる</button></div>`;
  else if (saved.length > 5) h += `<div class="mm-ls"><span>${ic('search')}</span><input type="search" value="${esc(M.libQ)}" placeholder="作ったマップを探す" data-m="libq" aria-label="作ったマップを探す"></div>`;
  if (mine.length) h += `<h3 class="mm-h">あなたのマップ</h3><div class="mm-grid">${mine.map(a => card(a, false)).join('')}</div>`;
  else if (saved.length && q) h += `<p class="mm-empty">「${esc(M.libQ)}」に合うマップはありません。</p>`;
  if (sm.length) h += `<h3 class="mm-h">見本<small>架空の場所です。ネットなしでも見られます</small></h3><div class="mm-grid">${sm.map(a => card(a, true)).join('')}</div>`;
  h += `<div class="mm-foot"><button class="btn sm" data-m="import">${ic('upload')}マップのファイルを読み込む</button></div>`;
  box.innerHTML = h;
  for (const t of $$('[data-th]', box)) fillThumb(t, t.dataset.th);
}
async function fillThumb(node, id) {
  try {
    let d = '';
    if (/^sample-/.test(id)) { d = M.sampleThumbs.get(id); if (!d) { d = await makeThumb(Samples.get(id)); M.sampleThumbs.set(id, d); } }
    else d = await Store.thumb(id);
    if (!d) { const m = await Store.get(id); if (m) { d = await makeThumb(m); Store.putThumb(id, d); } }
    if (d && node.isConnected) { node.innerHTML = `<img src="${d}" alt="" loading="lazy">`; }
  } catch (e) {}
}
function libMenu(btn, id) {
  menu(btn, [
    { icon: 'edit', label: '名前を変える', run: async () => { const m = await Store.get(id); if (!m) return; const v = await promptBox('マップの名前', m.name, { label: '名前', ok: '変更' }); if (v && v.trim()) { m.name = v.trim().slice(0, 60); await Store.put(m); renderLib(); } } },
    { icon: 'refresh', label: '最新の情報で作り直す', sub: '同じ場所をもう一度調べます', run: () => remake(id) },
    { icon: 'download', label: 'ファイルに書き出す', run: () => exportOne(id) },
    '-', { icon: 'trash', label: '削除', danger: true, run: async () => { const m = await Store.get(id); if (!(await confirmBox('マップを削除しますか？', `「${esc((m && m.name) || '')}」を削除します。元に戻せません。`, '削除する', true))) return; await Store.del(id); LS.del('mmchat:' + id); renderLib(); toast('削除しました'); } },
  ], { align: 'right' });
}
async function exportOne(id) {
  const m = await Store.get(id); if (!m) return;
  const data = JSON.stringify({ app: 'kotodama-map', v: 1, map: m });
  if (typeof saveOut === 'function') saveOut(`map-${safeName(m.name)}.json`, new Blob([data], { type: 'application/json' }));
}
function importFile() {
  const inp = el('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text()); const m = j && j.app === 'kotodama-map' && j.map; if (!m || !Array.isArray(m.pois)) throw 0;
      m.id = uid('m'); m.sample = 0; await Store.put(m, { touch: false }); try { Store.putThumb(m.id, await makeThumb(m)); } catch (e) {} renderLib(); toast(`「${m.name}」を読み込みました`);
    } catch (e) { toast('マップのファイルを読み込めませんでした', { err: true }); }
  };
  inp.click();
}
async function remake(id) {
  const m = await Store.get(id); if (!m || !m.cand) { toast('このマップは作り直せません（見本または古い形式）'); return; }
  openCreate({ cand: m.cand, query: m.query || m.name, id: m.id, keep: { chat: m.chat, created: m.created }, kind: m.kind });
}

/* ---------- 新しいマップを作る（場所をさがす → えらぶ → 作る）---------- */
function openCreate(pre = {}) {
  const n = el('div', 'dlg wide mm-dlg'); n.setAttribute('role', 'dialog'); n.setAttribute('aria-modal', 'true'); n.setAttribute('aria-label', '新しいマップを作る');
  let entry = null, cands = [], chosen = 0, job = null, searching = false, ctl = null, st = { q: pre.query || '', kind: pre.kind || '' };
  const EX = ['ららぽーとTOKYO-BAY', '東京ディズニーランド', 'コストコ 幕張倉庫店', 'ユニバーサル・スタジオ・ジャパン', 'イオンモール幕張新都心', 'よみうりランド', '上野動物園'];
  const head = t => `<div class="dlg-h"><h2>${esc(t)}</h2><button class="icon-btn" data-x aria-label="閉じる">${ic('x')}</button></div>`;
  const stepSearch = (msg) => {
    n.innerHTML = `${head('新しいマップを作る')}<div class="dlg-b mm-cr"><p class="help-p">行きたい場所の名前を入れてください。AIが、お店やアトラクションを1つずつ調べて、2D・3Dで見られるマップにします。</p>
      <form class="mm-sf" data-f="search"><input type="search" name="q" value="${esc(st.q)}" placeholder="例：ららぽーとTOKYO-BAY ／ 東京ディズニーランド ／ コストコ 幕張" autocomplete="off" enterkeyhint="search" autofocus><button class="btn primary" type="submit">${ic('search')}さがす</button></form>
      ${msg ? `<p class="mm-msg">${esc(msg)}</p>` : ''}<div class="mm-ex"><small>たとえば</small>${EX.map(x => `<button type="button" class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <p class="mm-hint">地名や店舗名（「幕張」「新三郷」など）をつけると、見つかりやすくなります。</p></div>`;
    setTimeout(() => { const i = $('input[name=q]', n); if (i && !COARSE) i.focus(); }, 30);
  };
  const stepPick = () => {
    const canS = aiCanSearch(), hasAI = aiAvail();
    n.innerHTML = `${head('この場所でいいですか？')}<div class="dlg-b mm-cr"><div class="mm-cands" role="radiogroup" aria-label="見つかった場所">${cands.map((c, i) => `<label class="mm-cand${i === chosen ? ' on' : ''}"><input type="radio" name="mmc" value="${i}" ${i === chosen ? 'checked' : ''}><span class="mm-cb"><b>${esc(c.name)}</b><small>${esc(c.label || '')}</small></span><span class="tag">${esc(kindN(c.kind))}</span></label>`).join('')}</div>
      <div class="mm-opts"><label class="field"><span>種類（ふつうは「おまかせ」でだいじょうぶです）</span><select name="kind"><option value="">おまかせ</option>${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${st.kind === k ? 'selected' : ''}>${esc(v.n)}</option>`).join('')}</select></label>
      <label class="mm-ck"><input type="checkbox" name="search" ${canS ? 'checked' : 'disabled'}><span>ネットで公式の情報（フロアガイドや営業時間など）を調べる<small>${canS ? '正確になりますが、時間が少しかかります' : '中継サーバーかAPIキーでAIにつないだときだけ使えます'}</small></span></label>
      <div class="field"><span>調べ方</span><div class="seg" role="group"><button type="button" data-deep="1" class="on">ていねい（もれを減らす）</button><button type="button" data-deep="0">はやく</button></div></div></div>
      ${hasAI ? '' : '<p class="mm-msg warn">AIにつながっていないため、OpenStreetMapにのっている場所だけで作ります（お店の情報は少なめになります）。</p>'}
      <p class="mm-hint">目安：1〜3分。作っているあいだに、やめたり「ここまでで作る」にしたりできます。位置・建物・道路はOpenStreetMap、お店やアトラクションの一覧はAIが調べた情報です。建物の中の並びは「見取り図の目安」です。</p></div>
      <div class="dlg-f"><button class="btn" data-a="back">もどる</button><button class="btn primary" data-a="make">${ic('mm-layers')}マップを作る</button></div>`;
  };
  const STEPS = [['osm', '敷地と周りの地図（OpenStreetMap）'], ['ai', 'AIの下調べ（正式名・階・エリア）'], ['list', 'お店・アトラクションを1つずつ調べる'], ['build', '位置を決めて組み立てる'], ['save', '保存']];
  const stepRun = (c) => {
    n.innerHTML = `${head('マップを作っています')}<div class="dlg-b mm-cr"><div class="mm-run"><b>${esc(c.name)}</b><small>${esc(c.label || '')}</small></div><ol class="mm-steps">${STEPS.map(([k, t]) => `<li data-k="${k}" class="pend"><i></i><span>${esc(t)}<small></small></span></li>`).join('')}</ol><div class="mm-bar"><i style="width:2%"></i></div><div class="mm-found" aria-live="polite"></div></div>
      <div class="dlg-f"><button class="btn" data-a="cancel">やめる</button><button class="btn" data-a="early" disabled>ここまでで作る</button></div>`;
  };
  const setStep = (k, state, text) => { const li = $(`.mm-steps li[data-k="${k}"]`, n); if (!li) return; li.className = state; if (text != null) $('small', li).textContent = text; };
  const onProg = p => {
    const order = ['osm', 'ai', 'list', 'build', 'save'];
    if (p.step === 'osm') { setStep('osm', 'run', p.msg); if (aiAvail() && $(`.mm-steps li[data-k="ai"]`, n).className === 'pend') setStep('ai', 'run', ''); }
    else if (p.step === 'ai') setStep('ai', 'run', p.msg);
    else if (p.step === 'list') { setStep('osm', 'done'); setStep('ai', 'done'); setStep('list', 'run', p.msg + (p.total ? `（${p.done}/${p.total}）` : '')); const b = $('.mm-bar i', n); if (b && p.total) b.style.width = Math.max(4, Math.min(92, 6 + 86 * (p.done / p.total))) + '%'; const e = $('[data-a=early]', n); if (e && p.found >= 3) e.disabled = false; const f = $('.mm-found', n); if (f) { f.innerHTML = `<b>${p.found || 0}件</b> 見つかりました${p.latest && p.latest.length ? '<span>' + p.latest.map(x => `<em>${esc(x)}</em>`).join('') + '</span>' : ''}`; } }
    else if (p.step === 'build') { setStep('osm', 'done'); setStep('ai', 'done'); setStep('list', 'done'); setStep('build', 'run', p.msg); const b = $('.mm-bar i', n); if (b) b.style.width = '94%'; const e = $('[data-a=early]', n); if (e) e.disabled = true; }
    else if (p.step === 'save') { setStep('build', 'done'); setStep('save', 'run', p.msg); const b = $('.mm-bar i', n); if (b) b.style.width = '98%'; }
    void order;
  };
  const doSearch = async q => {
    q = String(q || '').trim(); if (!q || searching) return; st.q = q; searching = true;
    const f = $('.mm-sf', n); if (f) { f.classList.add('busy'); $('button', f).disabled = true; $('button', f).textContent = 'さがしています…'; }
    ctl = new AbortController();
    try { cands = (await searchPlaces(q, ctl.signal)).slice(0, 8); }
    catch (e) { searching = false; if (e && e.code === 'cancelled') return; stepSearch('場所をさがせませんでした。ネットにつながっているか確かめて、もう一度試してください。'); return; }
    searching = false;
    if (!cands.length) { stepSearch('その名前では見つかりませんでした。地名をつけたり、正式な名前にしたりして試してください。'); return; }
    chosen = 0; stepPick();
  };
  const make = async () => {
    const c = cands[chosen]; if (!c) return;
    const kind = ($('select[name=kind]', n) || {}).value || '';
    const search = !!($('input[name=search]', n) || {}).checked;
    const deepV = ($('.seg [data-deep].on', n) || { dataset: { deep: '1' } }).dataset.deep === '1';
    stepRun(c);
    job = Gen.start({ cand: c, query: st.q || c.name, kind: kind || (pre.kind || ''), search, deep: deepV, id: pre.id, keep: pre.keep }, onProg);
    try {
      const map = await job.promise; job = null;
      Layer.close(entry, map);
    } catch (e) {
      job = null;
      if (e && e.code === 'cancelled') { stepPick(); return; }
      const msg = e && e.code === 'empty' ? e.msg : (e && (e.msg || e.message)) || 'マップを作れませんでした。';
      stepPick(); const b = $('.mm-cr', n); if (b) b.insertAdjacentHTML('afterbegin', `<p class="mm-msg warn">${esc(msg)}${e && e.code && e.code !== 'empty' ? '（' + esc(String(e.code)) + '）' : ''}</p>`);
    }
  };
  n.addEventListener('click', e => {
    if (e.target.closest('[data-x]')) { if (job) { job.cancel(); } else Layer.close(entry, null); return; }
    const ex = e.target.closest('[data-ex]'); if (ex) { const i = $('input[name=q]', n); if (i) i.value = ex.dataset.ex; doSearch(ex.dataset.ex); return; }
    const a = e.target.closest('[data-a]');
    if (a) { const k = a.dataset.a; if (k === 'back') stepSearch(''); else if (k === 'make') make(); else if (k === 'cancel') { if (job) job.cancel(); } else if (k === 'early') { if (job) job.finishNow(); } return; }
    const dp2 = e.target.closest('[data-deep]'); if (dp2) { for (const b of $$('[data-deep]', n)) b.classList.toggle('on', b === dp2); }
  });
  n.addEventListener('change', e => { if (e.target.name === 'mmc') { chosen = +e.target.value; for (const l of $$('.mm-cand', n)) l.classList.toggle('on', $('input', l).checked); } });
  n.addEventListener('submit', e => { e.preventDefault(); if (e.target.dataset.f === 'search') doSearch($('input[name=q]', e.target).value); });
  entry = Layer.open(n, { onClose: async v => { if (ctl) ctl.abort(); if (job) job.cancel(); if (v && v.id) { await renderLibSafe(); openMap(v.id, { fresh: true }); toast(`「${v.name}」のマップを作りました（${v.pois.length}件）`, { ms: 3600 }); } } });
  if (pre.cand) { cands = [pre.cand]; chosen = 0; if (!pre.cand.label) pre.cand.label = pre.cand.name; stepPick(); } else stepSearch('');
}
const renderLibSafe = async () => { try { await renderLib(); } catch (e) {} };
