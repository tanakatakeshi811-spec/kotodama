// コトダマ用 中継サーバー: ブラウザ → このPCのClaude Code(ログイン済み) → ブラウザ
// 使い方: node server.mjs   (Node 18 以上 / claude コマンドにログイン済みであること)
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 8787);
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const ORIGINS = (process.env.ORIGINS || 'https://tanakatakeshi811-spec.github.io').split(',').map(s => s.trim()).filter(Boolean);
const MAX_PARALLEL = 3;
const TIMEOUT_MS = 10 * 60 * 1000;
const PAGE = 'https://tanakatakeshi811-spec.github.io/kotodama/';

// 合言葉: 環境変数 RELAY_KEY か、同じフォルダの passphrase.txt（Gitには載せない）。外から（トンネル経由で）来た要求にだけ求める
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEYFILE = path.join(HERE, 'passphrase.txt');
const KEY = (process.env.RELAY_KEY || (fs.existsSync(KEYFILE) ? fs.readFileSync(KEYFILE, 'utf8') : '')).trim();
const isRemote = req => !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['x-forwarded-for']);
const sameKey = given => {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(KEY).digest();
  return !!KEY && crypto.timingSafeEqual(a, b);
};
// 合言葉の総当たり対策: 同じ相手が5回まちがえたら15分ロック。全体でも1時間に30回まちがえたら止める
const fails = new Map(); let globalFails = [];
const LOCK_MS = 15 * 60 * 1000;
const clientId = req => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || 'remote');
function locked(req) {
  const now = Date.now();
  globalFails = globalFails.filter(t => now - t < 3600000);
  if (globalFails.length >= 30) return true;
  const f = fails.get(clientId(req)); return !!(f && f.until > now);
}
function noteFail(req) {
  const now = Date.now(), id = clientId(req);
  const f = fails.get(id) || { n: 0, until: 0 };
  if (f.until && f.until <= now) { f.n = 0; f.until = 0; }
  f.n++; if (f.n >= 5) f.until = now + LOCK_MS;
  fails.set(id, f); globalFails.push(now);
}
// 戻り値: 'ok' | 'no_key'(未入力) | 'bad'(まちがい) | 'locked' | 'unset'(PC側に合言葉の設定なし)
function checkAuth(req) {
  if (!isRemote(req)) return 'ok';
  if (!KEY) return 'unset';
  if (locked(req)) return 'locked';
  const given = req.headers['x-relay-key'];
  if (!given) return 'no_key';
  if (sameKey(given)) { fails.delete(clientId(req)); return 'ok'; }
  noteFail(req); return 'bad';
}

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
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-relay-key');
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

// Claude Code が教えてくれる「使用制限の状態」（5時間の枠など）。最後に見たものを覚えておく
let lastLimits = null;

const SEARCH_ADD = ' When the question needs facts, recent information or verification, use the WebSearch and WebFetch tools before answering, then answer in the language of the user and cite the source URLs. Do not use any other tool.';
const describeTool = b => b.name === 'WebSearch' ? '検索: ' + String((b.input && b.input.query) || '') : b.name === 'WebFetch' ? '読み込み: ' + String((b.input && b.input.url) || '') : String(b.name || '');

/* ---- 速さのための工夫 ----
   ・思考（thinking）は、effort が low / medium / 未指定のときは切る（最初の文字まで約2秒短くなる）
   ・Claude Code の起動に時間がかかるので、よく使う設定（モデル・effort・検索の有無）の分は、起動済みで入力待ちの
     プロセスを1つ用意しておき、リクエストが来たらそれを使う（使ったらすぐ次の1つを用意する） */
const fastMode = (effort, search) => !search && (!effort || effort === 'low' || effort === 'medium');
const buildArgs = ({ model, effort, search }) => ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
  ...(search ? ['--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch'] : ['--tools', '']),
  '--no-session-persistence', '--setting-sources', '', '--disable-slash-commands',
  '--system-prompt', search ? SYSTEM + SEARCH_ADD : SYSTEM, '--model', model, ...(effort ? ['--effort', effort] : [])];
