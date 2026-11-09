// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { dispose, feishu, openFeishuUrl } from './client';
import manifest from '../manifest.json';

afterEach(() => { dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('declares the generic external link permission',()=>expect(manifest.permissions).toContain('external.open'));
it('propagates rejected external links without a legacy fallback',async()=>{
  (window as Window & { __VITALK_PLUGIN_TOKEN__?: string }).__VITALK_PLUGIN_TOKEN__ = 'test-token';
  const send=vi.spyOn(window.parent,'postMessage').mockImplementation(()=>{});
  const result=openFeishuUrl('javascript:alert(1)');const request=send.mock.calls[0][0];
  window.dispatchEvent(new MessageEvent('message',{source:window.parent,data:{channel:'vitalk-plugin/v1',token:'test-token',id:request.id,error:{code:'invalid_params',message:'链接无效'}}}));
  await expect(result).rejects.toThrow('链接无效');expect(send).toHaveBeenCalledTimes(1);expect(request.method).toBe('host.openExternal');
});

it.each(['https://applink.feishu.cn/client/todo/detail?guid=task-1','https://applink.feishu.cn/client/calendar/event/detail?event_id=event-1','https://open.feishu.cn/page/cli?from=cli'])('opens official links via the generic host API: %s',async url=>{
  (window as Window & { __VITALK_PLUGIN_TOKEN__?: string }).__VITALK_PLUGIN_TOKEN__ = 'test-token';
  const send=vi.spyOn(window.parent,'postMessage').mockImplementation(()=>{});
  const result=openFeishuUrl(url);const request=send.mock.calls[0][0];
  window.dispatchEvent(new MessageEvent('message',{source:window.parent,data:{channel:'vitalk-plugin/v1',token:'test-token',id:request.id,result:{ok:true}}}));
  await result;expect(request.method).toBe('host.openExternal');expect(request.params).toEqual({url});
});

it.each(['feishuPluginCliInstall'])('keeps %s pending past the default SDK timeout', async (action) => {
  vi.useFakeTimers();
  (window as Window & { __VITALK_PLUGIN_TOKEN__?: string }).__VITALK_PLUGIN_TOKEN__ = 'test-token';
  const send = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  let settled = false;
  const result = feishu(action).then(() => { settled = true; }, () => { settled = true; });
  await vi.advanceTimersByTimeAsync(61_000);
  expect(settled).toBe(false);
  const request = send.mock.calls[0][0];
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: {
    channel: 'vitalk-plugin/v1', token: 'test-token', id: request.id, result: { ok: true },
  } }));
  await result;
  expect(settled).toBe(true);
});

it.each(['feishuPluginCliStatus', 'feishuPluginCliInstall'])('asks to update an old host for %s without falling back to global installation', async (action) => {
  (window as Window & { __VITALK_PLUGIN_TOKEN__?: string }).__VITALK_PLUGIN_TOKEN__ = 'test-token';
  const send = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  const result = feishu(action);
  const request = send.mock.calls[0][0];
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: {
    channel: 'vitalk-plugin/v1', token: 'test-token', id: request.id,
    error: { code: 'unsupported_method', message: '当前 SDK 不支持此飞书操作' },
  } }));
  await expect(result).rejects.toThrow('请更新 ViTalk 桌面端');
  expect(send).toHaveBeenCalledTimes(1);
  expect(request.method).toBe(action === 'feishuPluginCliStatus' ? 'native.status' : 'native.install');
  expect(request.params).toEqual({ dependencyId: 'lark-cli' });
});

