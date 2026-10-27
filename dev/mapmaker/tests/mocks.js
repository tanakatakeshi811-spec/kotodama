/* テスト用の偽データ：Nominatim / Overpass / AI / 天気 / GPS を差し替える（mall / park / store の3種類）*/
(MM) => {
  const calls = { fetch: [], ai: [], wx: 0 };
  const rnd = (seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)(12345);
  const mk = C => {
    const ll = (dx, dy) => ({ lat: C.lat + dy / 111000, lon: C.lon + dx / (111000 * Math.cos(C.lat * Math.PI / 180)) });
    const rect = (x0, y0, x1, y1) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];
    const ring = (rx, ry, n, wob) => { const a = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2, k = 1 + (wob || 0) * Math.sin(t * 3 + 1) * 0.5; a.push(ll(Math.cos(t) * rx * k, Math.sin(t) * ry * k)); } a.push(a[0]); return a; };
    const way = (id, tags, pts) => ({ type: 'way', id, tags, geometry: pts });
    const node = (id, dx, dy, tags) => { const p = ll(dx, dy); return { type: 'node', id, lat: p.lat, lon: p.lon, tags }; };
    return { C, ll, rect, ring, way, node };
  };
  const L = (arr, key) => JSON.stringify(arr.map(([n, c, ds, hrs, pos]) => Object.assign({ n, c }, ds ? { ds } : {}, hrs ? { hrs } : {}, pos ? { pos } : {}, key === 'out' ? { out: true } : {})), null, 1);

  /* ---------- mall ---------- */
  const mall = (() => {
    const g = mk({ lat: 35.6845, lon: 139.9910 }), { ll, rect, way, node } = g;
    const SITE = rect(-150, -80, 150, 80);
    return { g, id: 'W424242', SITE, kw: /ららぽーと|モール/,
      NOM: [
        { osm_type: 'node', osm_id: 778, lat: String(g.C.lat - 0.0015), lon: String(g.C.lon + 0.0002), display_name: 'ららぽーとTOKYO-BAY（テスト）, 浜町, 船橋市, 千葉県, 日本', category: 'shop', type: 'mall', name: 'ららぽーとTOKYO-BAY（テスト）', importance: 0.7, address: { state: '千葉県', city: '船橋市', road: '浜町', house_number: '1-1-1' }, extratags: {} },
        { osm_type: 'way', osm_id: 424242, lat: String(g.C.lat), lon: String(g.C.lon), boundingbox: [String(ll(0, -80).lat), String(ll(0, 80).lat), String(ll(-150, 0).lon), String(ll(150, 0).lon)],
          display_name: 'ららぽーとTOKYO-BAY（テスト）, 浜町, 船橋市, 千葉県, 日本', category: 'shop', type: 'mall', name: 'ららぽーとTOKYO-BAY（テスト）', importance: 0.62, address: { state: '千葉県', city: '船橋市', road: '浜町', house_number: '1-1-1' }, extratags: {} },
        { osm_type: 'node', osm_id: 777, lat: String(g.C.lat + 0.01), lon: String(g.C.lon + 0.01), display_name: 'ららぽーと別館, 習志野市, 千葉県, 日本', category: 'shop', type: 'mall', name: 'ららぽーと別館', importance: 0.3, address: { state: '千葉県', city: '習志野市' }, extratags: {} } ],
      CTX: [
        way(1, { building: 'retail', name: 'ららぽーとTOKYO-BAY（テスト）', 'building:levels': '3' }, SITE),
        way(2, { building: 'apartments', 'building:levels': '10' }, rect(190, -70, 250, -20)), way(3, { building: 'house' }, rect(-260, -60, -240, -40)), way(4, { building: 'warehouse' }, rect(-280, 100, -200, 150)),
        way(5, { highway: 'primary' }, [ll(-400, -130), ll(0, -128), ll(400, -130)]), way(6, { highway: 'residential' }, [ll(-210, -300), ll(-212, 0), ll(-215, 300)]), way(7, { highway: 'footway' }, [ll(-150, 100), ll(0, 102), ll(150, 100)]),
        way(8, { natural: 'water' }, rect(220, 80, 300, 140)), way(9, { leisure: 'park' }, rect(-340, -250, -230, -150)), way(10, { amenity: 'parking' }, rect(-140, -200, 140, -150)) ],
      NAMED: [ node(101, -100, 20, { name: 'ユニクロ', shop: 'clothes', level: '0' }), node(102, 40, -30, { name: 'サイゼリヤ', amenity: 'restaurant', level: '1' }), node(103, -60, -40, { name: 'スターバックス', amenity: 'cafe', level: '0', opening_hours: 'Mo-Su 08:00-22:00' }),
        node(104, 90, 40, { name: 'TOHOシネマズ', amenity: 'cinema', level: '2' }), node(105, 0, 0, { name: '無印良品', shop: 'variety_store', level: '0', website: 'https://www.muji.com/' }), way(106, { name: '第1駐車場', amenity: 'parking' }, rect(-120, -190, -30, -160)), node(107, 0, -75, { name: '正面入口', entrance: 'main', amenity: 'information' }),
        way(108, { name: 'ららぽーとTOKYO-BAY（テスト）', shop: 'mall' }, rect(-140, -70, 140, 70)), way(109, { name: '北館（テスト）', shop: 'mall' }, rect(-130, 10, -20, 60)),
        /* 本物のOSMにある形: 棟は building=retail と名前だけ(shopなし)。ビルは building=commercial。小さな建物のお店は残す */
        way(110, { name: '南館（テスト）', building: 'retail', 'building:levels': '4' }, rect(20, 10, 120, 60)), way(111, { name: '小さな売店ビル', building: 'retail' }, rect(150, -60, 165, -45)), way(112, { name: 'テストオフィスビル', building: 'commercial' }, rect(-130, -62, -90, -40)) ],
      D: { name: 'ららぽーとTOKYO-BAY', kind: 'mall', addr: '千葉県船橋市浜町2-1-1', sum: '船橋市にある大型ショッピングモール。ファッション・グルメ・映画館がそろう（テスト用データ）。', hours: '10:00〜21:00（店舗により異なる）', access: 'JR南船橋駅から徒歩5分', web: 'https://mitsui-shopping-park.com/lalaport/tokyo-bay/', lat: g.C.lat, lon: g.C.lon,
        buildings: [{ id: 'b1', n: '本館', fl: ['1F', '2F', '3F'] }], zones: [], tips: ['土日は駐車場が混みます'], notes: '' },
      list(label) {
        const P = {
          '1F': [['ユニクロ', 'fashion', 'カジュアル衣料', '10:00-21:00', '北側'], ['無印良品', 'goods', '生活雑貨', '', '中央'], ['スターバックス', 'cafe', 'コーヒー', '8:00-22:00', '入口の近く'], ['ABCマート', 'fashion', '靴', '', '南東'], ['ダイソー', 'goods', '100円ショップ', '', '東'], ['ココカラファイン', 'service', 'ドラッグストア', '', '西'], ['丸亀製麺', 'food', 'うどん', '', '北西'], ['フードコート', 'food', '15店のフードコート', '', '中央'], ['サービスカウンター', 'facility', '案内所', '', '正面入口の近く'], ['トイレ（1F）', 'wc', '', '', '各所'], ['エレベーター', 'facility', '', '', ''], ['ATM', 'service', '', '', '']],
          '2F': [['サイゼリヤ', 'food', 'イタリアン', '', '北'], ['ZARA', 'fashion', 'ファッション', '', '南'], ['GU', 'fashion', '', '', '東'], ['ニトリ', 'goods', '家具・インテリア', '', '西'], ['アカチャンホンポ', 'goods', 'ベビー用品', '', ''], ['ゲームセンター モア', 'play', 'ゲーム', '', ''], ['トイレ（2F）', 'wc', '', '', ''], ['授乳室', 'facility', '', '', '']],
          '3F': [['TOHOシネマズ', 'show', '映画館', '9:00-24:00', '東側'], ['ボーリング ラウンドワン', 'play', 'ボウリング・カラオケ', '', ''], ['焼肉きんぐ', 'food', '食べ放題', '', ''], ['トイレ（3F）', 'wc', '', '', '']],
          out: [['第1駐車場', 'parking', '無料2時間', '', ''], ['第2駐車場', 'parking', '', '', ''], ['バス乗り場', 'parking', '南船橋駅行き', '', ''], ['タクシー乗り場', 'parking', '', '', ''], ['屋外広場', 'facility', 'イベント広場', '', '']] };
        if (/建物の外/.test(label)) return L(P.out, 'out');
        for (const f of ['1F', '2F', '3F']) if (label.indexOf(f) >= 0 || label.indexOf(f.replace('F', '階')) >= 0) { if (f === '3F' && window.__mockTrunc) { const s = L(P['3F']); return s.slice(0, s.length - 40); } return L(P[f]) + '\n```'; }
        return '[]';
      } };
  })();

  /* ---------- park（東京ディズニーランド風。約1100m×800mの敷地）---------- */
  const park = (() => {
    const g = mk({ lat: 35.6329, lon: 139.8804 }), { ll, rect, ring, way, node } = g;
    const SITE = ring(560, 400, 28, 0.12);
    const named = [];
    const att = (id, dx, dy, name, tags) => named.push(node(id, dx, dy, Object.assign({ name }, tags)));
    att(201, -380, 60, 'ジャングルクルーズ', { attraction: 'ride' }); att(202, -300, 150, 'スプラッシュ・マウンテン', { attraction: 'water_ride' }); att(203, 40, 160, 'シンデレラ城', { tourism: 'attraction' });
    att(204, 250, -80, 'スペース・マウンテン', { attraction: 'roller_coaster' }); att(205, 300, 120, 'ビッグサンダー・マウンテン', { attraction: 'roller_coaster' }); att(206, 0, -300, 'ワールドバザール', { shop: 'gift' });
    att(207, -120, 40, 'カリブの海賊', { attraction: 'ride' }); att(208, -200, 220, 'ホーンテッドマンション', { attraction: 'ride' }); att(209, 120, 40, 'プーさんのハニーハント', { attraction: 'ride' });
    att(210, 60, -200, 'セントラルプラザ', { leisure: 'park' }); att(211, -240, -60, 'ブルーバイユー・レストラン', { amenity: 'restaurant' }); att(212, 20, -120, 'グランドサーキット', { attraction: 'ride' });
    named.push(way(213, { name: '駐車場（ディズニー）', amenity: 'parking' }, rect(-300, -520, 300, -430)));
    named.push(node(214, 0, -395, { name: 'エントランスゲート', entrance: 'main', tourism: 'information' }));
    return { g, id: 'W515151', SITE, kw: /ディズニー|ランド|遊園地/,
      NOM: [ { osm_type: 'way', osm_id: 515151, lat: String(g.C.lat), lon: String(g.C.lon), boundingbox: [String(ll(0, -400).lat), String(ll(0, 400).lat), String(ll(-560, 0).lon), String(ll(560, 0).lon)],
        display_name: '東京ディズニーランド（テスト）, 舞浜, 浦安市, 千葉県, 日本', category: 'tourism', type: 'theme_park', name: '東京ディズニーランド（テスト）', importance: 0.8, address: { state: '千葉県', city: '浦安市', suburb: '舞浜' }, extratags: { tourism: 'theme_park' } } ],
      CTX: [ way(301, { building: 'yes', name: 'シンデレラ城' }, rect(10, 130, 80, 200)), way(302, { building: 'hotel', name: 'ホテル', 'building:levels': '12' }, rect(-700, 100, -620, 180)), way(303, { building: 'commercial' }, rect(-80, -330, 80, -280)),
        way(304, { building: 'yes' }, rect(-420, 20, -360, 80)), way(305, { building: 'yes' }, rect(200, -120, 290, -50)), way(306, { building: 'yes' }, rect(260, 80, 340, 160)),
        way(310, { highway: 'primary' }, [ll(-900, -480), ll(0, -470), ll(900, -490)]), way(311, { highway: 'secondary' }, [ll(-640, -450), ll(-660, 0), ll(-640, 450)]), way(312, { highway: 'footway' }, [ll(0, -380), ll(0, -100), ll(40, 120)]), way(313, { highway: 'footway' }, [ll(-400, 100), ll(-100, 40), ll(200, 60)]), way(314, { highway: 'service' }, [ll(-500, -300), ll(500, -300)]),
        way(320, { natural: 'water' }, ring(80, 50, 14, 0.2).map(p => ({ lat: p.lat - 0.0003, lon: p.lon + 0.0004 }))), way(321, { leisure: 'park' }, rect(-500, 250, -250, 360)), way(322, { landuse: 'grass' }, rect(280, -300, 520, -200)),
        way(330, { amenity: 'parking' }, rect(-320, -540, 320, -420)), way(331, { railway: 'rail' }, [ll(-900, -560), ll(900, -570)]) ],
      NAMED: named,
      D: { name: '東京ディズニーランド', kind: 'park', addr: '千葉県浦安市舞浜1-1', sum: 'ファンタジーあふれるテーマパーク（テスト用データ）。', hours: '9:00〜21:00（日により変わる）', access: 'JR舞浜駅から徒歩5分', web: 'https://www.tokyodisneyresort.jp/tdl/', lat: g.C.lat, lon: g.C.lon,
        buildings: [], zones: [{ id: 'z1', n: 'ワールドバザール', pos: '入口付近（南）' }, { id: 'z2', n: 'アドベンチャーランド', pos: '西' }, { id: 'z3', n: 'ファンタジーランド', pos: '中央から北' }, { id: 'z4', n: 'トゥモローランド', pos: '東' }], tips: ['平日でも混みます'], notes: '' },
      list(label) {
        const Z = {
          'ワールドバザール': [['ワールドバザール', 'shop', '入口のショッピングアーケード', '', '入口付近'], ['シアター・オーリンズ', 'show', 'ショー', '', ''], ['パーク案内所', 'facility', '', '', '入口'], ['ブルーバイユー・レストラン', 'food', '', '', ''], ['ミート・ザ・ワールド', 'show', '', '', '']],
          'アドベンチャーランド': [['ジャングルクルーズ', 'ride', '', '', '西'], ['カリブの海賊', 'ride', '', '', ''], ['魅惑のチキルーム', 'show', '', '', ''], ['スイスファミリー・ツリーハウス', 'play', '', '', ''], ['ロイヤルストリート・ベランダ', 'food', '', '', ''], ['トイレ', 'wc', '', '', '']],
          'ファンタジーランド': [['シンデレラ城', 'show', '', '', '中央'], ['プーさんのハニーハント', 'ride', '', '', ''], ['イッツ・ア・スモールワールド', 'ride', '', '', ''], ['空飛ぶダンボ', 'ride', '', '', ''], ['ホーンテッドマンション', 'ride', '', '', '西'], ['キャッスルカルーセル', 'ride', '', '', ''], ['ミッキーのフィルハーマジック', 'show', '', '', ''], ['ビリーブ！シー・オブ・ドリームス', 'show', '', '', ''], ['クイーン・オブ・ハートのバンケットホール', 'food', '', '', ''], ['トイレ', 'wc', '', '', '']],
          'トゥモローランド': [['スペース・マウンテン', 'ride', '', '', '東'], ['ビッグサンダー・マウンテン', 'ride', '', '', ''], ['スター・ツアーズ', 'ride', '', '', ''], ['バズ・ライトイヤーのアストロブラスター', 'ride', '', '', ''], ['モンスターズ・インク"ライド＆ゴーシーク！"', 'ride', '', '', ''], ['プラザ・ペイブメント', 'food', '', '', ''], ['トイレ', 'wc', '', '', '']] };
        for (const k of Object.keys(Z)) if (label.indexOf(k) >= 0) return L(Z[k]);
        if (/出入口|駅|駐車場|共通/.test(label)) return L([['エントランスゲート', 'gate', '入場ゲート', '', ''], ['舞浜駅', 'gate', 'JR京葉線', '', ''], ['駐車場', 'parking', '', '', ''], ['ベビーセンター', 'facility', '', '', ''], ['東京ディズニーランド・ホテル', 'service', '', '', '']], 'out');
        return '[]';
      } };
  })();

  /* ---------- store（コストコ幕張倉庫店風。約150m×95mの1棟）---------- */
  const store = (() => {
    const g = mk({ lat: 35.6476, lon: 140.0305 }), { ll, rect, way, node } = g;
    const SITE = rect(-75, -48, 75, 48);
    return { g, id: 'W616161', SITE, kw: /コストコ|倉庫店/,
      NOM: [ { osm_type: 'way', osm_id: 616161, lat: String(g.C.lat), lon: String(g.C.lon), boundingbox: [String(ll(0, -48).lat), String(ll(0, 48).lat), String(ll(-75, 0).lon), String(ll(75, 0).lon)],
        display_name: 'コストコ 幕張倉庫店（テスト）, 美浜区, 千葉市, 千葉県, 日本', category: 'shop', type: 'wholesale', name: 'コストコ 幕張倉庫店（テスト）', importance: 0.5, address: { state: '千葉県', city: '千葉市', city_district: '美浜区' }, extratags: {} } ],
      CTX: [ way(401, { building: 'retail', shop: 'wholesale', name: 'コストコ 幕張倉庫店（テスト）' }, SITE), way(402, { building: 'yes' }, rect(120, -40, 170, 10)), way(403, { building: 'warehouse' }, rect(-200, 60, -140, 120)),
        way(410, { highway: 'secondary' }, [ll(-300, -120), ll(0, -118), ll(300, -122)]), way(411, { highway: 'service' }, [ll(-100, -110), ll(-100, -60)]), way(420, { amenity: 'parking' }, rect(-140, -112, 140, -62)), way(421, { amenity: 'parking' }, rect(-120, 56, 120, 100)) ],
      NAMED: [ node(501, 0, -52, { name: '入口', entrance: 'main' }), node(502, 70, 20, { name: 'コストコ ガソリンスタンド', amenity: 'fuel' }) ],
      D: { name: 'コストコ 幕張倉庫店', kind: 'store', addr: '千葉県千葉市美浜区ひび野2-6', sum: '会員制の大型倉庫店（テスト用データ）。', hours: '10:00〜20:00', access: '海浜幕張駅からバス', web: 'https://www.costco.co.jp/', lat: g.C.lat, lon: g.C.lon, buildings: [], zones: [], tips: ['会員証が必要'], notes: '' },
      list(label) {
        if (/建物の外|出入口/.test(label)) return L([['ガソリンスタンド', 'service', '', '', ''], ['駐車場', 'parking', '', '', ''], ['カートステーション', 'facility', '', '', '']], 'out');
        return L([['生鮮食品（青果）', 'grocery', '', '', '入口から見て右奥'], ['精肉', 'grocery', '', '', '奥'], ['鮮魚', 'grocery', '', '', '奥'], ['ベーカリー', 'cafe', '', '', '右'], ['お惣菜', 'grocery', '', '', '右'], ['冷凍食品', 'grocery', '', '', '中央'], ['飲料・酒', 'grocery', '', '', '左'], ['お菓子', 'grocery', '', '', '中央'], ['日用品', 'goods', '', '', '左'],
          ['家電', 'goods', '', '', '左手前'], ['衣料品', 'fashion', '', '', '入口付近'], ['タイヤセンター', 'service', '', '', '左奥'], ['フードコート', 'food', '', '', '入口の右'], ['会員カウンター', 'service', '', '', '入口の左'], ['レジ', 'service', '', '', '出口前'], ['薬局', 'service', '', '', ''], ['メガネ売り場', 'service', '', '', ''], ['トイレ', 'wc', '', '', '入口付近']]);
      } };
  })();

  const SC = [mall, park, store];
  const byName = s => SC.find(x => x.kw.test(s)) || mall;
  const byLatLon = (lat, lon) => SC.map(x => [Math.hypot(x.g.C.lat - lat, x.g.C.lon - lon), x]).sort((a, b) => a[0] - b[0])[0][1];
  window.__mock = { calls, C: mall.g.C, ll: mall.g.ll, rect: mall.g.rect, SC };

  const ai = async (system, user, o) => {
    calls.ai.push({ user: String(user).slice(0, 140), search: !!(o && o.search) });
    await new Promise(r => setTimeout(r, window.__mockAiMs || 20));
    if (o && o.signal && o.signal.aborted) throw { code: 'cancelled' };
    const sc = byName(String(user).slice(0, 220));
    if (window.__mockAiFail && /この場所について、次のJSON/.test(user)) throw { code: 'upstream_error' };
    if (/この場所について、次のJSON/.test(user)) return '調べました。\n```json\n' + JSON.stringify(sc.D, null, 1) + '\n```';
    if (/もうなければ \[\]/.test(user)) return '[]';
    const m = user.match(/「([^」]*)」の「([^」]*)」にある/); const label = m ? m[2] : '';
    if (window.__mockListFail && !/建物の外/.test(label)) throw { code: 'forbidden' };
    const txt = sc.list(label);
    return /^\[/.test(txt.trim()) ? '```json\n' + txt + (/```\s*$/.test(txt) ? '' : '\n```') : txt;
  };
  const fetchMock = async (url, init) => {
    url = String(url); calls.fetch.push(url.slice(0, 400));
    await new Promise(r => setTimeout(r, 10));
    if (/nominatim\.openstreetmap\.org\/search/.test(url)) {
      const q = decodeURIComponent((url.match(/[?&]q=([^&]*)/) || [])[1] || ''); if (/nothing|zzz/.test(q)) return []; if (window.__mockNomFail) throw new Error('net');
      if (window.__mockDecoy) {
        /* 本物のNominatimの弱点の再現：「コストコ 海浜」だと別の県のコストコが出る。地名のまわり(bounded)で探せば近くのが出る */
        if (/[?&]bounded=1/.test(url)) return store.NOM;
        if (/^(海浜|幕張)$/.test(q)) return [{ osm_type: 'node', osm_id: 999, lat: String(store.g.C.lat), lon: String(store.g.C.lon), boundingbox: [String(store.g.C.lat - 0.002), String(store.g.C.lat + 0.002), String(store.g.C.lon - 0.002), String(store.g.C.lon + 0.002)], display_name: '海浜幕張, 美浜区, 千葉市, 千葉県, 日本', category: 'railway', type: 'station', name: '海浜幕張', importance: 0.4, address: { state: '千葉県', city: '千葉市' }, extratags: {} }];
        if (/コストコ/.test(q)) return [{ osm_type: 'way', osm_id: 888, lat: '35.304', lon: '136.699', boundingbox: ['35.303', '35.305', '136.698', '136.700'], display_name: 'コストコ, 上中町長塚, 羽島市, 岐阜県, 日本', category: 'shop', type: 'wholesale', name: 'コストコ', importance: 0.5, address: { state: '岐阜県', city: '羽島市' }, extratags: {} }];
      }
      return byName(q).NOM;
    }
    if (/nominatim\.openstreetmap\.org\/lookup/.test(url)) { if (window.__mockNoOutline) return [{}]; const id = (url.match(/osm_ids=([A-Z]\d+)/) || [])[1]; const sc = SC.find(x => x.id === id) || mall; return [{ geojson: { type: 'Polygon', coordinates: [sc.SITE.map(p => [p.lon, p.lat])] } }]; }
    if (init && init.method === 'POST') {
      /* 同時に何本聞かれているか（公開サーバーに同時に2本は聞かない、を確かめる用） */
      window.__ovInflight = (window.__ovInflight || 0) + 1; window.__ovMax = Math.max(window.__ovMax || 0, window.__ovInflight); (window.__ovStarts = window.__ovStarts || []).push(Math.round(performance.now()));
      try {
        /* サーバーごとの不調の再現: { 'overpass-api.de': 'slow:2000' | 'fail' | 'failn:1'(最初のN回だけ失敗) } */
        const badKey = window.__mockOvBad && Object.keys(window.__mockOvBad).find(k => url.includes(k));
        if (badKey) {
          const v = window.__mockOvBad[badKey];
          if (v === 'fail') throw new Error('overpass down ' + badKey);
          if (/^failn:/.test(v)) { const c = (window.__mockOvCnt = window.__mockOvCnt || {}); c[badKey] = (c[badKey] || 0) + 1; if (c[badKey] <= +v.slice(6)) throw new Error('overpass busy ' + badKey); }
          if (/^slow:/.test(v)) await new Promise(r => setTimeout(r, +v.slice(5)));
        }
        if (badKey && window.__mockOvBad[badKey] === 'remark') return { elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 25 seconds.' };   /* 本物: 間に合わないと空っぽの結果+remark を返す */
        if (window.__mockOvFail) throw new Error('overpass down');
        const q = decodeURIComponent(String(init.body || '').replace(/^data=/, ''));
        const bb = q.match(/\((-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)\)/); const sc = bb ? byLatLon((+bb[1] + +bb[3]) / 2, (+bb[2] + +bb[4]) / 2) : mall;
        if (/out geom tags/.test(q)) return { elements: window.__mockNoNamed ? [] : sc.NAMED };
        return { elements: sc.CTX };
      } finally { window.__ovInflight--; }
    }
    throw new Error('unmocked ' + url);
  };
  const wx = async (lat, lon) => {
    calls.wx++;
    if (window.__mockWxFail) throw new Error('wx');
    const hrs = []; for (let i = 0; i < 12; i++) hrs.push({ t: '2026-10-28T' + String(10 + i).padStart(2, '0') + ':00', v: 21 - Math.abs(i - 3), p: i > 8 ? 60 : 10, c: i > 8 ? 61 : 1 });
    return { at: Date.now(), lat, lon, t: 21.4, feel: 20.3, hum: 62, wind: 3.2, rain: 0, code: 2, day: true, time: '2026-10-28T10:00', tmax: 24.1, tmin: 15.2, pop: 20, sunrise: '2026-10-28T05:51', sunset: '2026-10-28T17:02', hours: hrs };
  };
  MM.test.fetch = fetchMock; MM.test.ai = ai; MM.test.wx = wx;
  if (MM._t && MM._t.OSMX) { MM._t.OSMX.retryMs = 50; MM._t.OSMX._good = {}; }   /* すぐ断られたあとの「もう一度」の待ちを、テストでは短く */
  void rnd;
  return true;
}