const startChild = o => spawn(CLAUDE, buildArgs(o), { cwd: WORK, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: fastMode(o.effort, o.search) ? { ...process.env, MAX_THINKING_TOKENS: '0' } : process.env });
const MAX_WARM = 3, WARM_TTL = 8 * 60000, HOT_MS = 20 * 60000;
const warmPool = new Map(), hotKeys = new Map();
const warmKey = o => [o.model, o.effort || '', o.search ? 's' : 'n'].join('|');
function replenish(o) {
  const k = warmKey(o);
  if (warmPool.has(k) || warmPool.size >= MAX_WARM || Date.now() - (hotKeys.get(k) || 0) > HOT_MS) return;
  const child = startChild({ model: o.model, effort: o.effort, search: o.search });
  child.on('error', () => {}); child.stdin.on('error', () => {});
  const ent = { child, born: Date.now() }; warmPool.set(k, ent);
  const drop = () => { if (warmPool.get(k) === ent) warmPool.delete(k); };
  child.on('close', drop);
  setTimeout(() => { if (warmPool.get(k) === ent) { drop(); try { child.kill(); } catch (e) {} } }, WARM_TTL).unref();
}
function takeChild(o) {
  const k = warmKey(o); hotKeys.set(k, Date.now());
  const ent = warmPool.get(k); warmPool.delete(k);
  let child = null;
  if (ent && ent.child.exitCode === null && !ent.child.killed && Date.now() - ent.born < WARM_TTL) child = ent.child;
  else { if (ent) try { ent.child.kill(); } catch (e) {} child = startChild(o); }
  setTimeout(() => replenish(o), 400);
  return child;
}

function runClaude({ prompt, model, effort, images, search }, onDelta, onClose, onLimits, onStatus) {
  const withImages = images && images.length > 0;
  const child = takeChild({ model, effort, search });
  let buf = '', err = '', got = false, usedModel = null, truncated = false, resultErr = null, finished = false, uIn = 0, uOut = 0, resultText = '';
  const seenTools = new Set(); let msgCount = 0;
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
        if (e.type === 'message_start' && e.message) {
          usedModel = e.message.model || usedModel;
          if (msgCount++ > 0 && got) onDelta('\n\n');
          const u = e.message.usage || {}; uIn += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        }
        else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') { got = true; onDelta(e.delta.text); }
        else if (e.type === 'message_delta') {
          if (e.delta && e.delta.stop_reason === 'max_tokens') truncated = true;
          if (e.usage && e.usage.output_tokens != null) uOut += e.usage.output_tokens;
        }
      } else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
        for (const b of ev.message.content) if (b.type === 'tool_use' && b.id && !seenTools.has(b.id)) { seenTools.add(b.id); onStatus && onStatus(describeTool(b)); }
      } else if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
        lastLimits = { ...ev.rate_limit_info, seenAt: Date.now() };
        onLimits && onLimits(lastLimits);
      } else if (ev.type === 'result') {
        if (ev.is_error) resultErr = String(ev.result || ev.subtype || 'error');
        else { resultText = String(ev.result || ''); if (!got && ev.result) { got = true; onDelta(String(ev.result)); } }
      }
    }
  });
  child.stderr.on('data', d => { err += d.toString('utf8'); });
  child.on('error', e => done({ ok: false, error: 'spawn: ' + e.message, got }));
  child.on('close', code => {
    if (resultErr || (code !== 0 && !got)) done({ ok: false, error: resultErr || err.trim().slice(-400) || 'exit ' + code, got });
    else done({ ok: true, model: usedModel, truncated, got, result: resultText, usage: { i: uIn, o: uOut } });
  });
  child.stdin.on('error', () => {});
  const content = withImages ? images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.t, data: im.d } })) : [];
  content.push({ type: 'text', text: prompt });
  child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n', 'utf8');
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

/* ================= VOICEVOX の中継（スマホなど外からも、このPCのVOICEVOXの声で話せるように） =================
   VOICEVOX のエンジンを必要なら自動で起動し、/vv/speak で「文字 → 声（wav）」を返す。声の一覧は /vv/speakers */
