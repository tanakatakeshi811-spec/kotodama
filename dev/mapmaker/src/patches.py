# (anchor, replacement, label)  --  コトダマ本体への接続（すべて、1か所だけに一致するアンカーで差し替える）
patches.append(("if (win.__KD_TEST) win.__kd = { Meeting,", "if (win.__KD_TEST) win.__kd = { MapMaker, errText, Meeting,", "kd test export"))

# ---- サイドバー：AIカメラの下に「マップ制作」----
patches.append((
    '<span>AIカメラ</span><small>写ったものを判定</small></button>',
    '<span>AIカメラ</span><small>写ったものを判定</small></button>\n'
    '      <button class="side-link" data-act="mapmaker"><svg class="ic " viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5l5.5-2.2 6 2.2 5.5-2.2v13.2l-5.5 2.2-6-2.2-5.5 2.2z"/><path d="M9 4.3v13.2M15 6.5v13.2"/></svg><span>マップ制作</span><small>行きたい場所の地図</small></button>',
    'sidebar link'))

# ---- ボタンの動作 ----
patches.append((
    "'aicam': () => { closeSideMobile(); AICam.open(); },",
    "'aicam': () => { closeSideMobile(); AICam.open(); },\n  'mapmaker': () => { closeSideMobile(); MapMaker.open(); },\n  'mm-pin': b => MapMaker.fromTag(b.dataset.k, b.dataset.q),",
    'ACT'))

# ---- /マップ（スラッシュコマンド）----
patches.append((
    "{ k: 'カメラ', d: 'AIカメラ（顔の追尾・リアルタイム判定）', act: 'aicam' },",
    "{ k: 'カメラ', d: 'AIカメラ（顔の追尾・リアルタイム判定）', act: 'aicam' },\n  { k: 'マップ', d: 'マップ制作（ららぽーと・ディズニーなどのマップ）', act: 'mapmaker' },",
    'SLASH'))
patches.append((
    "map: () => GeoPanel.open(), geo: () => toggleGeo(),",
    "map: () => GeoPanel.open(), mapmaker: () => MapMaker.open(), geo: () => toggleGeo(),",
    'applySlash'))

# ---- ＋メニュー ----
patches.append((
    "{ icon: 'camera', label: 'AIカメラ', sub: '顔の自動追尾・ズーム・ピント・写ったものをリアルタイムで判定', run: () => AICam.open() },",
    "{ icon: 'camera', label: 'AIカメラ', sub: '顔の自動追尾・ズーム・ピント・写ったものをリアルタイムで判定', run: () => AICam.open() },\n    { icon: 'map', label: 'マップ制作', sub: '行きたい場所のマップをAIが作る（2D・3D・気温・現在地）', run: () => MapMaker.open() },",
    'plus menu'))

# ---- キー操作：マップが全画面のあいだは、本体のショートカットを止める ----
patches.append((
    "if ((Karaoke.on || AICam.on || RikuStage.on) && !Layer.top()) return;",
    "if ((Karaoke.on || AICam.on || RikuStage.on || (MapMaker.on && !MapMaker.docked)) && !Layer.top()) return;",
    'keydown guard'))

# ---- AIに渡す情報（system）----
patches.append((
    "if (typeof Geo !== 'undefined' && Geo.on && Geo.ok) L.push('', ...Geo.promptLines(!!o.live));",
    "if (typeof Geo !== 'undefined' && Geo.on && Geo.ok) L.push('', ...Geo.promptLines(!!o.live));\n  if (typeof MapMaker !== 'undefined') { const ml = MapMaker.promptLines(chat, !!o.live); if (ml.length) L.push('', ...ml); }",
    'systemText'))

# ---- タグを字幕・本文から消す ----
patches.append((
    "const cleanAI = t => String(t || '').replace(/\\[\\[(速さ|声|表情|動き|地図|ルート)[:：][^\\]]*\\]\\]\\s?/g, '').replace(/\\[\\[(速さ|声|表情|動き|地図|ルート)?[:：]?[^\\]]{0,24}$/, '').trimEnd();",
    "const cleanAI = t => String(t || '').replace(/\\[\\[(速さ|声|表情|動き|地図|ルート|マップ階|マップ表示|マップ案内|マップ絞込|マップ)[:：][^\\]]*\\]\\]\\s?/g, '').replace(/\\[\\[(速さ|声|表情|動き|地図|ルート|マップ階|マップ表示|マップ案内|マップ絞込|マップ)?[:：]?[^\\]]{0,24}$/, '').trimEnd();",
    'cleanAI'))

# ---- チャットの回答に出る「マップで見る」ボタン ----
patches.append((
    "const gt = geoTags(a.text); if (gt.length) h +=",
    "const mt = (c && c.mapId && typeof MapMaker !== 'undefined') ? MapMaker.mapTags(a.text) : []; if (mt.length) h += `<div class=\"geo-chips\">${mt.map(([k, n]) => `<button class=\"chip\" data-act=\"mm-pin\" data-k=\"${esc(k)}\" data-q=\"${esc(n)}\">${ic(k === 'マップ案内' ? 'route' : 'locate')}${esc(n)}${k === 'マップ案内' ? 'への道すじ' : 'をマップで見る'}</button>`).join('')}</div>`;\n    const gt = geoTags(a.text); if (gt.length) h +=",
    'aiInner chips'))

# ---- チャットを開いたとき、そのマップの情報もAIに渡せるように準備 ----
patches.append((
    "renderHeader(); renderThread(); renderComposer(); renderSidebar(); loadDraft();\n  watchCurrent(c);",
    "renderHeader(); renderThread(); renderComposer(); renderSidebar(); loadDraft();\n  watchCurrent(c);\n  if (c && c.mapId && typeof MapMaker !== 'undefined') MapMaker.preload(c);",
    'setView preload'))

