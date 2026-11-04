import { watch } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('.', import.meta.url));
const target = join(root, '.vitalk-dev');
const runner = { id: randomUUID(), state: 'running', heartbeatAt: Date.now() };
let buildId = '';
let builtAt = null;
let buildMs = null;
let pkg = null;
let error = null;
let timer;
let building = false;
let queued = false;
let snapshotWrite = Promise.resolve();
await mkdir(target, { recursive: true });

function snapshot() {
  runner.heartbeatAt = Date.now();
  const data = JSON.stringify({ format: 'vitalk-plugin-dev/v1', buildId, builtAt, buildMs, package: pkg, error, runner });
  snapshotWrite = snapshotWrite.catch(() => {}).then(async () => {
    const temp = join(target, 'snapshot-' + runner.id + '-' + randomUUID() + '.tmp');
    await writeFile(temp, data);
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await rename(temp, join(target, 'snapshot.json'));
        return;
      } catch (cause) {
        if (!['EPERM', 'EACCES'].includes(cause?.code) || attempt === 7) throw cause;
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  });
  return snapshotWrite;
}

async function build() {
  if (building) { queued = true; return; }
  building = true;
  const start = Date.now();
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, 'build.mjs')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let message = '';
      child.stdout.on('data', chunk => message += chunk);
      child.stderr.on('data', chunk => message += chunk);
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(message) : reject(Error(message.trim() || '构建退出码 ' + code)));
    });
    pkg = JSON.parse(await readFile(join(root, 'dist', 'vitalk-plugin-feishu.vitalk-plugin.json'), 'utf8'));
    buildId = randomUUID();
    builtAt = Date.now();
    buildMs = builtAt - start;
    error = null;
    process.stdout.write(output);
  } catch (cause) {
    error = String(cause instanceof Error ? cause.message : cause).slice(0, 4000);
    console.error(error);
  } finally {
    building = false;
    await snapshot();
    if (queued) { queued = false; void build(); }
  }
}

function schedule() { clearTimeout(timer); timer = setTimeout(() => void build(), 180); }
const sources = ['src', 'manifest.json', 'build.mjs', 'vite.config.ts'];
const watchers = sources.map(path => watch(join(root, path), { recursive: path === 'src' }, schedule));
const heartbeat = setInterval(() => void snapshot().catch(console.error), 1000);
async function stop() {
  clearInterval(heartbeat);
  clearTimeout(timer);
  watchers.forEach(w => w.close());
  runner.state = 'stopped';
  await snapshot();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
await build();
