// コトダマ用 中継サーバー: ブラウザ → このPCのClaude Code(ログイン済み) → ブラウザ
// 使い方: node server.mjs   (Node 18 以上 / claude コマンドにログイン済みであること)
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 8787);
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const ORIGINS = (process.env.ORIGINS || 'https://tanakatakeshi811-spec.github.io').split(',').map(s => s.trim()).filter(Boolean);
const MAX_PARALLEL = 3;
const TIMEOUT_MS = 10 * 60 * 1000;

// Claude Code の設定やCLAUDE.mdを拾わないよう、何もない専用フォルダで動かす
const WORK = path.join(os.tmpdir(), 'kotodama-relay');
fs.mkdirSync(WORK, { recursive: true });

const SYSTEM = 'You are a helpful assistant. The user message contains the instructions and the conversation; follow them exactly and answer only with your next reply.';
let running = 0;

function originOk(o) {
  if (!o) return false;
  if (ORIGINS.includes(o)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o);
}

function cors(req, res) {
  const o = req.headers.origin;
  if (o && originOk(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }
  return false;
}

function aliasOf(model, tier) {
  const s = String(model || '');
  if (/haiku/.test(s)) return 'haiku';
  if (/sonnet/.test(s)) return 'sonnet';
  if (/opus|fable/.test(s)) return 'opus';
  return { quick: 'haiku', default: 'sonnet', complex: 'opus' }[tier] || 'sonnet';
}

function buildPrompt(turns) {
  if (typeof turns === 'string') return turns;
  const list = Array.isArray(turns) ? turns : [];
  if (list.length <= 1) return String((list[0] && list[0].content) || '');
  const head = String(list[0].content || '');
  const rest = list.slice(1);
  if (rest.length === 1) return head + '\n\n――――\n' + rest[0].content;
  const log = rest.map(t => (t.role === 'assistant' ? 'アシスタント' : 'ユーザー') + ':\n' + t.content).join('\n\n');
  return head + '\n\n――――\n【ここまでの会話】\n' + log + '\n\n――――\n上の会話の続きとして、アシスタントの次の返答だけを書いてください。';
}

function runClaude({ prompt, model, effort }, onDelta, onClose) {
  const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
    '--tools', '', '--no-session-persistence', '--setting-sources', '', '--disable-slash-commands',
    '--system-prompt', SYSTEM, '--model', model];
  if (effort) args.push('--effort', effort);
  const child = spawn(CLAUDE, args, { cwd: WORK, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buf = '', err = '', got = false, usedModel = null, truncated = false, resultErr = null, finished = false;
  const done = r => { if (finished) return; finished = true; clearTimeout(timer); onClose(r); };
  const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
  child.stdout.on('data', d => {
    buf += d.toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
      if (ev.type === 'stream_event' && ev.event) {
        const e = ev.event;
        if (e.type === 'message_start' && e.message) usedModel = e.message.model || usedModel;
        else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') { got = true; onDelta(e.delta.text); }
        else if (e.type === 'message_delta' && e.delta && e.delta.stop_reason === 'max_tokens') truncated = true;
      } else if (ev.type === 'result') {
        if (ev.is_error) resultErr = String(ev.result || ev.subtype || 'error');
        else if (!got && ev.result) { got = true; onDelta(String(ev.result)); }
      }
    }
  });
  child.stderr.on('data', d => { err += d.toString('utf8'); });
  child.on('error', e => done({ ok: false, error: 'spawn: ' + e.message, got }));
  child.on('close', code => {
    if (resultErr || (code !== 0 && !got)) done({ ok: false, error: resultErr || err.trim().slice(-400) || 'exit ' + code, got });
    else done({ ok: true, model: usedModel, truncated, got });
  });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt, 'utf8');
  return child;
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

const server = http.createServer(async (req, res) => {
  const allowed = cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403); return res.end(); }
  if (req.headers.origin && !allowed) return json(res, 403, { error: 'origin_not_allowed' });
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/ping') return json(res, 200, { ok: true, name: 'kotodama-relay', v: 1 });

  if (req.method === 'POST' && url === '/ask') {
    if (running >= MAX_PARALLEL) return json(res, 429, { error: 'busy' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: 'bad_request' }); }
    const prompt = buildPrompt(body.turns);
    if (!prompt.trim()) return json(res, 400, { error: 'empty' });
    const alias = aliasOf(body.model, body.tier);
    const effort = ['low', 'medium', 'high', 'xhigh', 'max'].includes(body.effort) ? body.effort : null;

    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
    const send = o => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    running++;
    let child = null, closed = false;
    const finish = () => { if (!closed) { closed = true; running--; } };
    res.on('close', () => { if (child && !closed) child.kill(); finish(); });

    const attempt = (eff, retry) => {
      child = runClaude({ prompt, model: alias, effort: eff }, t => send({ type: 'delta', text: t }), r => {
        if (!r.ok && !r.got && retry) return attempt(null, false);
        if (r.ok) send({ type: 'done', model: r.model, truncated: r.truncated });
        else send({ type: 'error', message: r.error });
        finish(); res.end();
      });
    };
    attempt(effort, !!effort);
    return;
  }

  json(res, 404, { error: 'not_found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('コトダマ中継サーバーを起動しました');
  console.log('  待ち受け : http://127.0.0.1:' + PORT);
  console.log('  許可する画面 : ' + ORIGINS.join(', ') + ' と localhost');
  console.log('  このウィンドウを開いている間だけ、コトダマからあなたのClaudeを使えます。閉じるか Ctrl+C で止まります。');
});
