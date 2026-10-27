
/* ---------- テスト用の差し替え口（本番では使わない）---------- */
const T = { fetch: null, ai: null, geo: null, noWx: false };

/* ---------- OpenStreetMap：場所さがし・建物・道・水・緑・名前のある場所 ----------
   Nominatim（場所さがし）と Overpass（地図データ）はキー不要で、ブラウザから直接つなげる。 */
const OSMX = {
  async jfetch(url, init, ms, signal) {
    if (T.fetch) return T.fetch(url, init || {});
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms || 20000);
    const onAbort = () => ctl.abort();
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal }, init || {}));
      if (!r.ok) throw Object.assign(new Error('http ' + r.status), { status: r.status });
      return await r.json();
    } catch (e) { if (signal && signal.aborted) throw { code: 'cancelled' }; throw e; }
    finally { clearTimeout(to); if (signal) signal.removeEventListener('abort', onAbort); }
  },
  /* 場所の種類をことばと分類から推し量る */
  guessKind(r) {
    const cls = String(r.category || r.class || ''), ty = String(r.type || ''), nm = String(r.name || r.display_name || '');
    const ex = r.extratags || {};
    if (/theme_park|amusement_park|water_park|zoo|aquarium|resort/.test(ty) || ex.tourism === 'theme_park' || /ディズニー|ユニバーサル|ランド|シー$|遊園地|パーク|動物園|水族館|ハウステンボス|ナガシマ|富士急|サンリオ|レゴランド|牧場|フラワーパーク|植物園|テーマパーク/.test(nm)) return 'park';
    if (ty === 'mall' || /モール|ららぽーと|アウトレット|ショッピング|パルコ|百貨店|デパート|ルミネ|ラゾーナ|ヴィーナス|ビビット|リゾナーレ|ゆめタウン|アリオ|イオン(?!ス)|マルイ|高島屋|三越|大丸|阪急|髙島屋|そごう|西武|ステーションビル|地下街|アーケード|商店街/.test(nm)) return 'mall';
    if (/supermarket|wholesale|department_store|doityourself|hardware|furniture|electronics|variety_store|convenience|garden_centre/.test(ty) || /コストコ|ドン・キホーテ|ドンキ|ニトリ|ホームセンター|スーパー|マーケット|ヨドバシ|ビックカメラ|IKEA|イケア|カインズ|ヤマダ|ジョーシン|ケーズ|トライアル|業務スーパー|ロピア|ダイソー|ユニクロ|無印|しまむら|ロフト|東急ハンズ|ハンズ|ベイシア|オーケー/.test(nm)) return 'store';
    if (/station|aerodrome|terminal|halt|airport/.test(ty) || cls === 'railway' || cls === 'aeroway' || /駅$|空港|ターミナル|バスタ/.test(nm)) return 'station';
    if (/university|college|school|hospital|stadium|arena|museum|library|townhall|sports_centre/.test(ty) || /大学|学校|高校|病院|スタジアム|ドーム|アリーナ|体育館|美術館|博物館|図書館|市役所/.test(nm)) return 'campus';
    if (cls === 'shop') return 'store';
    return 'other';
  },
  cand(r) {
    const bb = (r.boundingbox || []).map(Number);
    const name = (r.namedetails && (r.namedetails['name:ja'] || r.namedetails.name)) || r.name || String(r.display_name || '').split(',')[0];
    const parts = String(r.display_name || '').split(',').map(s => s.trim()).filter(Boolean);
    const a = r.address || {};
    const addr = [a.state || a.province, a.city || a.town || a.village || a.county || a.municipality, a.city_district || a.suburb || a.quarter, a.neighbourhood, a.road, a.house_number].filter(Boolean);
    const label = addr.length >= 2 ? [...new Set(addr)].join(' ') : parts.slice(1, 5).reverse().join(' ');
    const t = (r.osm_type || 'node')[0].toUpperCase();
    return { id: t + r.osm_id, osmType: r.osm_type, osmId: r.osm_id, name, label, lat: +r.lat, lon: +r.lon, bbox: bb.length === 4 && bb.every(isFinite) ? bb : null, cls: r.category || r.class || '', type: r.type || '', kind: this.guessKind(Object.assign({ name }, r)), imp: r.importance || 0 };
  },
  async search(q, bias, signal) {
    const vb = bias && isFinite(bias.lat) ? `&viewbox=${bias.lon - 1.2},${bias.lat + 1},${bias.lon + 1.2},${bias.lat - 1}` : '';
    const j = await this.jfetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&accept-language=ja&limit=10&addressdetails=1&extratags=1&namedetails=1${vb}`, null, 15000, signal);
    const out = [], seen = new Set();
    for (const r of j || []) {
      const c = this.cand(r); if (!isFinite(c.lat) || !isFinite(c.lon)) continue;
      /* 行政区画（県・市など）は、お店や施設ではないので後ろに回す */
      c.admin = r.category === 'boundary' || r.category === 'place' && !/house|building|yes/.test(r.type || '');
      const key = nameKey(c.name) + '|' + Math.round(c.lat * 400) + '|' + Math.round(c.lon * 400);
      if (seen.has(key)) continue; seen.add(key); out.push(c);
    }
    out.sort((a, b) => (a.admin - b.admin) || (b.imp - a.imp));
    return out;
  },
  /* 敷地の輪郭（建物や公園のふち）を取り出す。点だけの結果なら null */
  async outline(c, signal) {
    if (!c.osmType || c.osmType === 'node') return null;
    try {
      const j = await this.jfetch(`https://nominatim.openstreetmap.org/lookup?osm_ids=${c.osmType[0].toUpperCase()}${c.osmId}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.00003&accept-language=ja`, null, 15000, signal);
      const g = j && j[0] && j[0].geojson; if (!g) return null;
      let rings = [];
      if (g.type === 'Polygon') rings = [g.coordinates[0]];
      else if (g.type === 'MultiPolygon') rings = g.coordinates.map(p => p[0]);
      rings = rings.filter(r => r && r.length >= 4);
      if (!rings.length) return null;
      return rings.map(r => r.map(([lo, la]) => ({ lat: la, lon: lo })));
    } catch (e) { if (e && e.code === 'cancelled') throw e; return null; }
  },
  OV() { return (typeof Geo !== 'undefined' && Geo.OVERPASS) || ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']; },
  async overpass(q, ms, signal) {
    const urls = this.OV(), start = (this._try = (this._try || 0) + 1) % urls.length;
    let lastErr = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const j = await this.jfetch(urls[(start + i) % urls.length], { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' } }, ms || 40000, signal);
        if (j && Array.isArray(j.elements)) return j;
      } catch (e) { if (e && e.code === 'cancelled') throw e; lastErr = e; }
    }
    throw lastErr || new Error('overpass');
  },
  /* b = [南, 西, 北, 東]（まわり全体）, f = 細い道（歩道・園路）まで取る範囲 */
  ctxQuery(b, f) {
    const box = v => `(${v.map(x => x.toFixed(5)).join(',')})`, bb = box(b), fb = box(f || b);
    return `[out:json][timeout:45][maxsize:268435456];(`
      + `way["building"]${bb};relation["building"]${bb};`
      + `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]${bb};`
      + `way["highway"~"^(service|pedestrian|footway|path|steps|cycleway|track)$"]${fb};`
      + `way["railway"~"^(rail|light_rail|subway|tram|monorail|narrow_gauge|funicular)$"]${bb};`
      + `way["natural"~"^(water|wood|scrub|grassland|wetland|bay)$"]${bb};relation["natural"="water"]${bb};way["waterway"~"^(river|stream|canal|drain|riverbank)$"]${bb};way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|orchard|vineyard|cemetery|reservoir|basin)$"]${bb};`
      + `way["leisure"~"^(park|garden|pitch|playground|golf_course|common|dog_park|nature_reserve|swimming_pool|water_park)$"]${bb};relation["leisure"~"^(park|garden)$"]${bb};`
      + `way["amenity"="parking"]${bb};way["aeroway"~"^(apron|runway|taxiway|terminal)$"]${bb};`
      + `);out geom qt;`;
  },
  namedQuery(b) {
    const bb = `(${b.map(v => v.toFixed(5)).join(',')})`;
    return `[out:json][timeout:45][maxsize:268435456];(`
      + `nw["name"]["shop"]${bb};nw["name"]["amenity"]${bb};nw["name"]["tourism"]${bb};nw["name"]["leisure"]${bb};nw["name"]["attraction"]${bb};`
      + `nw["name"]["railway"~"^(station|halt|tram_stop|subway_entrance)$"]${bb};nw["name"]["aeroway"~"^(terminal|gate)$"]${bb};nw["name"]["office"]${bb};nw["name"]["historic"]${bb};`
      + `nw["name"]["man_made"~"^(tower|lighthouse|windmill|bridge)$"]${bb};nw["name"]["building"~"^(commercial|retail|kiosk|train_station|hotel|civic|public|church|temple|shrine|stadium|hospital|university|school|supermarket|transportation)$"]${bb};`
      + `);out geom tags qt;`;
  },
};

