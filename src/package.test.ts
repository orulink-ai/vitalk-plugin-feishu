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
    expect(pkg.manifest.id).toBe('vitalk-plugin-feishu');
    expect(pkg.manifest.version).toBe('0.1.2');
    expect(pkg.manifest.permissions).toEqual(['feishu.messages','feishu.tasks','feishu.calendar']);
    expect(pkg.html).toContain('feishu.request');
    expect(pkg.html).not.toContain('__TAURI_INTERNALS__');
    expect(bytes.length).toBeLessThan(2_000_000);
    expect((await readFile(root+'dist/vitalk-plugin-feishu.vitalk-plugin.json.sha256','utf8')).trim()).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});