const VV = 'http://127.0.0.1:' + (process.env.VOICEVOX_PORT || 50021);
const VV_EXE = process.env.VOICEVOX_ENGINE || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VOICEVOX', 'vv-engine', 'run.exe');
let vvStarting = null, vvChild = null;
const vvAlive = async () => { try { const r = await fetch(VV + '/version', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch (e) { return false; } };
function ensureVV() {
  if (vvStarting) return vvStarting;
  vvStarting = (async () => {
    if (await vvAlive()) return true;
    if (!fs.existsSync(VV_EXE)) return false;
    // 標準はCPU。GPU（DirectML）は、声ごとの最初の読み込みに40秒以上かかるので、VOICEVOX_GPU=1 のときだけ使う
    for (const gpu of process.env.VOICEVOX_GPU === '1' ? [true, false] : [false]) {
      console.log('[VOICEVOX] エンジンを起動します…' + (gpu ? '（GPU）' : '（CPU）'));
      const child = spawn(VV_EXE, ['--host', '127.0.0.1', '--port', new URL(VV).port, ...(gpu ? ['--use_gpu'] : [])], { stdio: 'ignore', windowsHide: true });
      vvChild = child; child.on('error', () => {}); child.on('close', () => { if (vvChild === child) vvChild = null; });
      for (let i = 0; i < 60; i++) { await sleep(1000); if (await vvAlive()) { console.log('[VOICEVOX] 使えます'); return true; } if (child.exitCode !== null) break; }
      try { child.kill(); } catch (e) {}
    }
    return false;
  })().finally(() => setTimeout(() => { vvStarting = null; }, 4000));
  return vvStarting;
}
process.on('exit', () => { try { vvChild && vvChild.kill(); } catch (e) {} });
// 声ごとの最初の合成は、モデルの読み込みで数十秒かかる。使うキャラの声を、起動後に先に1回ずつ読み込ませておく
let vvWarmed = false;
async function vvWarm() {
  if (vvWarmed) return; vvWarmed = true;
  try {
    const sp = await (await fetch(VV + '/speakers', { signal: AbortSignal.timeout(20000) })).json();
    const ids = [];
    const main = { '猫使アル': ['ノーマル', 'おちつき', 'うきうき'], '満別花丸': ['ボーイ'], '猫使ビィ': ['ノーマル', 'おちつき'], '離途': ['ノーマル', 'シリアス'] };
    for (const [name, styles] of Object.entries(main)) { const c = sp.find(x => x.name === name); if (c) for (const s of c.styles) if (styles.includes(s.name)) ids.push(s.id); }
    console.log('[VOICEVOX] 声を読み込んでいます（' + ids.length + '種類）…');
    const t0 = Date.now();
    for (const id of ids) { try { await vvSpeak('あ', id); } catch (e) {} }
    console.log('[VOICEVOX] 声の読み込みが終わりました（' + Math.round((Date.now() - t0) / 1000) + '秒）');
  } catch (e) { vvWarmed = false; }
}
async function vvSpeak(text, speaker) {
  const q = await fetch(`${VV}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { method: 'POST', signal: AbortSignal.timeout(30000) });
  if (!q.ok) throw new Error('audio_query ' + q.status);
  const s = await fetch(`${VV}/synthesis?speaker=${speaker}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(await q.json()), signal: AbortSignal.timeout(60000) });
  if (!s.ok) throw new Error('synthesis ' + s.status);
  return Buffer.from(await s.arrayBuffer());
}

/* ================= リサーチ：指定した時間ぶん、ウェブで調べ続けてから答える =================
   ブラウザは「ジョブ」を始めて、数秒おきに経過を見に来る（トンネルが長い通信を切っても、画面を閉じても続く）。
   調査は数分ずつの「回」に分けて、回ごとにノートを足していく。最短時間を過ぎたら、ノートをもとに最終回答を書く。 */
const jobs = new Map();
const MAX_ROUNDS = 80;
const NOTES_LIMIT = 36000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const todayJa = () => new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

const once = (opts, hooks = {}) => new Promise(resolve => {
  const go = o => {
    const child = runClaude(o, t => hooks.onDelta && hooks.onDelta(t), r => (!r.ok && !r.got && o.effort ? go({ ...o, effort: null }) : resolve(r)), lim => hooks.onLimits && hooks.onLimits(lim), s => hooks.onStatus && hooks.onStatus(s));
    hooks.onChild && hooks.onChild(child);
  };
  go(opts);
});

function convText(turns) {
  if (typeof turns === 'string') return turns;
  const list = Array.isArray(turns) ? turns : [];
  if (list.length <= 1) return String((list[0] && list[0].content) || '');
  return list.slice(1).map(t => (t.role === 'assistant' ? 'アシスタント' : 'ユーザー') + ':\n' + t.content).join('\n\n');
}

function focusFor(round, f) {
  if (round === 1) return 'テーマ全体の把握。用語の定義・背景・経緯・主な立場や選択肢・関係する人や組織・最新の動きを広く調べる。ノートの最後に「調べるべき論点リスト」を10〜20個つくる。';
  if (f < 0.6) return '論点リストのうち、まだノートにないものを選んで深掘りする。公式資料・一次情報・統計・専門家の見解・具体的な事例と数値を集める。';
  if (f < 0.85) return '反対意見・異論・限界・失敗例・リスクと、最新の動き（日付の確認）、数値の裏取り（複数の出典で照合）を調べる。';
  return '抜けている観点の補完、ノート内の矛盾の解消、回答にいちばん必要な不足情報の確認。もう十分な点は「十分」と書く。';
}

function roundPrompt(job, round, elapsed) {
  const notes = job.notes.length ? job.notes.map(n => n.text).join('\n\n') : 'まだありません';
  return `あなたは徹底的に調べる調査員です。ウェブ検索（WebSearch）とページ取得（WebFetch）を使って、次の【依頼】に答えるための材料を集めます。ユーザーへの回答はまだ書かず、調査ノートだけを書いてください。
今日の日付：${todayJa()}

【依頼（ユーザーとの会話）】
${convText(job.turns)}

【これまでの調査ノート】
${notes}

【今回（第${round}回・調査開始から${Math.floor(elapsed / 60000)}分／最短${Math.round(job.minMs / 60000)}分）の方針】
${focusFor(round, elapsed / job.minMs)}

ルール：
- 検索は日本語と英語の両方を使い、公式サイト・論文・統計・信頼できる報道などの一次情報を優先する。
- ノートの各項目に、事実・数値・日付と、出典のURLを必ず付ける。確認できなかったことは「未確認」と書く。
- すでにノートにあることは繰り返さず、新しく分かったことだけを書く。
- 出力は箇条書きのノート（800〜1500字ほど）。最後に「次に調べるべきこと」を3つ書く。`;
}

function finalPrompt(job) {
  const notes = job.notes.map(n => n.text).join('\n\n');
  return buildPrompt(job.turns) + `\n\n――――\n【調査ノート（ウェブ調査 ${job.round}回・${Math.round((Date.now() - job.t0) / 60000)}分）】\n${notes || '（調査ノートはありません）'}\n――――\n上の調査ノートをふまえて、依頼への回答を書いてください。事実には出典URLを付け、ノートで確認できなかったことは断定しないでください。情報が食い違うときは両論を示してください。調査の過程の説明は不要で、回答だけを書いてください。`;
}

function jobLog(job, text) {
  job.log.push({ t: Date.now() - job.t0, text });
  if (job.log.length > 800) job.log.splice(0, job.log.length - 800);
  job.logTotal++;
}

async function runJob(job) {
  const useModel = job.model;
  const hooks = (extra = {}) => ({ onChild: c => { job.child = c; }, onStatus: s => jobLog(job, s), onLimits: l => { job.limits = l; }, ...extra });
  let errors = 0;
  try {
    while (!job.cancelled && !job.finishEarly) {
      const elapsed = Date.now() - job.t0;
      if (elapsed >= job.minMs && job.round >= 1) break;
      if (job.round >= MAX_ROUNDS || elapsed > job.minMs + 90 * 60000) break;
      if (lastLimits && lastLimits.status === 'rejected') { jobLog(job, '使用制限に達したため、ここまでの調査で答えます'); break; }
      job.round++;
      jobLog(job, `—— 第${job.round}回の調査を始めます（${focusFor(job.round, elapsed / job.minMs).slice(0, 28)}…）`);
      const r = await once({ prompt: roundPrompt(job, job.round, elapsed), model: useModel, effort: 'medium', search: true }, hooks());
      if (job.cancelled) break;
      if (!r.ok) {
        errors++; jobLog(job, '調査でエラー：' + String(r.error || '').slice(0, 120));
        if (errors >= 3) break;
        await sleep(8000); continue;
      }
      job.usage.i += (r.usage && r.usage.i) || 0; job.usage.o += (r.usage && r.usage.o) || 0;
      const text = String(r.result || '').trim();
      if (text) { job.notes.push({ round: job.round, text: `■第${job.round}回\n${text}` }); jobLog(job, `第${job.round}回のノートを追加しました（${text.length}字）`); }
      const total = job.notes.reduce((a, n) => a + n.text.length, 0);
      if (total > NOTES_LIMIT) {
        jobLog(job, 'ノートが長くなったので整理しています');
        const c = await once({ prompt: `次の調査ノートを、重複をまとめて整理し直してください。事実・数値・日付・出典URLはすべて残し、12000字以内の箇条書きにします。整理後のノートだけを出力してください。\n\n${job.notes.map(n => n.text).join('\n\n')}`, model: 'haiku', effort: 'low', search: false }, { onChild: ch => { job.child = ch; } });
        const ct = String((c && c.result) || '').trim();
        if (c && c.ok && ct.length > 500) job.notes = [{ round: job.round, text: '■整理済みノート\n' + ct }];
      }
      await sleep(1500);
    }
    if (job.cancelled) { job.status = 'cancelled'; return; }
    job.status = 'synthesizing';
    jobLog(job, `調査を終えました（${job.round}回・${Math.round((Date.now() - job.t0) / 60000)}分）。回答を書いています`);
    const f = await once({ prompt: finalPrompt(job), model: useModel, effort: job.effort, search: false }, hooks({ onDelta: t => { job.finalText += t; } }));
    if (job.cancelled) { job.status = 'cancelled'; return; }
    if (!f.ok && !job.finalText) throw new Error(f.error || '回答を作れませんでした');
    job.usage.i += (f.usage && f.usage.i) || 0; job.usage.o += (f.usage && f.usage.o) || 0;
    job.model = f.model || useModel; job.truncated = !!f.truncated; job.status = 'done';
  } catch (e) {
    if (job.cancelled) job.status = 'cancelled'; else { job.status = 'error'; job.error = String((e && e.message) || e).slice(0, 300); }
  } finally { job.endedAt = Date.now(); job.child = null; saveJobsSoon(); }
}

function startResearch(body) {
  const minutes = Math.max(1, Math.min(600, Math.round(Number(body.minutes) || 30)));
  const id = crypto.randomBytes(9).toString('base64url');
  const job = {
    id, status: 'running', t0: Date.now(), minMs: minutes * 60000, round: 0, notes: [], log: [], logTotal: 0, finalText: '',
    turns: body.turns, model: aliasOf(body.model, body.tier), effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(body.effort) ? body.effort : null,
    usage: { i: 0, o: 0 }, limits: null, error: '', cancelled: false, finishEarly: false, child: null, endedAt: 0, truncated: false,
  };
  jobs.set(id, job); jobLog(job, `リサーチを始めます（最短${minutes}分）`);
  runJob(job);
  return job;
}
const activeJob = () => [...jobs.values()].find(j => j.status === 'running' || j.status === 'synthesizing');
setInterval(() => { for (const [id, j] of jobs) if (j.endedAt && Date.now() - j.endedAt > 24 * 3600 * 1000) jobs.delete(id); }, 600000).unref();

/* ================= 返信をあとで受け取れる「チャットのジョブ」 =================
   ブラウザや画面を閉じても、このPCの中継サーバーが返信を最後まで作り続ける。
   ブラウザは次に開いたときに、ジョブの番号で続きと結果を受け取る。終わった結果は24時間、ファイルにも残す（再起動しても受け取れる）。 */
const chatJobs = new Map();
const JOBS_FILE = path.join(HERE, 'jobs-store.json');
const JOB_KEEP_MS = 24 * 3600 * 1000;
function saveJobs() {
  try {
    const out = [];
    for (const j of chatJobs.values()) if (j.endedAt && Date.now() - j.endedAt < JOB_KEEP_MS && j.status !== 'cancelled') out.push({ kind: 'chat', id: j.id, status: j.status, text: j.text, model: j.model, usage: j.usage, truncated: j.truncated, error: j.error, t0: j.t0, endedAt: j.endedAt });
    for (const j of jobs.values()) if (j.endedAt && Date.now() - j.endedAt < JOB_KEEP_MS && j.status === 'done') out.push({ kind: 'research', id: j.id, status: j.status, finalText: j.finalText, model: j.model, usage: j.usage, truncated: j.truncated, minMs: j.minMs, round: j.round, t0: j.t0, endedAt: j.endedAt });
    fs.writeFileSync(JOBS_FILE, JSON.stringify(out.slice(-60)));
  } catch (e) {}
}
const saveJobsSoon = (() => { let t = 0; return () => { clearTimeout(t); t = setTimeout(saveJobs, 800); }; })();
(function loadJobs() {
  try {
    for (const o of JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'))) {
      if (!o || Date.now() - o.endedAt > JOB_KEEP_MS) continue;
      if (o.kind === 'chat') chatJobs.set(o.id, { ...o, statusLines: [], clients: new Set(), child: null, cancelled: false });
      else jobs.set(o.id, { id: o.id, status: o.status, t0: o.t0 || o.endedAt, minMs: o.minMs || 0, round: o.round || 0, notes: [], log: [], logTotal: 0, finalText: o.finalText || '', turns: null, model: o.model, effort: null, usage: o.usage || { i: 0, o: 0 }, limits: null, error: '', cancelled: false, finishEarly: false, child: null, endedAt: o.endedAt, truncated: !!o.truncated });
    }
  } catch (e) {}
})();

function startChatJob(res, body, prompt, images, alias, effort) {
  const id = crypto.randomBytes(9).toString('base64url');
  const job = { id, status: 'running', text: '', statusLines: [], usage: null, truncated: false, model: null, error: '', t0: Date.now(), endedAt: 0, clients: new Set(), child: null, cancelled: false };
  chatJobs.set(id, job);
  if (chatJobs.size > 80) { const old = [...chatJobs.values()].filter(j => j.endedAt).sort((a, b) => a.endedAt - b.endedAt)[0]; if (old) chatJobs.delete(old.id); }
  running++;
  const emit = o => {
    if (o.type === 'delta') job.text += o.text;
    else if (o.type === 'status') { job.statusLines.push(o.text); if (job.statusLines.length > 40) job.statusLines.shift(); }
    for (const r of job.clients) if (!r.writableEnded) { try { r.write(JSON.stringify(o) + '\n'); } catch (e) {} }
  };
  job.clients.add(res);
  res.on('close', () => job.clients.delete(res));
  const hb = setInterval(() => emit({ type: 'ping' }), 10000);
  emit({ type: 'job', id });
  const attempt = (eff, retry) => {
    job.child = runClaude({ prompt, model: alias, effort: eff, images, search: body.search === true }, t => emit({ type: 'delta', text: t }), r => {
      if (!r.ok && !r.got && retry && !job.cancelled) return attempt(null, false);
      if (job.cancelled) job.status = 'cancelled';
      else if (r.ok) { job.status = 'done'; job.model = r.model; job.truncated = !!r.truncated; job.usage = r.usage; emit({ type: 'done', model: r.model, truncated: r.truncated, usage: r.usage, limits: lastLimits }); }
      else { job.status = 'error'; job.error = String(r.error || '').slice(0, 300); emit({ type: 'error', message: job.error }); }
      job.endedAt = Date.now(); job.child = null; running--; clearInterval(hb);
      for (const c of job.clients) { try { c.end(); } catch (e) {} }
      job.clients.clear(); saveJobsSoon();
    }, lim => emit({ type: 'limits', info: lim }), s => emit({ type: 'status', text: s }));
  };
  attempt(effort, !!effort);
  return job;
}
setInterval(() => { for (const [id, j] of chatJobs) if (j.endedAt && Date.now() - j.endedAt > JOB_KEEP_MS) chatJobs.delete(id); }, 600000).unref();
process.on('exit', saveJobs);

const server = http.createServer(async (req, res) => {
  const allowed = cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403); return res.end(); }
  if (req.headers.origin && !allowed) return json(res, 403, { error: 'origin_not_allowed' });
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/ping') {
    const a = checkAuth(req);
    return json(res, 200, { ok: true, name: 'kotodama-relay', v: 6, features: ['search', 'research', 'voicevox', 'jobs'], auth: a === 'ok', why: a === 'ok' ? '' : a, limits: a === 'ok' ? lastLimits : null });
  }

  if (req.method === 'POST' && url === '/ask') {
    const a = checkAuth(req);
    if (a !== 'ok') return json(res, a === 'locked' ? 429 : 401, { error: 'auth_' + a });
    if (running >= MAX_PARALLEL) return json(res, 429, { error: 'busy' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: 'bad_request' }); }
    const prompt = buildPrompt(body.turns);
    const images = (Array.isArray(body.images) ? body.images : []).slice(0, 6)
      .filter(im => im && /^image\/(jpeg|png|webp|gif)$/.test(im.t) && typeof im.d === 'string' && /^[A-Za-z0-9+/=]+$/.test(im.d));
    if (!prompt.trim()) return json(res, 400, { error: 'empty' });
    const alias = aliasOf(body.model, body.tier);
    const effort = ['low', 'medium', 'high', 'xhigh', 'max'].includes(body.effort) ? body.effort : null;

    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' }); res.flushHeaders();
    if (body.job === true) { startChatJob(res, body, prompt, images, alias, effort); return; }
    const send = o => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    running++;
    let child = null, closed = false;
    const hb = setInterval(() => send({ type: 'ping' }), 10000);
    const finish = () => { if (!closed) { closed = true; running--; clearInterval(hb); } };
    res.on('close', () => { if (child && !closed) child.kill(); finish(); });

    const attempt = (eff, retry) => {
      child = runClaude({ prompt, model: alias, effort: eff, images, search: body.search === true }, t => send({ type: 'delta', text: t }), r => {
        if (!r.ok && !r.got && retry) return attempt(null, false);
        if (r.ok) send({ type: 'done', model: r.model, truncated: r.truncated, usage: r.usage, limits: lastLimits });
        else send({ type: 'error', message: r.error });
        finish(); res.end();
      }, lim => send({ type: 'limits', info: lim }), s => send({ type: 'status', text: s }));
    };
    attempt(effort, !!effort);
    return;
  }

  if (url.startsWith('/vv/')) {
    const a = checkAuth(req);
    if (a !== 'ok') return json(res, a === 'locked' ? 429 : 401, { error: 'auth_' + a });
    if (!(await ensureVV())) return json(res, 503, { error: 'voicevox_unavailable' });
    try {
      if (req.method === 'GET' && url === '/vv/speakers') {
        const r = await fetch(VV + '/speakers', { signal: AbortSignal.timeout(20000) });
        res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'max-age=300' }); return res.end(Buffer.from(await r.arrayBuffer()));
      }
      if (req.method === 'POST' && url === '/vv/speak') {
        const b = JSON.parse(await readBody(req, 200000));
        const text = String(b.text || '').slice(0, 600), speaker = Number.isInteger(+b.speaker) ? +b.speaker : 1;
        if (!text.trim() || speaker < 0 || speaker > 9999) return json(res, 400, { error: 'bad_request' });
        const wav = await vvSpeak(text, speaker);
        res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'cache-control': 'no-store, no-transform' }); return res.end(wav);
      }
    } catch (e) { return json(res, 502, { error: 'voicevox_error', message: String((e && e.message) || e).slice(0, 120) }); }
    return json(res, 404, { error: 'not_found' });
  }

  if (url === '/research' && req.method === 'POST') {
    const a = checkAuth(req);
    if (a !== 'ok') return json(res, a === 'locked' ? 429 : 401, { error: 'auth_' + a });
    if (activeJob()) return json(res, 429, { error: 'busy_research' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: 'bad_request' }); }
    if (!buildPrompt(body.turns).trim()) return json(res, 400, { error: 'empty' });
    const job = startResearch(body);
    return json(res, 200, { id: job.id });
  }
  const cm = url.match(/^\/job\/([A-Za-z0-9_-]+)(\/cancel)?$/);
  if (cm) {
    const a = checkAuth(req);
    if (a !== 'ok') return json(res, a === 'locked' ? 429 : 401, { error: 'auth_' + a });
    const job = chatJobs.get(cm[1]);
    if (!job) return json(res, 404, { error: 'no_job' });
    if (req.method === 'POST' && cm[2]) { job.cancelled = true; try { job.child && job.child.kill(); } catch (e) {} return json(res, 200, { ok: true }); }
    if (req.method === 'GET' && !cm[2]) {
      const from = Math.max(0, parseInt((req.url.split('from=')[1] || '0'), 10) || 0);
      return json(res, 200, { status: job.status, text: job.text.slice(from), total: job.text.length, statusLines: job.statusLines, model: job.model, truncated: job.truncated, usage: job.usage, error: job.error, limits: lastLimits, elapsed: (job.endedAt || Date.now()) - job.t0 });
    }
  }
  const rm = url.match(/^\/research\/([A-Za-z0-9_-]+)(\/cancel|\/finish)?$/);
  if (rm) {
    const a = checkAuth(req);
    if (a !== 'ok') return json(res, a === 'locked' ? 429 : 401, { error: 'auth_' + a });
    const job = jobs.get(rm[1]);
    if (!job) return json(res, 404, { error: 'no_job' });
    if (req.method === 'POST' && rm[2] === '/cancel') { job.cancelled = true; try { job.child && job.child.kill(); } catch (e) {} return json(res, 200, { ok: true }); }
    if (req.method === 'POST' && rm[2] === '/finish') { job.finishEarly = true; try { if (job.status === 'running' && job.child) job.child.kill(); } catch (e) {} return json(res, 200, { ok: true }); }
    if (req.method === 'GET' && !rm[2]) {
      const since = Math.max(0, parseInt((req.url.split('since=')[1] || '0'), 10) || 0);
      const startIdx = Math.max(0, job.log.length - (job.logTotal - since));
      return json(res, 200, {
        status: job.status, round: job.round, elapsed: Date.now() - job.t0, minMs: job.minMs, log: job.log.slice(startIdx), logTotal: job.logTotal,
        finalText: job.finalText, error: job.error, usage: job.usage, limits: job.limits || lastLimits, model: job.model, truncated: job.truncated,
      });
    }
  }

  json(res, 404, { error: 'not_found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('コトダマ中継サーバーを起動しました');
  console.log('  待ち受け : http://127.0.0.1:' + PORT);
  console.log('  許可する画面 : ' + ORIGINS.join(', ') + ' と localhost');
  console.log('  このウィンドウを開いている間だけ、コトダマからあなたのClaudeを使えます。閉じるか Ctrl+C で止まります。');
  if (process.argv.includes('--tunnel')) startTunnel();
  ensureVV().then(ok => { if (ok) vvWarm(); }).catch(() => {});
  for (const m of ['haiku', 'sonnet']) { const o = { model: m, effort: 'low', search: false }; hotKeys.set(warmKey(o), Date.now()); replenish(o); }
});
process.on('exit', () => { for (const w of warmPool.values()) try { w.child.kill(); } catch (e) {} });

