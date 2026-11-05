import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
describe('独立飞书安装包',()=>{
  it('声明独立 ID 与最小飞书权限，且不含 Tauri 直连调用',async()=>{
    const bytes=await readFile(root+'dist/vitalk-plugin-feishu.vitalk-plugin.json');
    const pkg=JSON.parse(bytes.toString());
    expect(pkg.format).toBe('vitalk-plugin/v1');
    expect(pkg.manifest).toEqual(JSON.parse(await readFile(root + 'manifest.json', 'utf8')));
    expect(pkg.manifest.id).toBe('vitalk-plugin-feishu');
    expect(pkg.manifest.version).toBe('0.1.4');
    expect(pkg.manifest.permissions).toEqual(['feishu.messages','feishu.tasks','feishu.calendar']);
    expect(pkg.html).toContain('feishu.request');
    expect(pkg.html).not.toContain('__TAURI_INTERNALS__');
    expect(pkg.html).toContain('feishuPluginCliInstall');
    expect(pkg.html).not.toContain('feishuCliInstall');
    expect(bytes.length).toBeLessThan(2_000_000);
    expect((await readFile(root+'dist/vitalk-plugin-feishu.vitalk-plugin.json.sha256','utf8')).trim()).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});

describe('插件自有 CLI 资源', () => {
  it('为每个支持的平台声明固定版本、插件发布地址和内容摘要', async () => {
    const manifest = JSON.parse(await readFile(root + 'manifest.json', 'utf8'));
    const [dependency] = manifest.nativeDependencies;
    expect(dependency.id).toBe('lark-cli');
    expect(dependency.version).toBe('1.0.98');
    expect(Object.keys(dependency.platforms).sort()).toEqual([
      'darwin-aarch64', 'darwin-x86_64', 'linux-aarch64', 'linux-x86_64',
      'windows-aarch64', 'windows-x86_64',
    ]);
    for (const [platform, value] of Object.entries(dependency.platforms)) {
      const artifact = value as {url: string; sha256: string; executable: string};
      const suffix = platform.startsWith('windows-') ? '.exe' : '';
      expect(artifact.executable).toBe('lark-cli' + suffix);
      expect(artifact.url).toBe(
        'https://github.com/orulink-ai/vitalk-plugin-feishu/releases/download/v0.1.4/lark-cli-1.0.98-' + platform + suffix,
      );
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
