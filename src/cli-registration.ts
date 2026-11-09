import {createRegistrationProgressParser} from './cli-auth-progress';
import type {NativeRequest} from './native-cli';

/** Await this completion before starting user login. The registration QR/link
 * alone never proves application registration or user authorization succeeded. */
export async function registerApplication(request:NativeRequest,operationId:string,options:{signal?:AbortSignal;onRegistrationUrl:(url:string)=>void}):Promise<{status:'registered'}>{
 if(!/^[A-Za-z0-9_-]{1,120}$/.test(operationId))throw Error('飞书注册操作编号无效');
 if(options.signal?.aborted)throw Error('飞书应用连接已取消');
 const controller=new AbortController();
 const parser=createRegistrationProgressParser();
 let ended=false,seenUrl=false;
 let rejectFailure!:(reason:Error)=>void;
 const failure=new Promise<never>((_resolve,reject)=>{rejectFailure=reject;});
 const stop=(message:string)=>{
  if(ended)return;
  ended=true;parser.dispose();controller.abort();rejectFailure(Error(message));
 };
 const cancel=()=>stop('飞书应用连接已取消');
 const deliver=(urls:string[])=>{
  for(const url of urls){
   if(ended)return;
   options.onRegistrationUrl(url);seenUrl=true;
  }
 };
 options.signal?.addEventListener('abort',cancel,{once:true});
 try{
  const execution=request('native.execute',{dependencyId:'lark-cli',args:['config','init','--new','--name','ViTalk'],operationId},{
   timeoutMs:660_000,signal:controller.signal,
   onProgress(progress){
    if(ended)return;
    try{deliver(parser.push(progress));}catch{stop('飞书授权链接处理失败，请重新连接');}
   },
  });
  const receipt=await Promise.race([failure,execution]);
  if(ended)throw Error('飞书应用连接未确认完成');
  try{deliver(parser.finish());}catch{stop('飞书授权链接处理失败，请重新连接');throw Error('飞书授权链接处理失败，请重新连接');}
  if(!seenUrl||!receipt||typeof receipt!=='object'||(receipt as {exitCode?:unknown}).exitCode!==0)throw Error('飞书应用注册未确认完成，请重新检查连接');
  return {status:'registered'};
 }catch(error){
  controller.abort();
  if(error instanceof Error&&['飞书应用连接已取消','飞书授权链接处理失败，请重新连接','飞书应用连接未确认完成'].includes(error.message))throw error;
  throw Error('飞书应用注册未确认完成，请重新检查连接');
 }finally{
  ended=true;parser.dispose();options.signal?.removeEventListener('abort',cancel);
 }
}