// Cloudflare の一時トンネル（アカウント不要）。起動のたびにURLが変わる
function startTunnel() {
  if (!KEY) { console.log('\n[トンネル] 合言葉が未設定のため、外には公開しません。relay/passphrase.txt に合言葉を書いてください。'); return; }
  const bins = [process.env.CLOUDFLARED_BIN, path.join(HERE, 'cloudflared.exe'), 'cloudflared', 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe'].filter(Boolean);
  const tryBin = i => {
    if (i >= bins.length) { console.log('\n[トンネル] cloudflared が見つかりません。 winget install Cloudflare.cloudflared で入れてください。'); return; }
    const t = spawn(bins[i], ['tunnel', '--url', 'http://127.0.0.1:' + PORT, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let shown = false, started = false;
    const onData = d => {
      started = true;
      const m = d.toString('utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !shown) {
        shown = true;
        console.log('\n[トンネル] 外からつながる住所: ' + m[0]);
        console.log('[トンネル] スマホなどで、次のリンクを開くと自動で設定されます（合言葉は最初に1回だけ入力）:');
        console.log('  ' + PAGE + '#relay=' + encodeURIComponent(m[0]));
      }
    };
    t.stdout.on('data', onData); t.stderr.on('data', onData);
    t.on('error', () => { if (!started) tryBin(i + 1); });
    t.on('close', () => { if (started) console.log('\n[トンネル] 切れました。start-relay-tunnel.bat をもう一度起動してください。'); });
    process.on('exit', () => t.kill());
    process.on('SIGINT', () => process.exit(0));
  };
  tryBin(0);
}