it.each([
  ['feishuPluginCliStatus', 'native.status'],
  ['feishuPluginCliInstall', 'native.install'],
])('routes %s only through its declared plugin dependency', async (action, method) => {
  (window as Window & { __VITALK_PLUGIN_TOKEN__?: string }).__VITALK_PLUGIN_TOKEN__ = 'test-token';
  const send = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  const result = feishu(action, { dependencyId: 'other-cli' });
  const request = send.mock.calls[0][0];
  const status = { installed: true, managed: true, version: '1.0.98' };
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: {
    channel: 'vitalk-plugin/v1', token: 'test-token', id: request.id, result: status,
  } }));
  await expect(result).resolves.toEqual(status);
  expect(request.method).toBe(method);
  expect(request.params).toEqual({ dependencyId: 'lark-cli' });
  expect(send).toHaveBeenCalledTimes(1);
});
import {AUTH_SCOPES} from './auth-snapshot';
it('routes authorization state through plugin native execution',async()=>{
 (window as Window & {__VITALK_PLUGIN_TOKEN__?:string}).__VITALK_PLUGIN_TOKEN__='test-token';
 const send=vi.spyOn(window.parent,'postMessage').mockImplementation(()=>{});
 const result=feishu<{allPermissionsGranted:boolean}>('feishuAuthStatus');const request=send.mock.calls[0][0];
 expect(request.method).toBe('native.execute');
 window.dispatchEvent(new MessageEvent('message',{source:window.parent,data:{channel:'vitalk-plugin/v1',token:'test-token',id:request.id,result:{exitCode:0,stdout:JSON.stringify({identities:{user:{openId:'ou_me',status:'ready',tokenStatus:'valid',scope:AUTH_SCOPES.join(' ')}}})}}}));
 expect((await result).allPermissionsGranted).toBe(true);
});
vi.mock('qrcode',()=>({default:{toDataURL:vi.fn(async()=> 'data:image/png;base64,test')}}));
it('starts user authorization using native CLI and keeps device secret out of the UI',async()=>{
 (window as Window & {__VITALK_PLUGIN_TOKEN__?:string}).__VITALK_PLUGIN_TOKEN__='test-token';
 const send=vi.spyOn(window.parent,'postMessage').mockImplementation(()=>{});
 const result=feishu<Record<string,unknown>>('feishuAuthStart');const request=send.mock.calls[0][0];
 expect(request.method).toBe('native.execute');expect(request.params.args).toEqual(['auth','login','--scope',AUTH_SCOPES.join(' '),'--no-wait','--json']);
 window.dispatchEvent(new MessageEvent('message',{source:window.parent,data:{channel:'vitalk-plugin/v1',token:'test-token',id:request.id,result:{exitCode:0,stdout:JSON.stringify({verification_url:'https://accounts.feishu.cn/auth',device_code:'secret',expires_in:600})}}}));
 const flow=await result;expect(flow.qrDataUrl).toBe('data:image/png;base64,test');expect(JSON.stringify(flow)).not.toContain('secret');expect(send).toHaveBeenCalledTimes(1);
});
it('refuses stale authorization completion locally rather than legacy fallback',async()=>{
 const send=vi.spyOn(window.parent,'postMessage').mockImplementation(()=>{});
 await expect(feishu('feishuAuthComplete',{flowId:'stale'})).rejects.toThrow('不存在');expect(send).not.toHaveBeenCalled();
});
it('opens an unconnected workspace without exposing another accounts stored data',async()=>{
 (window as Window & {__VITALK_PLUGIN_TOKEN__?:string}).__VITALK_PLUGIN_TOKEN__='test-token';
 const send=vi.spyOn(window.parent,'postMessage').mockImplementation(()=>{});
 const result=feishu<any>('feishuWorkspaceRead');const request=send.mock.calls[0][0];
 window.dispatchEvent(new MessageEvent('message',{source:window.parent,data:{channel:'vitalk-plugin/v1',token:'test-token',id:request.id,result:{exitCode:0,stdout:JSON.stringify({identities:{user:{status:'not_logged_in'}}})}}}));
 await expect(result).resolves.toMatchObject({feishuDraft:null,feishuCatalog:{recipients:[]},aiReplies:[]});expect(send).toHaveBeenCalledTimes(1);
});
it.each([{exitCode:1,stdout:'network'}, {exitCode:0,stdout:JSON.stringify({ok:false,error:{code:'permission'}})}, {exitCode:0,stdout:JSON.stringify({identities:{user:{status:'needs_refresh',tokenStatus:'needs_refresh'}}})}])('does not disguise failed status as an unconnected empty workspace %j',async(output)=>{
 (window as Window & {__VITALK_PLUGIN_TOKEN__?:string}).__VITALK_PLUGIN_TOKEN__='test-token';
 const send=vi.spyOn(window.parent,'postMessage').mockImplementation(()=>{});
 const result=feishu('feishuWorkspaceRead');const assertion=expect(result).rejects.toThrow();const request=send.mock.calls[0][0];
 window.dispatchEvent(new MessageEvent('message',{source:window.parent,data:{channel:'vitalk-plugin/v1',token:'test-token',id:request.id,result:output}}));
 await assertion;expect(send).toHaveBeenCalledTimes(1);
});

it('rejects unmigrated business actions without invoking desktop Feishu business',async()=>{
 const send=vi.spyOn(window.parent,'postMessage').mockImplementation(()=>{});
 const promise=feishu('feishuCompare');
 void promise.catch(()=>{});
 expect(send).not.toHaveBeenCalled();
 await expect(promise).rejects.toThrow('不支持');
});
