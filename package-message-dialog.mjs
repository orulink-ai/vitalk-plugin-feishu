import { readFile, mkdir, writeFile, mkdtemp, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { build } from 'vite';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function packageMessageDialog(root, directory, manifest) {
  if (process.platform !== 'win32') throw Error('消息确认组件需要在 Windows 发布环境构建');
  await mkdir(directory, {recursive:true});
  const filename = `feishu-message-dialog-${manifest.version}-windows-x86_64.exe`;
  const path = join(directory, filename);
  const source = join(root, 'native/message-dialog/Program.cs');
  const sdkRoot=join(root,'native/message-dialog/vendor');
  const sdk=join(sdkRoot,'webview2');
  const sdkHash='ef128016dd1e51c59178c827ed5b8aa3322c57afa8675d930f8109505542ad74';
  const archive=join(sdkRoot,'webview2.zip');
  await mkdir(sdkRoot,{recursive:true});
  let archiveBytes;
  try{archiveBytes=await readFile(archive);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!archiveBytes){
    const response=await fetch('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.2903.40/microsoft.web.webview2.1.0.2903.40.nupkg');
    if(!response.ok)throw Error('WebView2 SDK 下载失败');
    archiveBytes=Buffer.from(await response.arrayBuffer());
    if(digest(archiveBytes)!==sdkHash)throw Error('WebView2 SDK 摘要不匹配');
    await writeFile(archive,archiveBytes);
  }
  if(digest(archiveBytes)!==sdkHash)throw Error('WebView2 SDK 摘要不匹配');
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  const extract=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(sdk)} -Force`],{windowsHide:true,encoding:'utf8'});
  if(extract.status!==0)throw Error('WebView2 SDK 解包失败: '+extract.stderr);
  await writeFile(join(directory,'LICENSE.webview2'),await readFile(join(sdk,'LICENSE.txt')));
  await writeFile(join(directory,'NOTICE.webview2'),await readFile(join(sdk,'NOTICE.txt')));
  const ui=await build({root,configFile:join(root,'vite.config.ts'),build:{write:false,minify:true,rollupOptions:{input:join(root,'src/floating-message-main.tsx')}}});
  const files=Array.isArray(ui)?ui.flatMap(x=>x.output):ui.output;
  const js=files.filter(x=>x.type==='chunk').map(x=>x.code).join('\n').replace(/<\/script/gi,'<\\/script');
  const css=files.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>x.source).join('\n');
  const html='<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: https:;"><style>'+css+'</style></head><body><div id="root"></div><script>'+js+'</script></body></html>';
  await writeFile(join(directory,'message-dialog.html'),html);
  const fingerprint = digest(Buffer.concat([await readFile(source),Buffer.from(html+sdkHash)]));
  let binary;
  try {
    const previous = JSON.parse(await readFile(path + '.build.json', 'utf8'));
    const existing = await readFile(path);
    if (previous.source === fingerprint && previous.sha256 === digest(existing)) binary = existing;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  if (!binary) {
    // Compile privately: a dev watcher and release build must never write the same PE file.
    const temporary = await mkdtemp(join(directory, '.message-dialog-build-'));
    try {
      const output = join(temporary, filename);
      const htmlPath=join(temporary,'dialog.html');
      await writeFile(htmlPath,html);
      const libraries=['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll'];
      const references=libraries.map(name=>'/reference:'+join(sdk,'lib/net462',name));
      const resources=libraries.map(name=>'/resource:'+join(sdk,'lib/net462',name)+','+name);
      const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
      const result = spawnSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/out:' + output,
        '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',...references,...resources,
        '/resource:'+join(sdk,'runtimes/win-x64/native/WebView2Loader.dll')+',WebView2Loader.dll','/resource:'+htmlPath+',dialog.html',source],
        {windowsHide:true, encoding:'utf8'});
      if (result.error) throw result.error;
      if (result.status !== 0) throw Error('消息确认组件构建失败: ' + result.stdout + result.stderr);
      binary = await readFile(output);
      await rename(output, path);
      await writeFile(path + '.build.json', JSON.stringify({source:fingerprint, sha256:digest(binary)}));
    } finally { await rm(temporary, {recursive:true, force:true}); }
  }
  const sha256 = digest(binary);
  // Compatibility alias redirects to vilab-orulink; installed hosts pin this original repository.
  const artifact = {url:`https://github.com/orulink-ai/vitalk-plugin-feishu/releases/download/v${manifest.version}/${filename}`, sha256, executable:'feishu-message-dialog.exe'};
  manifest.nativeDependencies.push({id:'feishu-message-dialog', repository:'orulink-ai/vitalk-plugin-feishu', version:manifest.version, platforms:{'windows-x86_64':artifact}});
  await writeFile(path + '.sha256', sha256 + '\n');
}
