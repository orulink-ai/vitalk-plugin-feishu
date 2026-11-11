import {uploadMessageAttachments,validateMessageAttachments} from './message-attachments';
import type {createPluginClient,JsonValue} from '@vitalk/plugin-sdk';
import {createFeishuRuntime} from './feishu-runtime';
import {createIntentModel} from './intent-model';
import {createMessageWorkflow,type MessageDraft} from './message-workflow';
import type {MessageRecipient} from './message-intent';
import type {FeishuMessageDraft} from './original-workspace/FeishuMessagePanel';
type Request=ReturnType<typeof createPluginClient>['request'];
type Params=Record<string,unknown>;
/** One instance per plugin session, shared by voice and workspace confirmation.
 * The caller supplies fresh contact evidence with the user's aliases/corrections.
 * Do not pass legacy host-owned drafts into this plugin-owned store. */
export function createWorkspaceMessageService(request:Request,options:{readRecipient?:(id:string,signal?:AbortSignal)=>Promise<MessageRecipient|undefined>;readDraftRecipients?:(signal?:AbortSignal)=>Promise<MessageRecipient[]>;readRecipients:(signal?:AbortSignal)=>Promise<MessageRecipient[]>;readPreference:(signal?:AbortSignal)=>Promise<string>}){
 const runtime=createFeishuRuntime((m,p,o)=>request(m,p,o));
 const save=async(key:string,value:unknown)=>{const result=await request('storage.set',{key,value:value as JsonValue});if(result.ok!==true)throw Error('消息草稿保存失败，未确认操作结果');};
 const load=async(id:string)=>{
  if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('消息草稿标识无效');
  return (await request('storage.get',{key:`message-draft.${id}`})).value as unknown as MessageDraft|undefined;
 };
 const workflow=createMessageWorkflow({contentArgs:async(d,check)=>{if(d.attachments?.length){const a=await runtime.readAccount();if(a.accountId!==d.accountId||!a.scopes.includes('im:resource'))throw Error('飞书缺少图片权限，请重新授权');}return uploadMessageAttachments(request,runtime.cli,d.id,d.content,d.attachments??[],check);},cli:runtime.cli,readAccount:runtime.readAccount,readRecipient:options.readRecipient,readRecipients:options.readRecipients,readDraftRecipients:options.readDraftRecipients,model:createIntentModel(p=>request('ai.generate',p,{timeoutMs:120000})),store:{read:load,write:d=>save(`message-draft.${d.id}`,d)}});
 const dto=(d:MessageDraft):FeishuMessageDraft=>({id:d.id,awaitingRecipient:d.awaitingRecipient,recipientQuery:d.recipientQuery,recipientCandidates:d.recipientCandidates,attachments:d.attachments,prompt:d.prompt,content:d.content,recipient:d.recipient,status:d.status==='cancelled'?'unknown':d.status,receipt:d.messageId,error:d.status==='unknown'?'发送结果待核实，请在飞书确认，勿重复发送。':undefined});
 function attachmentSelection(p:Params,d:MessageDraft){if(p.attachmentIds===undefined)return d.attachments??[];if(!Array.isArray(p.attachmentIds)||new Set(p.attachmentIds).size!==p.attachmentIds.length||p.attachmentIds.some(id=>!d.attachments?.some(a=>a.id===id)))throw Error('图片必须来自当前草稿');return (d.attachments??[]).filter(a=>(p.attachmentIds as unknown[]).includes(a.id));}
 return {
  async read(){const id=(await request('storage.get',{key:'message-latest-draft'})).value;if(typeof id!=='string')return null;const d=await load(id);if(!d||d.status==='cancelled')return null;const account=await runtime.readAccount();return d.accountId===account.accountId?dto(d):null;},
  async prepare(p:Params,execution:{signal?:AbortSignal}={}):Promise<FeishuMessageDraft>{if(execution.signal){const signal=execution.signal;signal.throwIfAborted();const scoped:Request=(m,p,o)=>{signal.throwIfAborted();return request(m,p,{...o,signal});};return createWorkspaceMessageService(scoped,{readRecipient:options.readRecipient?id=>options.readRecipient!(id,signal):undefined,readDraftRecipients:options.readDraftRecipients?()=>options.readDraftRecipients!(signal):undefined,readRecipients:()=>options.readRecipients(signal),readPreference:()=>options.readPreference(signal)}).prepare(p);}let attachments=validateMessageAttachments(p.attachments);if(p.sourceDraftId||p.recipientSourceDraftId){const source=await load(String(p.sourceDraftId??p.recipientSourceDraftId));const account=await runtime.readAccount();if(!source||source.accountId!==account.accountId||source.status!=='ready')throw Error('只有当前账号待确认草稿可以重新生成');if(p.attachments===undefined)attachments=attachmentSelection(p,source);if(p.recipientSourceDraftId){if(typeof p.recipientId!=='string')throw Error('请选择联系人');return dto(await workflow.edit(source.id,{recipientId:p.recipientId,content:source.content}));}}if(typeof p.prompt!=='string')throw Error('请输入消息内容');const d=await workflow.prepare(p.prompt,await options.readPreference(),attachments);await save('message-latest-draft',d.id);return dto(d);},
  async send(p:Params){if(typeof p.id!=='string'||typeof p.content!=='string')throw Error('消息草稿参数无效');const existing=await load(p.id);if(!existing)throw Error('图片或消息草稿不存在');const attachments=attachmentSelection(p,existing);return dto(await workflow.confirm(p.id,{content:p.content,attachments,recipientId:typeof p.recipientId==='string'?p.recipientId:undefined}));},
  async dismiss(p:Params){if(typeof p.id!=='string')throw Error('消息草稿标识无效');const existing=await load(p.id);const account=await runtime.readAccount();if(!existing||existing.accountId!==account.accountId)throw Error('草稿所属账号已变化或草稿不存在');if(existing.status==='ready')await workflow.cancel(p.id);const latest=(await request('storage.get',{key:'message-latest-draft'})).value;if(latest===p.id)await save('message-latest-draft',null);return {ok:true};},
  async recall(p:Params){if(typeof p.id!=='string')throw Error('消息草稿标识无效');return dto(await workflow.recall(p.id,p.confirmed===true));},
 };
}

