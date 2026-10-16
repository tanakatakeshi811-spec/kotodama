// コトダマ 拡張機能の公開ギャラリー（Cloudflare Workers + KV）
// GET /list?q=  GET /item/<gid>  POST /publish {ext, author, gid?, token?}  POST /unpublish {gid, token}  POST /dl/<gid>
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS } });
const hex = a => [...a].map(b => b.toString(16).padStart(2, '0')).join('');
const rnd = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s || '')))));
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
function extOk(x) { return !!(x && typeof x.id === 'string' && x.id.length < 64 && Array.isArray(x.vers) && x.vers.length >= 1 && x.vers.length <= 30); }

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const KV = env.GALLERY;
    if (!KV) return J({ error: 'no_kv' }, 500);
    const u = new URL(req.url); const p = u.pathname.replace(/\/+$/, '') || '/';
    const index = async () => (await KV.get('index', 'json')) || [];
    try {
      if (req.method === 'GET' && p === '/') return J({ ok: true, name: 'kotodama-gallery' });
      if (req.method === 'GET' && p === '/list') {
        const q = str(u.searchParams.get('q'), 60).toLowerCase();
        const items = (await index()).filter(m => !q || (m.name + ' ' + m.desc + ' ' + m.author).toLowerCase().includes(q)).slice(0, 300);
        return J({ items });
      }
      if (req.method === 'GET' && p.startsWith('/item/')) {
        const rec = await KV.get('ext:' + decodeURIComponent(p.slice(6)), 'json');
        return rec ? J({ ext: rec.ext, author: rec.author }) : J({ error: 'not_found' }, 404);
      }
      if (req.method === 'POST' && p.startsWith('/dl/')) {
        const gid = decodeURIComponent(p.slice(4)); const ip = req.headers.get('cf-connecting-ip') || 'x';
        const k = 'dl:' + gid + ':' + ip; if (await KV.get(k)) return J({ ok: true });
        await KV.put(k, '1', { expirationTtl: 86400 });
        const idx = await index(); const m = idx.find(x => x.gid === gid); if (m) { m.dl = (m.dl || 0) + 1; await KV.put('index', JSON.stringify(idx)); }
        return J({ ok: true });
      }
      if (req.method === 'POST' && (p === '/publish' || p === '/unpublish')) {
        const raw = await req.text(); if (raw.length > 400000) return J({ error: 'too_big' }, 413);
        let b; try { b = JSON.parse(raw); } catch (e) { return J({ error: 'bad_request' }, 400); }
        const ip = req.headers.get('cf-connecting-ip') || 'x'; const rk = 'rl:' + ip + ':' + Math.floor(Date.now() / 3600000);
        const n = +(await KV.get(rk)) || 0; if (n >= 20) return J({ error: 'rate' }, 429);
        await KV.put(rk, String(n + 1), { expirationTtl: 3700 });
        let idx = await index();
        if (p === '/unpublish') {
          const rec = await KV.get('ext:' + str(b.gid, 40), 'json'); if (!rec) return J({ error: 'not_found' }, 404);
          if (await sha(b.token) !== rec.th) return J({ error: 'bad_token' }, 403);
          await KV.delete('ext:' + b.gid); idx = idx.filter(m => m.gid !== b.gid); await KV.put('index', JSON.stringify(idx));
          return J({ ok: true });
        }
        const x = b.ext; if (!extOk(x)) return J({ error: 'bad_ext' }, 400);
        const v = x.vers[x.vers.length - 1] || {};
        let gid, token = null, dl = 0;
        if (b.gid) {
          gid = str(b.gid, 40); const rec = await KV.get('ext:' + gid, 'json'); if (!rec) return J({ error: 'not_found' }, 404);
          if (await sha(b.token) !== rec.th) return J({ error: 'bad_token' }, 403);
          token = b.token; const old = idx.find(m => m.gid === gid); dl = old ? old.dl || 0 : 0;
        } else { gid = rnd(6); token = rnd(16); }
        const author = str(b.author, 30) || '名無し';
        await KV.put('ext:' + gid, JSON.stringify({ ext: x, author, th: await sha(token) }));
        const meta = { gid, name: str(v.name, 40), icon: str(v.icon, 8), desc: str(v.desc, 200), author, at: Date.now(), dl };
        idx = [meta, ...idx.filter(m => m.gid !== gid)].slice(0, 2000);
        await KV.put('index', JSON.stringify(idx));
        return J({ gid, token });
      }
      return J({ error: 'not_found' }, 404);
    } catch (e) { return J({ error: 'server_error' }, 500); }
  },
};
