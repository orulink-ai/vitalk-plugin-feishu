import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(root, 'native-dependencies.lock.json'), 'utf8'));
const dependency = manifest.nativeDependencies.find(item => item.id === lock.dependency);
if (!dependency || dependency.version !== lock.version) throw Error('CLI dependency version differs from lock');
const directory = resolve(process.argv[2] || join(root, 'dist'));
const cache = resolve(process.argv[3] || join(directory, 'native-upstream'));
await mkdir(directory, { recursive: true });
await mkdir(cache, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const checksums = [];
// Read a single fixed member into stdout. Archives are never extracted to disk.
const readMember = [
  'import sys,zipfile,tarfile',
  'path,member=sys.argv[1:]',
  'if path.endswith(".zip"):',
  ' with zipfile.ZipFile(path) as archive: data=archive.read(member)',
  'else:',
  ' with tarfile.open(path) as archive: data=archive.extractfile(member).read()',
  'sys.stdout.buffer.write(data)',
].join('\n');

for (const [platform, artifact] of Object.entries(dependency.platforms)) {
  const source = lock.platforms[platform];
  const expectedSource = 'https://github.com/larksuite/cli/releases/download/v' + lock.version + '/';
  const expectedRelease = 'https://github.com/orulink-ai/vitalk-plugin-feishu/releases/download/v' + manifest.version + '/';
  const suffix = platform.startsWith('windows-') ? '.exe' : '';
  const filename = 'lark-cli-' + dependency.version + '-' + platform + suffix;
  if (!source || source.url !== expectedSource + source.archive ||
      !/^[a-zA-Z0-9.-]+$/.test(source.archive) ||
      artifact.url !== expectedRelease + filename ||
      artifact.executable !== 'lark-cli' + suffix || source.member !== artifact.executable) {
    throw Error('Invalid pinned CLI artifact: ' + platform);
  }
  const archivePath = join(cache, source.archive);
  let archive;
  try { archive = await readFile(archivePath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(source.url, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw Error('CLI download failed: HTTP ' + response.status);
    archive = Buffer.from(await response.arrayBuffer());
    if (sha256(archive) !== source.sha256) throw Error('CLI upstream checksum mismatch: ' + platform);
    await writeFile(archivePath + '.tmp', archive);
    await rename(archivePath + '.tmp', archivePath);
  }
  if (sha256(archive) !== source.sha256) throw Error('CLI upstream checksum mismatch: ' + platform);
  const extracted = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
    ['-c', readMember, archivePath, source.member],
    { windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  if (extracted.error) throw extracted.error;
  if (extracted.status !== 0) throw Error('CLI member read failed: ' + extracted.stderr.toString());
  const binary = extracted.stdout;
  if (binary.length !== source.size || sha256(binary) !== artifact.sha256) {
    throw Error('CLI executable checksum mismatch: ' + platform);
  }
  await writeFile(join(directory, filename + '.tmp'), binary, { mode: 0o755 });
  await rename(join(directory, filename + '.tmp'), join(directory, filename));
  checksums.push(artifact.sha256 + '  ' + filename);
}
await copyFile(join(root, 'LICENSE.lark-cli'), join(directory, 'LICENSE.lark-cli'));
await writeFile(join(directory, 'native-checksums.txt'), checksums.join('\n') + '\n');
console.log('Prepared ' + checksums.length + ' verified plugin-owned CLI release assets in ' + directory);
