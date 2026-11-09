type Attachment={id:string;dataUrl:string;width:number;height:number};
type VoiceRequest={requestId:string;actionId:string;transcript:string;sessionId:string;attachments?:Attachment[]};
type Result={title:string;text:string;links?:{label:string;url:string}[]};
type Creation={receipt:{guid?:string;eventId?:string;url:string;status?:string;reason?:string;notification?:string};plan:{summary:string;recipientQuery?:string;participantQueries?:string[]}};
type Dependencies={
 operation?(input:{kind:'task'|'calendar';prompt:string;operationId:string;signal:AbortSignal}):Promise<{kind:'create'}|({kind:'result'}&Result)>;
 create(input:{kind:'task'|'calendar';prompt:string;operationId:string;signal:AbortSignal;onConfirmed?:(value:unknown)=>void}):Promise<Creation>;
 progress?(requestId:string,result:Result):Promise<unknown>;
 prepareMessage(prompt:string,signal:AbortSignal,attachments?:Attachment[]):Promise<{id:string}>;
 showMessage(draftId:string):Promise<void>;
};
/** Voice and page actions share plugin business services. Host action IDs are
 * routing context, never a reason to demand a particular spoken sentence. */
export function createVoiceWorkflow(deps:Dependencies){
 return async(event:VoiceRequest,signal:AbortSignal):Promise<Result>=>{
  signal.throwIfAborted();
  if(event.actionId==='message'){
   const draft=await deps.prepareMessage(event.transcript,signal,event.attachments);
   signal.throwIfAborted();
   await deps.showMessage(draft.id);
   return {title:'消息待确认',text:'草稿已整理，请在飞书插件确认联系人和正文后发送。'};
  }
  if(event.actionId!=='task'&&event.actionId!=='calendar')throw Error('不支持的飞书语音操作');
  const kind=event.actionId;
  const operation=await deps.operation?.({kind,prompt:event.transcript,operationId:event.requestId,signal});
  signal.throwIfAborted();
  if(operation?.kind==='result')return {title:operation.title,text:operation.text,links:operation.links};
  // Keep the handler and native cancellation lease alive through invitations and
  // sharing. Progress is presentation only, never completion or a retry trigger.
  let pendingProgress:Promise<unknown>=Promise.resolve();
  const onConfirmed=(value:unknown)=>{
   if(signal.aborted||!deps.progress||!isCreation(value,kind))return;
   pendingProgress=pendingProgress.then(()=>{
    if(!signal.aborted)return deps.progress!(event.requestId,creationResult(kind,value));
   }).catch(()=>{/* A presentation failure cannot erase a confirmed mutation. */});
  };
  const creation=await deps.create({kind,prompt:event.transcript,operationId:event.requestId,signal,onConfirmed});
  await pendingProgress;
  const {receipt,plan}=creation;
  signal.throwIfAborted();
  if(kind==='task'?!receipt.guid:!receipt.eventId)throw Error('未取得完整的飞书创建回执，请先核对远端结果。');
  return creationResult(kind,{receipt,plan});
 };
}

function isCreation(value:unknown,kind:'task'|'calendar'):value is Creation{
 if(!value||typeof value!=='object')return false;
 const {receipt,plan}=value as {receipt?:Record<string,unknown>;plan?:Record<string,unknown>};
 return !!receipt&&!!plan&&typeof receipt[kind==='task'?'guid':'eventId']==='string'
  &&!!receipt[kind==='task'?'guid':'eventId']&&typeof receipt.url==='string'&&typeof plan.summary==='string';
}
function creationResult(kind:'task'|'calendar',{receipt,plan}:Creation):Result{
 const label=kind==='task'?'任务':'日程';
 const partial=kind==='calendar'&&receipt.status==='partial';
 const details=[plan.summary,plan.recipientQuery,plan.participantQueries?.join('、'),receipt.reason,receipt.notification].filter(Boolean);
 return {title:partial?'日程已创建，邀请待核实':`${label}已创建`,text:details.join('\n'),links:receipt.url?[{label:`在飞书查看${label}`,url:receipt.url}]:undefined};
}