# ---- LIVE ----
patches.append((
    "const re = /\\[\\[(速さ|声|表情|動き|地図|ルート)[:：]\\s*([^\\]]+?)\\s*\\]\\]/g; let m;",
    "const re = /\\[\\[(速さ|声|表情|動き|地図|ルート|マップ階|マップ表示|マップ案内|マップ絞込|マップ)[:：]\\s*([^\\]]+?)\\s*\\]\\]/g; let m;",
    'Live.applyTags re'))
patches.append((
    "if (m[1] === '地図' || m[1] === 'ルート') { GeoPanel.fromTag(m[1], m[2]); continue; }",
    "if (/^マップ/.test(m[1])) { if (typeof MapMaker !== 'undefined') MapMaker.applyTag(m[1], m[2]); continue; }\n      if (m[1] === '地図' || m[1] === 'ルート') { GeoPanel.fromTag(m[1], m[2]); continue; }",
    'Live.applyTags map'))
patches.append((
    "<button type=\"button\" class=\"lv-dress-btn\" id=\"lvMap\" data-lv=\"map\">${ic('map')}<span>地図</span></button>",
    "<button type=\"button\" class=\"lv-dress-btn\" id=\"lvMap\" data-lv=\"map\">${ic('map')}<span>地図</span></button>\n        <button type=\"button\" class=\"lv-dress-btn\" id=\"lvMM\" data-lv=\"mm\">${ic('mm-layers')}<span>マップ</span></button>",
    'Live tools button'))
patches.append((
    "else if (a === 'map') GeoPanel.open();",
    "else if (a === 'map') GeoPanel.open();\n      else if (a === 'mm') MapMaker.open();",
    'Live click'))
patches.append((
    "if (this.screenOn && o.only !== 'camera') { const sh = await this.shotScreen(); if (sh) { frames.push(sh); names.push('共有中の画面'); } }",
    "if (this.screenOn && o.only !== 'camera') { const sh = await this.shotScreen(); if (sh) { frames.push(sh); names.push('共有中の画面'); } }\n    let mapShot = null; if (text && !o.only && !o.camOnly && typeof MapMaker !== 'undefined' && MapMaker.docked) mapShot = await MapMaker.liveShot();",
    'Live.send map frame'))
patches.append((
    "this.imgLabel = names.length ? `いま映っている映像（${names.join('・')} の順）` : '';",
    "if (mapShot) { images = images.concat([mapShot]); names.push('いまユーザーが見ているマップの画面'); }\n    this.imgLabel = names.length ? `いま映っている映像（${names.join('・')} の順）` : '';",
    'Live.send map label'))
patches.append((
    "if (GeoPanel.inLive) GeoPanel.close(); this.reacting = false;",
    "if (GeoPanel.inLive) GeoPanel.close(); if (typeof MapMaker !== 'undefined') MapMaker.onLiveClose(); this.reacting = false;",
    'Live.close'))
patches.append((
    "$('#live').hidden = false; doc.body.classList.add('live-on'); this.capEmpty();",
    "$('#live').hidden = false; doc.body.classList.add('live-on'); this.capEmpty(); if (typeof MapMaker !== 'undefined') MapMaker.onLiveOpen();",
    'Live.open'))

# ---- 画像につける説明（マップの画面）----
patches.append((
    "'いまカメラに映っている映像')) : '今回の追加画像')",
    "'いまカメラに映っている映像')) : (o.imgLabel || '今回の追加画像'))",
    'generate imgLabel'))

# ---- バックアップ ----
patches.append((
    "JSON.stringify({ app: 'kotodama', v: 1, exported: Date.now(), settings, chats, files, images })",
    "JSON.stringify({ app: 'kotodama', v: 1, exported: Date.now(), settings, chats, files, images, maps: await MapMaker.exportAll().catch(() => []) })",
    'backupAll'))
patches.append((
    "renderSidebar(); toast(`${n}件のチャットを読み込みました`);",
    "let nm = 0; if (Array.isArray(j.maps) && j.maps.length) { try { nm = await MapMaker.importAll(j.maps); } catch (e) {} }\n  renderSidebar(); toast(`${n}件のチャットを読み込みました${nm ? `（マップ${nm}件も）` : ''}`);",
    'importBackup'))

# ---- はじめのガイド（使い方の表）にも1行 ----
patches.append((
    r"| **AIカメラ** | 左の一覧の「AIカメラ」。顔を自動で追いかけ、真ん中の四角に写ったものをリアルタイムで判定 |\n",
    r"| **AIカメラ** | 左の一覧の「AIカメラ」。顔を自動で追いかけ、真ん中の四角に写ったものをリアルタイムで判定 |\n| **マップ制作** | 左の一覧の「マップ制作」。行きたい場所（ららぽーと・ディズニー・コストコなど）を伝えると、お店やアトラクションを1つずつ載せた2D・3Dのマップを作ります。気温・検索・現在地・AIとの会話つき |\n",
    'guide table'))

# ---- 中継サーバーのエラー：PCのClaude Codeのログイン切れは、英語のまま出さず、直し方を日本語で ----
patches.append((
    "if (c === 'relay_error') return '中継サーバーのエラー：' + String(e.message || '').slice(0, 200);",
    "if (c === 'relay_error') return /oauth|authenticat|log ?in|session.{0,24}expired|unauthori[sz]ed/i.test(String(e.message || '')) ? 'PCのClaude Codeのログインが切れています。PCのターミナルで claude を開いて /login でログインし直してください（中継サーバー自体は動いています）。' : '中継サーバーのエラー：' + String(e.message || '').slice(0, 200);",
    'errText relay login'))