/* ---- OSMの結果をことだまの形に ---- */
const BH = { house: 7, detached: 7, residential: 12, apartments: 18, dormitory: 15, hotel: 25, office: 22, commercial: 14, retail: 10, supermarket: 7, warehouse: 9, industrial: 10, garage: 3, garages: 3, carport: 3, shed: 3, roof: 4, church: 14, cathedral: 22, temple: 12, shrine: 8, school: 12, university: 16, hospital: 20, train_station: 12, stadium: 25, parking: 12, civic: 14, public: 12, yes: 8 };
function heightOf(t) {
  const h = parseFloat(String(t.height || '').replace(',', '.'));
  if (isFinite(h) && h > 0) return clamp(h, 2, 300);
  const lv = parseFloat(t['building:levels']);
  if (isFinite(lv) && lv > 0) return clamp(lv * 3.4 + 1, 3, 300);
  return BH[t.building] || 8;
}
const ROADW = { motorway: 15, trunk: 14, primary: 12, secondary: 10, tertiary: 8, unclassified: 6, residential: 6, service: 4, living_street: 5, road: 5, motorway_link: 8, trunk_link: 8, primary_link: 7, secondary_link: 6, tertiary_link: 5, pedestrian: 5, footway: 2.4, path: 2, steps: 2.4, cycleway: 2.6, track: 3.2 };
const roadClass = h => (/^(motorway|trunk|primary|secondary|tertiary)/.test(h) ? 'm' : /^(unclassified|residential|service|living_street|road)$/.test(h) ? 'n' : 'p');
function joinRings(segs) {
  const rings = [], rest = segs.map(s => s.slice()), eq = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.4;
  while (rest.length) {
    let cur = rest.shift();
    for (let guard = 0; guard < 800; guard++) {
      if (cur.length > 3 && eq(cur[0], cur[cur.length - 1])) break;
      let found = false;
      for (let i = 0; i < rest.length; i++) {
        const s = rest[i];
        if (eq(cur[cur.length - 1], s[0])) { cur = cur.concat(s.slice(1)); rest.splice(i, 1); found = true; break; }
        if (eq(cur[cur.length - 1], s[s.length - 1])) { cur = cur.concat(s.slice(0, -1).reverse()); rest.splice(i, 1); found = true; break; }
        if (eq(cur[0], s[s.length - 1])) { cur = s.slice(0, -1).concat(cur); rest.splice(i, 1); found = true; break; }
        if (eq(cur[0], s[0])) { cur = s.slice(1).reverse().concat(cur); rest.splice(i, 1); found = true; break; }
      }
      if (!found) break;
    }
    if (cur.length >= 4 && eq(cur[0], cur[cur.length - 1])) rings.push(cur.slice(0, -1));
  }
  return rings;
}
function elRings(el, o) {
  const xy = g => llToXY(o, g.lat, g.lon);
  if (el.type === 'way' && el.geometry) {
    const p = el.geometry.map(xy);
    if (p.length >= 4 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.5) return [p.slice(0, -1)];
    return [];
  }
  if (el.type === 'relation' && el.members) {
    const outs = []; for (const m of el.members) if (m.type === 'way' && m.geometry && m.role !== 'inner') outs.push(m.geometry.map(xy));
    return joinRings(outs);
  }
  return [];
}
const roundPts = (p, k = 1) => p.map(q => [Math.round(q[0] * (10 / k)) / (10 / k), Math.round(q[1] * (10 / k)) / (10 / k)]);
/* 周りの地形（建物・道・水・緑・駐車場）。origin からの距離が近いものを優先して数を絞る */
function parseCtx(elements, o, lim) {
  lim = Object.assign({ b: 900, r: 1300, w: 120, g: 220, k: 220 }, lim || {});
  const out = { b: [], r: [], w: [], wl: [], g: [], k: [] };
  const dist = p => { const c = polyCentroid(p); return Math.hypot(c[0], c[1]); };
  for (const el of elements || []) {
    const t = el.tags || {};
    if (t.building && t.building !== 'no') {
      for (const ring of elRings(el, o)) { if (ring.length < 3) continue; const a = Math.abs(polyArea(ring)); if (a < 12) continue; out.b.push({ p: ccw(dp(ring, 0.6)), h: heightOf(t), n: t.name || '', ty: t.building, a, d: dist(ring) }); }
    } else if (t.highway && el.type === 'way' && el.geometry) {
      if (/^(proposed|construction|platform|bus_stop|elevator|corridor|raceway)$/.test(t.highway) || t.area === 'yes') continue;
      const p = dp(el.geometry.map(g => llToXY(o, g.lat, g.lon)), 1.2); if (p.length < 2) continue;
      out.r.push({ p, w: ROADW[t.highway] || 4, t: roadClass(t.highway), d: dist(p), br: t.bridge && t.bridge !== 'no' ? 1 : 0, tn: t.tunnel && t.tunnel !== 'no' ? 1 : 0 });
    } else if (t.railway && el.type === 'way' && el.geometry) {
      const p = dp(el.geometry.map(g => llToXY(o, g.lat, g.lon)), 1.5); if (p.length < 2) continue;
      out.r.push({ p, w: 3, t: 'r', d: dist(p), tn: t.tunnel && t.tunnel !== 'no' ? 1 : 0 });
    } else if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'riverbank' || t.natural === 'bay' || t.leisure === 'swimming_pool' || t.leisure === 'water_park') {
      for (const ring of elRings(el, o)) if (ring.length >= 3 && Math.abs(polyArea(ring)) > 15) out.w.push({ p: ccw(dp(ring, 1.5)), d: dist(ring) });
    } else if (t.waterway && el.type === 'way' && el.geometry) {
      const p = dp(el.geometry.map(g => llToXY(o, g.lat, g.lon)), 1.5); if (p.length >= 2) out.wl.push({ p, w: t.waterway === 'river' ? 14 : t.waterway === 'canal' ? 9 : 3.5, d: dist(p) });
    } else if (/^(park|garden|pitch|playground|golf_course|common|dog_park|nature_reserve)$/.test(t.leisure || '') || /^(grass|forest|meadow|recreation_ground|village_green|orchard|vineyard|cemetery)$/.test(t.landuse || '') || /^(wood|scrub|grassland|wetland)$/.test(t.natural || '')) {
      for (const ring of elRings(el, o)) if (ring.length >= 3 && Math.abs(polyArea(ring)) > 40) out.g.push({ p: ccw(dp(ring, 1.5)), d: dist(ring), a: Math.abs(polyArea(ring)) });
    } else if (t.amenity === 'parking' || /^(apron|runway|taxiway|terminal)$/.test(t.aeroway || '')) {
      for (const ring of elRings(el, o)) if (ring.length >= 3 && Math.abs(polyArea(ring)) > 60) out.k.push({ p: ccw(dp(ring, 1.2)), d: dist(ring) });
    }
  }
  const nearest = (arr, n) => (arr.length > n ? arr.sort((a, b) => a.d - b.d).slice(0, n) : arr);
  /* 大きな緑・水は、遠くても残す（背景として必要）。小さな建物は遠いものから落とす */
  out.b = nearest(out.b, lim.b).map(x => ({ p: roundPts(x.p), h: Math.round(x.h * 10) / 10, n: x.n || undefined, ty: x.ty === 'yes' ? undefined : x.ty }));
  out.r = nearest(out.r, lim.r).map(x => ({ p: roundPts(x.p), w: x.w, t: x.t, br: x.br || undefined, tn: x.tn || undefined }));
  out.w = nearest(out.w, lim.w).map(x => roundPts(x.p, 2));
  out.wl = nearest(out.wl, 80).map(x => ({ p: roundPts(x.p, 2), w: x.w }));
  out.g = out.g.sort((a, b) => b.a - a.a).slice(0, lim.g).map(x => roundPts(x.p, 2));
  out.k = nearest(out.k, lim.k).map(x => roundPts(x.p, 2));
  return out;
}

