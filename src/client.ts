import {readDraftCandidates} from './draft-candidates';
import {CliNotAuthenticatedError} from './cli-auth';
import {createWorkspaceMessageService} from './workspace-message-service';
import {createWorkspaceStateService} from './workspace-state-service';
import {createFeishuRuntime} from './feishu-runtime';
import {syncContacts,searchContacts,readMessageRecipient} from './contact-service';
import type {MessageRecipient} from './message-intent';
import QRCode from 'qrcode';
import {createCliAuthService} from './cli-auth-service';
import {AUTH_SCOPES} from './auth-snapshot';
import {createPluginClient,createWindowTransport} from '@vitalk/plugin-sdk';
let client: ReturnType<typeof createPluginClient> | undefined;
export function getClient(){
  if(!client){
    const token=(window as Window & {__VITALK_PLUGIN_TOKEN__?:string}).__VITALK_PLUGIN_TOKEN__;
    if(!token) throw Error('请从 ViTalk 插件商店打开飞书。');
    client=createPluginClient(createWindowTransport(token));
  }
  return client;
}
let workspaceState:ReturnType<typeof createWorkspaceStateService>|undefined;
let messageService:ReturnType<typeof createWorkspaceMessageService>|undefined;
export function getWorkspaceState(){return workspaceState??=createWorkspaceStateService(getClient().request,createFeishuRuntime((m,p,o)=>getClient().request(m,p,o)).readAccount);}
async function messageContacts(signal?:AbortSignal,query?:string):Promise<MessageRecipient[]>{
 signal?.throwIfAborted();const state=await getWorkspaceState().read();signal?.throwIfAborted();
 const runtime=createFeishuRuntime((m,p,o)=>{signal?.throwIfAborted();return getClient().request(m,p,{...o,signal});});
 const account=await runtime.readAccount();if(account.accountId!==state.accountId)throw Error('飞书账号已变化，请重新读取联系人');
 const cached=state.catalog.recipients.filter(r=>r.kind==='person').map(r=>({id:r.id,name:r.name,aliases:state.entries.filter(e=>e.recipientId===r.id).map(e=>e.query),active:false,external:true}));
 const read=(args:string[])=>runtime.cli(args,`contacts-${crypto.randomUUID()}`);
 const catalog=query?await searchContacts(read,query,'message-search',{cached}):await syncContacts(read,'message-sync',{cached});
 if((await runtime.readAccount()).accountId!==account.accountId)throw Error('飞书账号已变化，请重新读取联系人');
 const result:MessageRecipient[]=[...catalog.people.map(p=>({...p,kind:'person' as const})),...catalog.chats.map(c=>({id:c.id,name:c.name,aliases:state.entries.filter(e=>e.recipientId===c.id).map(e=>e.query),kind:'group' as const,active:c.active,external:c.external}))];
 // Fresh authentication establishes the current sender's own messaging identity.
 // This exception is local to message recipients, never the employee roster.
 const self=result.find(r=>r.kind==='person'&&r.id===account.accountId);
 if(self){self.active=true;self.external=false;}
 signal?.throwIfAborted();
 // Search candidates must remain available when a draft revalidates its selected
 // recipient. Keep groups from the previous catalog; people are freshly qualified.
 const recipients=query?[...state.catalog.recipients.filter(r=>r.kind==='group'),...result]:result;
 await getWorkspaceState().saveCatalog({recipients,partial:true,lastSync:query?state.catalog.lastSync:Date.now()},account.accountId);
 return result;
}
async function selectedMessageContact(id:string,signal?:AbortSignal):Promise<MessageRecipient|undefined>{
 signal?.throwIfAborted();const state=await getWorkspaceState().read();
 const runtime=createFeishuRuntime((m,p,o)=>{signal?.throwIfAborted();return getClient().request(m,p,{...o,signal});});
 const account=await runtime.readAccount();if(account.accountId!==state.accountId)throw Error('飞书账号已变化，请重新读取联系人');
 const cached=state.catalog.recipients.find(r=>r.id===id);if(!cached||cached.kind==='bot')return undefined;
 const selected:MessageRecipient={id:cached.id,name:cached.name,kind:cached.kind,aliases:state.entries.filter(e=>e.recipientId===id).map(e=>e.query),active:false,external:true};
 const result=selected.kind==='person'&&selected.id===account.accountId?{...selected,active:true,external:false}:await readMessageRecipient(runtime.cli,selected,`contact-${crypto.randomUUID()}`);
 if((await runtime.readAccount()).accountId!==account.accountId)throw Error('飞书账号已变化，请重新读取联系人');
 signal?.throwIfAborted();return result;
}
export function getMessageService(){return messageService??=createWorkspaceMessageService(getClient().request,{readRecipient:selectedMessageContact,readDraftRecipients:signal=>readDraftCandidates(()=>getWorkspaceState().read(),messageContacts,signal),readRecipients:signal=>messageContacts(signal),readPreference:async signal=>{signal?.throwIfAborted();const state=await getWorkspaceState().read();signal?.throwIfAborted();return state.config.feishuMessageStyle??'';}});}
async function workspaceSnapshot(){try{await createFeishuRuntime((m,p,o)=>getClient().request(m,p,o)).readAccount();}catch(error){if(!(error instanceof CliNotAuthenticatedError))throw error;return {config:{feishuTools:true,feishuRecipientModel:'llm',feishuMessageStyle:'',pluginShortcuts:[]},feishuCatalog:{recipients:[],partial:true,lastSync:null},feishuDraft:null,aiReplies:[]};}const state=await getWorkspaceState().read();return {config:state.config,feishuCatalog:state.catalog,feishuDraft:await getMessageService().read(),aiReplies:await getWorkspaceState().readHistory()};}
let authService:ReturnType<typeof createCliAuthService>|undefined;
function auth(){return authService??=createCliAuthService((method,params,options)=>getClient().request(method,params,options),AUTH_SCOPES,url=>QRCode.toDataURL(url,{width:240,margin:2}));}
let authorizationGeneration=0;
export async function registerFeishuApplication(onUrl:(flow:{verificationUrl:string;qrDataUrl:string;flowId:string;stage:'registration'})=>void){
 const generation=++authorizationGeneration;
 const service=auth();
 let rendering=Promise.resolve();
 let renderError:Error|undefined;
 let rejectRendering!:(error:Error)=>void;
 const renderFailure=new Promise<never>((_,reject)=>{rejectRendering=reject;});
 const registration=service.register(url=>{
  rendering=QRCode.toDataURL(url,{width:240,margin:2}).then(qrDataUrl=>{
   if(generation!==authorizationGeneration)throw Error('飞书授权已取消');
   onUrl({verificationUrl:url,qrDataUrl,flowId:'registration',stage:'registration'});
  }).catch(()=>{service.cancel();renderError=Error('飞书授权二维码未能显示，请重试');rejectRendering(renderError);});
 });
 await Promise.race([registration,renderFailure]);
 await rendering;
 if(renderError)throw renderError;
 if(generation!==authorizationGeneration)throw Error('飞书授权已取消');
 return service.startLogin();
}
export function cancelFeishuAuthorization(){authorizationGeneration++;authService?.cancel();}
export async function feishu<T>(action:string,params:Record<string,unknown>={}):Promise<T>{
  // Native install can take 180s; device authorization can wait 600s,
  // followed by a 30s status read. Keep the SDK waiter alive for the receipt.
  const timeoutMs = action === 'feishuPluginCliInstall' ? 210_000
    : action === 'feishuAuthComplete' ? 660_000 : 60_000;
  try {
    if(action==='feishuWorkspaceRead')return await workspaceSnapshot() as T;
    if(action==='feishuWorkspaceSaveConfig'){await getWorkspaceState().saveConfig(params);return await workspaceSnapshot() as T;}
    if(action==='feishuRecipientMemory')return await getWorkspaceState().memory(params) as T;
    if(action==='feishuPrepare')return await getMessageService().prepare(params) as T;
    if(action==='feishuSend')return await getMessageService().send(params) as T;
    if(action==='feishuDismiss')return await getMessageService().dismiss(params) as T;
    if(action==='feishuRecall')return await getMessageService().recall(params) as T;
    if(action==='feishuSearch'||action==='feishuSync'){const recipients=await messageContacts(undefined,action==='feishuSearch'?String(params.query??''):undefined);return {recipients,partial:true,lastSync:action==='feishuSync'?Date.now():null,searchQuery:params.query} as T;}
    if(action==='feishuAuthStatus')return await auth().snapshot() as T;
    if(action==='feishuAuthStart')return await auth().startLogin() as T;
    if(action==='feishuAuthComplete'){await auth().complete(String(params.flowId??''));return await auth().snapshot() as T;}
    if(action==='feishuAuthCancel'){cancelFeishuAuthorization();return {ok:true} as T;}
    if (action === 'feishuPluginCliStatus' || action === 'feishuPluginCliInstall') {
      const method = action === 'feishuPluginCliStatus' ? 'native.status' : 'native.install';
      return await getClient().request(method, { dependencyId: 'lark-cli' }, { timeoutMs }) as T;
    }
    throw Error('当前飞书插件不支持此操作，请更新插件后重试。');
  } catch (error) {
    if (['feishuPluginCliStatus', 'feishuPluginCliInstall'].includes(action)
      && error instanceof Error && 'code' in error && error.code === 'unsupported_method') {
      throw Error('请更新 ViTalk 桌面端后再安装飞书插件运行环境。');
    }
    throw error;
  }
}
export async function openFeishuUrl(url:string):Promise<void>{
  await getClient().request('host.openExternal',{url});
}
export function dispose(){workspaceState=undefined;messageService=undefined;cancelFeishuAuthorization();authService=undefined;client?.dispose();client=undefined;}
