import {expect,it,vi} from 'vitest';
import {registerApplication} from './cli-registration';
import type {NativeRequest} from './native-cli';
const url='https://open.feishu.cn/page/cli?token=test';
const progress={sequence:1,stream:'stderr' as const,bytes:[...new TextEncoder().encode(url+'\n')]};
it('shows registration URL immediately but only completes after process success',async()=>{
 let complete!:(value:unknown)=>void;let options!:Parameters<NativeRequest>[2];
 const request=vi.fn<NativeRequest>((_m,_p,o)=>{options=o;return new Promise(r=>{complete=r;});});
 const show=vi.fn();let settled=false;
 const result=registerApplication(request,'register-1',{onRegistrationUrl:show}).then(r=>{settled=true;return r;});
 options.onProgress!(progress);await Promise.resolve();expect(show).toHaveBeenCalledWith(url);expect(settled).toBe(false);
 complete({exitCode:0});await expect(result).resolves.toEqual({status:'registered'});
 expect(request.mock.calls[0][1]).toEqual({dependencyId:'lark-cli',operationId:'register-1',args:['config','init','--new','--name','ViTalk']});
});
it('aborts and rejects parser errors even when native execution remains pending',async()=>{
 let options!:Parameters<NativeRequest>[2];const request:NativeRequest=(_m,_p,o)=>{options=o;return new Promise(()=>{});};
 const result=registerApplication(request,'register-2',{onRegistrationUrl:vi.fn()});
 options.onProgress!({...progress,sequence:2});await expect(result).rejects.toThrow('授权链接处理失败');expect(options.signal!.aborted).toBe(true);
});
it('aborts when the URL consumer throws and ignores late progress',async()=>{
 let options!:Parameters<NativeRequest>[2];const request:NativeRequest=(_m,_p,o)=>{options=o;return new Promise(()=>{});};
 const show=vi.fn(()=>{throw Error('secret');});const result=registerApplication(request,'register-3',{onRegistrationUrl:show});
 options.onProgress!(progress);await expect(result).rejects.toThrow('授权链接处理失败');
 options.onProgress!({...progress,sequence:2});expect(show).toHaveBeenCalledTimes(1);expect(options.signal!.aborted).toBe(true);
});
it('cancels in flight without requiring native resolution',async()=>{
 const controller=new AbortController();const request=vi.fn<NativeRequest>(()=>new Promise(()=>{}));
 const result=registerApplication(request,'register-4',{signal:controller.signal,onRegistrationUrl:vi.fn()});controller.abort();
 await expect(result).rejects.toThrow('取消');expect(request.mock.calls[0][2].signal!.aborted).toBe(true);
});
it('does not start an already cancelled registration',async()=>{
 const controller=new AbortController();controller.abort();const request=vi.fn();
 await expect(registerApplication(request,'register-5',{signal:controller.signal,onRegistrationUrl:vi.fn()})).rejects.toThrow('取消');expect(request).not.toHaveBeenCalled();
});
it.each([{exitCode:1},{exitCode:0},null])('does not report registered without both URL and successful exit',async response=>{
 await expect(registerApplication(vi.fn().mockResolvedValue(response),'register-6',{onRegistrationUrl:vi.fn()})).rejects.toThrow('未确认');
});
