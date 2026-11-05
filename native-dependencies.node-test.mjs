import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a corrupt cached upstream archive is rejected before publishing an executable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feishu-cli-package-'));
  const cache = join(directory, 'cache');
  const output = join(directory, 'output');
  try {
    await mkdir(cache);
    const lock = JSON.parse(await readFile(new URL('./native-dependencies.lock.json', import.meta.url), 'utf8'));
    const source = Object.values(lock.platforms)[0];
    await writeFile(join(cache, source.archive), 'tampered archive');
    const result = spawnSync(process.execPath, ['package-native.mjs', output, cache], {
      cwd: new URL('.', import.meta.url), windowsHide: true, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLI upstream checksum mismatch/);
    assert.deepEqual(await readdir(output), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
