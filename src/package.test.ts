import {readNativeDependencies} from '@vitalk/plugin-sdk';
import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
describe('独立飞书安装包',()=>{
  it('声明独立 ID 与迁移中的显式能力，且不含 Tauri 直连调用',async()=>{
    const bytes=await readFile(root+'dist/vitalk-plugin-feishu.vitalk-plugin.json');
    const pkg=JSON.parse(bytes.toString());
    expect(pkg.format).toBe('vitalk-plugin/v1');
    const source = JSON.parse(await readFile(root + 'manifest.json', 'utf8'));
    expect(pkg.manifest).toEqual(source);
    expect(pkg.manifest.id).toBe('vitalk-plugin-feishu');
    expect(pkg.manifest.version).toBe('0.1.8');
    // The message grant is retained only for migration of legacy workspace data.
    expect(pkg.manifest.permissions).toEqual(['external.open','feishu.messages','native.execute','ai.generate','storage','voice.commands','files.stage']);
    expect(pkg.html).toContain('native.execute');
    expect(pkg.html).toContain('host.openExternal');
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
        'https://github.com/orulink-ai/vitalk-plugin-feishu/releases/download/v0.1.8/lark-cli-1.0.98-' + platform + suffix,
      );
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

it('发布包只声明业务 CLI，确认与历史调用宿主现有浮窗',async()=>{
 const pkg=JSON.parse(await readFile(root+'dist/vitalk-plugin-feishu.vitalk-plugin.json','utf8'));
 expect(pkg.manifest.nativeDependencies.map((d:{id:string})=>d.id)).toEqual(['lark-cli']);
 expect(pkg.html).toContain('notice.present');
 expect(pkg.html).not.toContain('feishu-message-dialog');
 expect(pkg.html).not.toContain('--store');
 expect(await readFile(root+'build.mjs','utf8')).not.toContain('packageMessageDialog');
});

it('生成包通过现有桌面 SDK 的实际原生依赖校验', async () => {
 const pkg=JSON.parse(await readFile(root+'dist/vitalk-plugin-feishu.vitalk-plugin.json','utf8'));
 expect(()=>readNativeDependencies(pkg.manifest.id,pkg.manifest.version,pkg.manifest.nativeDependencies)).not.toThrow();
});
