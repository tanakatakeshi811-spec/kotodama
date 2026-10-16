// コトダマの公開ギャラリーを、あなたのCloudflareアカウントに作る（1回だけ実行）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOML = path.join(HERE, 'wrangler.toml');
const run = (args, { quiet = false } = {}) => new Promise(res => {
  const c = spawn('npx', ['--yes', 'wrangler@4', ...args], { cwd: HERE, shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  let out = '';
  const on = d => { const t = d.toString('utf8'); out += t; if (!quiet) process.stdout.write(t); };
  c.stdout.on('data', on); c.stderr.on('data', on);
  c.on('close', code => res({ code, out }));
});
const say = t => console.log('\n=== ' + t + ' ===');
(async () => {
  say('Cloudflare にログインしているか確認します');
  let r = await run(['whoami']);
  if (/not authenticated|You are not authenticated|wrangler login/i.test(r.out)) {
    say('ブラウザが開くので、Cloudflare にログインして「Allow」を押してください');
    const c = spawn('npx', ['--yes', 'wrangler@4', 'login'], { cwd: HERE, shell: true, stdio: 'inherit' });
    await new Promise(res => c.on('close', res));
  }
  let id = '';
  try { const m = fs.readFileSync(TOML, 'utf8').match(/id\s*=\s*"([0-9a-f]{32})"/); if (m) id = m[1]; } catch (e) {}
  if (!id) {
    say('保管場所（KV）を作ります');
    r = await run(['kv', 'namespace', 'create', 'kotodama-gallery']);
    let m = r.out.match(/([0-9a-f]{32})/);
    if (!m) { r = await run(['kv', 'namespace', 'list'], { quiet: true }); const j = (() => { try { return JSON.parse(r.out.slice(r.out.indexOf('['))); } catch (e) { return []; } })(); const f = j.find(n => /kotodama-gallery/.test(n.title)); if (f) m = [0, f.id]; }
    if (!m) { console.log('\nKVを作れませんでした。上のメッセージを確認してください。'); process.exit(1); }
    id = m[1];
  }
  fs.writeFileSync(TOML, `name = "kotodama-gallery"\nmain = "worker.js"\ncompatibility_date = "2025-01-01"\nworkers_dev = true\n\n[[kv_namespaces]]\nbinding = "GALLERY"\nid = "${id}"\n`);
  say('ギャラリーを公開します');
  r = await run(['deploy']);
  const m = r.out.match(/https:\/\/kotodama-gallery\.[a-z0-9-]+\.workers\.dev/);
  if (!m) { console.log('\nURLが見つかりませんでした。上のメッセージを確認してください（workers.dev のサブドメインが未登録なら、Cloudflareのダッシュボード→Workers で一度登録してから、もう一度実行）。'); process.exit(1); }
  fs.writeFileSync(path.join(HERE, '..', 'gallery-url.txt'), m[0] + '\n');
  say('できました');
  console.log('公開ギャラリー: ' + m[0]);
  console.log('gallery-url.txt に保存しました。中継サーバーを起動し直すと、どの端末のコトダマからも自動でこのギャラリーを使います。');
})();
