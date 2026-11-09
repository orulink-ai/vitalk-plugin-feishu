import {readFreshCliStatus} from './cli-auth-refresh';
import {authSnapshot} from './auth-snapshot';
import type {NativeRequest} from './native-cli';
import {parseCliAuthStatus,verifyCliLogin} from './cli-auth';
import {registerApplication} from './cli-registration';
type Flow={id:string;code:string;expires:number};
export type PublicAuthFlow={stage:'authorization';flowId:string;verificationUrl:string;qrDataUrl:string};
/** All credentials remain in this service closure. Supply a plugin-owned QR
 * renderer; no desktop path or application credential migration is assumed. */
export function createCliAuthService(request:NativeRequest,requiredScopes:readonly string[],renderQr:(url:string)=>Promise<string>,now=Date.now){
 if(requiredScopes.some(scope=>!scope||!/^[-a-zA-Z0-9_:/.]+$/.test(scope)))throw Error('飞书权限列表无效');
 const scopes=[...new Set(requiredScopes)];
 let publicFlow:PublicAuthFlow|undefined;
 let flow:Flow|undefined,busy=false,controller=new AbortController();
 const run=(args:string[],timeoutMs=60_000)=>request('native.execute',{dependencyId:'lark-cli',args,operationId:`auth-${crypto.randomUUID()}`},{timeoutMs,signal:controller.signal});
 function cancel(){controller.abort();flow=undefined;publicFlow=undefined;}
 async function locked<T>(operation:()=>Promise<T>):Promise<T>{
  if(busy)throw Error('正在处理飞书授权，请稍候');
  busy=true;controller=new AbortController();
  try{return await operation();}finally{busy=false;}
 }
 return {
  cancel,
  async snapshot(){return locked(async()=>{
   if(flow&&now()>=flow.expires){flow=undefined;publicFlow=undefined;}
   return {...authSnapshot(await readFreshCliStatus(run)),pendingAuthorization:publicFlow};
  });},
  async status(){return locked(async()=>parseCliAuthStatus(await readFreshCliStatus(run),scopes));},
  /** Explicit new-app path only. Do not call for generic status/network errors. */
  async register(onRegistrationUrl:(url:string)=>void){return locked(async()=>{
   flow=undefined;publicFlow=undefined;return registerApplication(request,`register-${crypto.randomUUID()}`,{signal:controller.signal,onRegistrationUrl});
  });},
  async startLogin():Promise<PublicAuthFlow>{return locked(async()=>{
   flow=undefined;publicFlow=undefined;
   const response=await run(['auth','login','--scope',scopes.join(' '),'--no-wait','--json']);
   if(controller.signal.aborted)throw Error('飞书授权已取消');
   let body:Record<string,unknown>;
   try{
    const raw=response as {exitCode:unknown;stdout:string};
    if(raw.exitCode!==0||typeof raw.stdout!=='string'||raw.stdout.length>1_000_000)throw Error();
    const parsed=JSON.parse(raw.stdout);if(!parsed||parsed.ok===false)throw Error();
    body=parsed.data&&typeof parsed.data==='object'?parsed.data:parsed;
    if(body.ok===false)throw Error();
   }catch{throw Error('飞书未返回有效授权流程，请重新连接');}
   const value=body.verification_url??body.verification_uri_complete;
   let url:URL;
   try{
    if(typeof value!=='string'||/[\s\u0000-\u001f\u007f]/.test(value))throw Error();
    url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||
     !['feishu.cn','larksuite.com'].some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain)))throw Error();
   }catch{throw Error('飞书授权链接不是受信任的官方 HTTPS 地址');}
   if(typeof body.device_code!=='string'||!body.device_code||body.device_code.length>8192)throw Error('飞书未返回授权流程，请重新连接');
   const seconds=typeof body.expires_in==='number'&&Number.isFinite(body.expires_in)?Math.min(body.expires_in,600):600;
   if(seconds<=0)throw Error('飞书授权流程已过期');
   const expires=now()+seconds*1000;
   const qrDataUrl=await renderQr(url.href);
   if(controller.signal.aborted)throw Error('飞书授权已取消');
   if(now()>=expires)throw Error('飞书授权流程已过期');
   flow={id:crypto.randomUUID(),code:body.device_code,expires};
   publicFlow={stage:'authorization',flowId:flow.id,verificationUrl:url.href,qrDataUrl};
   return publicFlow;
  });},
  async complete(flowId:string){return locked(async()=>{
   const current=flow;
   if(!current||current.id!==flowId)throw Error('授权流程不存在，请重新连接');
   flow=undefined;publicFlow=undefined;
   const remaining=current.expires-now();if(remaining<=0)throw Error('授权流程已过期，请重新连接');
   const login=await run(['auth','login','--device-code',current.code,'--json'],Math.min(remaining+30_000,660_000));
   if(controller.signal.aborted)throw Error('飞书授权已取消');
   const fresh=await readFreshCliStatus(run);
   if(controller.signal.aborted)throw Error('飞书授权已取消');
   return verifyCliLogin(login,fresh,scopes);
  });},
 };
}