/* ---- OSMにのっている「名前のある場所」→ お店・アトラクションなどの候補 ---- */
const NAME_OK_SHOP = /./;
function catFromTags(t) {
  const a = t.amenity, s = t.shop, to = t.tourism, le = t.leisure;
  if (t.attraction && t.attraction !== 'none') return 'ride';
  if (a) {
    if (/^(restaurant|fast_food|food_court|bar|pub|biergarten)$/.test(a)) return 'food';
    if (/^(cafe|ice_cream)$/.test(a)) return 'cafe';
    if (a === 'toilets' || a === 'shelter' || a === 'bench') return 'wc';
    if (/^(parking|bicycle_parking|motorcycle_parking|bus_station|taxi|car_rental|bicycle_rental|ferry_terminal)$/.test(a)) return 'parking';
    if (/^(cinema|theatre|arts_centre|planetarium|events_venue|concert_hall|nightclub|studio)$/.test(a)) return 'show';
    if (/^(bank|atm|post_office|pharmacy|clinic|hospital|doctors|dentist|police|fire_station|townhall|library|community_centre|childcare|kindergarten|school|university|college|car_wash|fuel|charging_station|bureau_de_change|money_transfer|post_box|social_facility|veterinary)$/.test(a)) return 'service';
    if (/^(karaoke_box|amusement_arcade|gambling)$/.test(a)) return 'play';
    if (/^(information|fountain|clock|drinking_water|place_of_worship|marketplace|lounge|nursing_room|baby_hatch)$/.test(a)) return 'facility';
  }
  if (s) {
    if (/^(bakery|pastry|confectionery|chocolate|coffee|tea|ice_cream|dessert)$/.test(s)) return 'cafe';
    if (/^(supermarket|convenience|greengrocer|butcher|seafood|deli|alcohol|beverages|wine|cheese|farm|health_food|frozen_food|grocery|spices|nuts|rice|general)$/.test(s)) return 'grocery';
    if (/^(clothes|shoes|bag|jewelry|boutique|fashion|fashion_accessories|watches|lingerie|underwear|tailor|leather|fabric|textile|optician|wool|sewing|baby_goods|second_hand)$/.test(s)) return 'fashion';
    if (/^(furniture|houseware|variety_store|interior_decoration|kitchen|bed|doityourself|hardware|garden_centre|stationery|books|toys|games|gift|florist|pet|electronics|computer|mobile_phone|hifi|video_games|sports|outdoor|bicycle|musical_instrument|art|craft|antiques|photo|camera|lighting|carpet|curtain|paint|trade|tyres|car|car_parts|motorcycle|erotic|hobby|model|party|ticket|candles|frame|copyshop|printing|e-cigarette|tobacco)$/.test(s)) return 'goods';
    if (/^(hairdresser|beauty|cosmetics|perfumery|massage|laundry|dry_cleaning|travel_agency|money_lender|pawnbroker|tattoo|nails|chemist|medical_supply|hearing_aids|storage_rental|funeral_directors|locksmith|rental|mobile_phone_repair)$/.test(s)) return 'service';
    return 'shop';
  }
  if (to) {
    if (/^(museum|gallery)$/.test(to)) return 'show';
    if (/^(zoo|aquarium|theme_park)$/.test(to)) return 'ride';
    if (/^(hotel|hostel|guest_house|motel|apartment)$/.test(to)) return 'service';
    if (/^(information|picnic_site|viewpoint|artwork|attraction)$/.test(to)) return 'facility';
  }
  if (le) {
    if (/^(amusement_arcade|bowling_alley|miniature_golf|fitness_centre|sports_centre|water_park|playground|escape_game|trampoline_park|ice_rink|swimming_pool|adventure_park|dance|hackerspace|slipway|pitch|track)$/.test(le)) return 'play';
    if (le === 'stadium') return 'show';
    return 'facility';
  }
  if (t.railway || t.public_transport) return 'parking';
  if (t.aeroway) return 'gate';
  if (t.historic || t.man_made) return 'facility';
  if (t.office) return 'service';
  if (t.building) { if (/commercial|retail|supermarket|kiosk/.test(t.building)) return 'shop'; if (/hotel/.test(t.building)) return 'service'; if (/train_station|transportation/.test(t.building)) return 'parking'; return 'facility'; }
  return 'other';
}
function parseLevel(t) {
  const raw = String(t.level != null ? t.level : (t['addr:floor'] != null ? t['addr:floor'] : '')).split(';')[0].trim();
  if (!raw) return null;
  let v = parseFloat(raw); if (isFinite(v)) return Math.round(v);
  const m = raw.match(/^(B|b|地下)\s*(\d+)/); if (m) return -parseInt(m[2], 10);
  const f = raw.match(/^(\d+)\s*[Ff階]/); if (f) return parseInt(f[1], 10) - 1;
  return null;
}
function parseNamed(elements, o) {
  const out = [], seen = new Set();
  for (const el of elements || []) {
    const t = el.tags || {}; const name = t['name:ja'] || t.name; if (!name) continue;
    let x, y, ring = null;
    if (el.type === 'node') [x, y] = llToXY(o, el.lat, el.lon);
    else if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      const p = el.geometry.map(g => llToXY(o, g.lat, g.lon)); const closed = Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.5;
      if (closed && p.length >= 4) { ring = ccw(p.slice(0, -1)); [x, y] = polyCentroid(ring); } else { const b = bboxOf(p); x = (b[0] + b[2]) / 2; y = (b[1] + b[3]) / 2; }
    } else continue;
    const cat = catFromTags(t); if (cat === 'other' && !t.building) continue;
    const key = nameKey(name) + '|' + Math.round(x / 8) + '|' + Math.round(y / 8); if (seen.has(key)) continue; seen.add(key);
    const alt = [t['name:en'], t['name:ja-Hira'], t['name:ja_kana'], t.official_name, t['official_name:ja'], t.brand, t['brand:ja'], t.alt_name, t.short_name].filter(Boolean);
    const lv = parseLevel(t);
    out.push({ id: el.type[0] + el.id, n: name, alt, x: r1(x), y: r1(y), ring: ring ? roundPts(ring) : null, cat, lv, hrs: t.opening_hours || '', web: t.website || t['contact:website'] || '', tel: t.phone || t['contact:phone'] || '', ty: t.shop || t.amenity || t.tourism || t.leisure || t.attraction || t.railway || t.building || '', area: ring ? Math.abs(polyArea(ring)) : 0, bldg: !!t.building });
  }
  return out;
}
