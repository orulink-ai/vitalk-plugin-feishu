import type {FeishuMessageAttachment} from './original-workspace/FeishuMessagePanel';
import {validateMessageAttachments} from './message-attachments';
import {prepareMessage,eligibleMessageRecipient,type MessageRecipient,type MessageModel} from './message-intent';
import type {CliAuthStatus} from './cli-auth';
import type {Cli} from './task-service';
export type MessageDraft={id:string;accountId:string;prompt:string;recipient?:MessageRecipient;awaitingRecipient?:boolean;recipientQuery?:string;recipientCandidates?:MessageRecipient[];content:string;status:'ready'|'sending'|'sent'|'unknown'|'cancelled'|'recalling'|'recalled'|'recall_unknown';messageId?:string;attachments?:FeishuMessageAttachment[]};
type Dependencies={readRecipient?:(id:string)=>Promise<MessageRecipient|undefined>;readDraftRecipients?:()=>Promise<MessageRecipient[]>;contentArgs?:(draft:MessageDraft,check:()=>Promise<void>)=>Promise<string[]>;cli:Cli;readAccount:()=>Promise<CliAuthStatus>;readRecipients:()=>Promise<MessageRecipient[]>;model:MessageModel;store:{read:(id:string)=>Promise<MessageDraft|undefined>;write:(draft:MessageDraft)=>Promise<void>}};
/** Store must durably save the pre-I/O claim. A restarted process must keep
 * sending/unknown claims and never turn them back into ready drafts. */
export function createMessageWorkflow(deps:Dependencies){
 const inFlight=new Set<string>();
 function grant(account:CliAuthStatus,scope='im:message.send_as_user'){
  if(!/^ou_[A-Za-z0-9_-]+$/.test(account.accountId))throw Error('飞书账号未确认');
  if(!account.scopes.includes(scope))throw Error('飞书缺少消息权限，请重新授权');
 }
 async function owned(id:string,scope?:string){
  const account=await deps.readAccount();grant(account,scope);
  const draft=await deps.store.read(id);
  if(!draft||draft.id!==id||draft.accountId!==account.accountId)throw Error('草稿所属账号已变化或草稿不存在');
  if(typeof draft.content!=='string'||!draft.content.trim()||draft.content.length>10000||draft.content.includes('\0')||(draft.recipient?!eligibleMessageRecipient(draft.recipient):!(draft.awaitingRecipient&&draft.status==='ready')))throw Error('草稿记录无效，请重新生成');
  return structuredClone(draft);
 }
 async function exclusive<T>(id:string,fn:()=>Promise<T>){if(inFlight.has(id))throw Error('消息正在处理中');inFlight.add(id);try{return await fn();}finally{inFlight.delete(id);}}
 return {
  async prepare(source:string,preference:string,attachments:FeishuMessageAttachment[]=[]){
   attachments=validateMessageAttachments(attachments);
   const account=await deps.readAccount();grant(account);
   const plan=await prepareMessage(source,await (deps.readDraftRecipients??deps.readRecipients)(),deps.model,preference);
   const fresh=await deps.readAccount();grant(fresh);if(fresh.accountId!==account.accountId)throw Error('飞书账号已变化，未创建草稿');
   const draft:MessageDraft={id:crypto.randomUUID(),accountId:account.accountId,prompt:source,...plan,attachments,status:'ready'};
   await deps.store.write(draft);return structuredClone(draft);
  },
  async edit(id:string,change:{recipientId?:string;content:string;attachments?:FeishuMessageAttachment[]}){return exclusive(id,async()=>{
   const draft=await owned(id);if(draft.status!=='ready')throw Error('草稿不可编辑');
   if(!change.content.trim()||change.content.length>10000||change.content.includes('\0'))throw Error('消息正文无效');
   const target=change.recipientId??draft.recipient?.id;
   const recipient=(deps.readRecipient?(target?[await deps.readRecipient(target)]:[]):await deps.readRecipients()).filter((r):r is MessageRecipient=>!!r).find(r=>r.id===target&&eligibleMessageRecipient(r));if(!recipient)throw Error('消息对象已不可用');
   draft.recipient=recipient;draft.awaitingRecipient=false;draft.recipientCandidates=[];draft.content=change.content;if(change.attachments!==undefined)draft.attachments=validateMessageAttachments(change.attachments);await deps.store.write(draft);return structuredClone(draft);
  });},
  async cancel(id:string){return exclusive(id,async()=>{const draft=await owned(id);if(draft.status!=='ready')throw Error('消息已提交，不能作为草稿取消，请核对飞书结果');draft.status='cancelled';await deps.store.write(draft);return draft;});},
  async confirm(id:string,change?:{recipientId?:string;content:string;attachments?:FeishuMessageAttachment[]}){return exclusive(id,async()=>{
   const draft=await owned(id);
   if(['sent','unknown','sending'].includes(draft.status))return draft;
   if(draft.status!=='ready')throw Error('草稿已关闭，未发送');
   if(change&&(!change.content.trim()||change.content.length>10000||change.content.includes('\0')))throw Error('消息正文无效');
   const target=change?.recipientId??draft.recipient?.id;
   if(!target||(!change?.recipientId&&draft.awaitingRecipient))throw Error('请先选择消息对象');
   const recipient=(deps.readRecipient?(target?[await deps.readRecipient(target)]:[]):await deps.readRecipients()).filter((r):r is MessageRecipient=>!!r).find(r=>r.id===target&&(!draft.recipient||change?.recipientId!==undefined||r.kind===draft.recipient.kind)&&eligibleMessageRecipient(r));
   if(!recipient)throw Error('消息对象已不可用，请重新选择');
   draft.recipient=recipient;draft.awaitingRecipient=false;draft.recipientCandidates=[];
   if(change){draft.content=change.content;if(change.attachments!==undefined)draft.attachments=validateMessageAttachments(change.attachments);}
   // Recheck after asynchronous candidate loading, before making the claim.
   const account=await deps.readAccount();grant(account);if(account.accountId!==draft.accountId)throw Error('飞书账号已变化，未发送');
   if(draft.attachments?.length&&!account.scopes.includes('im:resource'))throw Object.assign(Error('飞书缺少图片资源权限，请重新授权或移除图片后发送'),{code:'message_not_submitted'});
   draft.status='sending';await deps.store.write(draft);
   try{
    const check=async()=>{const a=await deps.readAccount();grant(a);if(a.accountId!==draft.accountId)throw Error('飞书账号已变化');};
    const body=deps.contentArgs?await deps.contentArgs(draft,check):['--text',draft.content];await check();
    const receipt=await deps.cli(['im','+messages-send',recipient.kind==='person'?'--user-id':'--chat-id',recipient.id,...body,'--idempotency-key',`vt-${draft.id}`,'--as','user','--format','json'],`message-${draft.id}`);
    const messageId=receipt&&typeof receipt==='object'?(receipt as {message_id?:unknown}).message_id:undefined;
    if(typeof messageId==='string'&&/^om_[A-Za-z0-9_-]+$/.test(messageId)){draft.status='sent';draft.messageId=messageId;}else draft.status='unknown';
   }catch{draft.status='unknown';}
   // Preserve the durable sending claim if receipt persistence fails.
   await deps.store.write(draft);return structuredClone(draft);
  });},
  async recall(id:string,confirmed:boolean){return exclusive(id,async()=>{
   if(confirmed!==true)throw Error('请确认撤回这条消息');
   const draft=await owned(id,'im:message');
   if(['recalled','recall_unknown','recalling'].includes(draft.status))return draft;
   if(draft.status!=='sent'||!draft.messageId||!/^om_[A-Za-z0-9_-]+$/.test(draft.messageId))throw Error('只有已确认发送的消息才能撤回');
   draft.status='recalling';await deps.store.write(draft);
   try{const receipt=await deps.cli(['im','messages','delete','--message-id',draft.messageId,'--yes','--as','user','--format','json'],`recall-${draft.id}`);draft.status=receipt&&typeof receipt==='object'&&!Array.isArray(receipt)?'recalled':'recall_unknown';}
   catch{draft.status='recall_unknown';}
   await deps.store.write(draft);return structuredClone(draft);
  });},
 };
}
