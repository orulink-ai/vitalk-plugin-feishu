import {PreparationError} from './person-context';
type Attachment={id:string;dataUrl:string;width:number;height:number};
type VoiceRequest={requestId:string;actionId:string;transcript:string;sessionId:string;attachments?:Attachment[]};
type Result={title:string;text:string;links?:{label:string;url:string}[]};
type Creation={receipt:{guid?:string;eventId?:string;url:string;status?:string;reason?:string;notification?:string};plan:{summary:string;recipientQuery?:string;participantQueries?:string[]}};
type MessageDraft={id:string;content?:string;recipient?:{id:string;name:string};recipientCandidates?:{id:string;name:string}[]};
type Dependencies={
 diagnostic?(entry:{requestId:string;action:string;stage:string;status:'started'|'completed'|'failed'|'cancelled';elapsedMs:number;code?:string;upstreamCode?:number;causeCodes?:string[]}):void;
 operation?(input:{kind:'task'|'calendar';prompt:string;operationId:string;signal:AbortSignal}):Promise<{kind:'create'}|({kind:'result'}&Result)>;
 create(input:{kind:'task'|'calendar';prompt:string;operationId:string;signal:AbortSignal;onConfirmed?:(value:unknown)=>void}):Promise<Creation>;
 progress?(requestId:string,result:Result):Promise<unknown>;
 prepareMessage(prompt:string,signal:AbortSignal,attachments?:Attachment[]):Promise<MessageDraft>;
 confirmMessage?(requestId:string,draft:MessageDraft,signal:AbortSignal):Promise<Result>;
 showMessage(draftId:string):Promise<void>;
};
/** Voice and page actions share plugin business services. Host action IDs are
 * routing context, never a reason to demand a particular spoken sentence. */
export function createVoiceWorkflow(deps:Dependencies){
 return async(event:VoiceRequest,signal:AbortSignal):Promise<Result>=>{
  const stage=async<T>(name:string,operation:()=>Promise<T>):Promise<T>=>{
   const started=performance.now();
   const report=(status:'started'|'completed'|'failed'|'cancelled',error?:unknown)=>{
    let code:string|undefined;
    let upstreamCode:number|undefined;
    const causeCodes:string[]=[];
    try{
     const raw=error&&typeof error==='object'&&'code' in error?String(error.code):'';
     code=/^[A-Z_][A-Z_0-9]{0,63}$/i.test(raw)?raw:undefined;
     const upstream=error&&typeof error==='object'&&'upstreamCode' in error?error.upstreamCode:undefined;
     if(typeof upstream==='number'&&Number.isSafeInteger(upstream))upstreamCode=upstream;
     let current:unknown=error;
     const seen=new Set<unknown>();
     for(let depth=0;depth<4&&current&&typeof current==='object'&&!seen.has(current);depth++){
      seen.add(current);
      current='cause' in current?current.cause:undefined;
      if(current&&typeof current==='object'&&'code' in current){
       const nested=String(current.code);
       if(/^[A-Z_][A-Z_0-9]{0,63}$/i.test(nested))causeCodes.push(nested);
      }
     }
    }catch{/* Error objects may have throwing getters; preserve the original failure. */}
    try{deps.diagnostic?.({requestId:event.requestId,action:event.actionId,stage:name,status,elapsedMs:Math.round(performance.now()-started),code,upstreamCode,causeCodes});}catch{/* Diagnostics cannot change execution. */}
   };
   report('started');
   try{const value=await operation();report('completed');return value;}
   catch(error){report(signal.aborted?'cancelled':'failed',error);throw error;}
  };
  signal.throwIfAborted();
  if(event.actionId==='message'){
   const draft=await stage('message.prepare',()=>deps.prepareMessage(event.transcript,signal,event.attachments));
   signal.throwIfAborted();
   if(deps.confirmMessage)return stage('message.confirm',()=>deps.confirmMessage!(event.requestId,draft,signal));
   try{await stage('message.open',()=>deps.showMessage(draft.id));}catch{
    signal.throwIfAborted();
    return {title:'消息草稿已保存',text:'未能自动打开确认页面。请手动打开飞书插件，在消息中确认联系人和正文后发送；消息尚未发送。'};
   }
   signal.throwIfAborted();
   return {title:'消息待确认',text:'草稿已整理，请在飞书插件确认联系人和正文后发送。'};
  }
  if(event.actionId!=='task'&&event.actionId!=='calendar')throw Error('不支持的飞书语音操作');
  const kind=event.actionId;
  const operation=deps.operation?await stage(`${kind}.intent`,()=>deps.operation!({kind,prompt:event.transcript,operationId:event.requestId,signal})):undefined;
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
  const creation=await stage(`${kind}.create`,()=>deps.create({kind,prompt:event.transcript,operationId:event.requestId,signal,onConfirmed}));
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


/** Keep failures visible: the transport SDK otherwise discards thrown details. */
export function createReportedVoiceWorkflow(deps:Dependencies){
 return async(event:VoiceRequest,signal:AbortSignal):Promise<Result>=>{
  let failure:Parameters<NonNullable<Dependencies['diagnostic']>>[0]|undefined;
  const started=performance.now();
  const run=createVoiceWorkflow({...deps,diagnostic:entry=>{
   if(entry.status==='failed')failure=entry;
   deps.diagnostic?.(entry);
  }});
  try{return await run(event,signal);}catch(error){
   signal.throwIfAborted();
   if(failure?.stage==='message.confirm'&&failure.code==='MESSAGE_CONFIRMATION_CANCELLED')return {title:'消息已取消',text:'消息尚未发送，草稿已保留。'};
   if(error instanceof DOMException&&error.name==='AbortError')throw error;
   const labels:Record<string,string>={'message.prepare':'整理消息','message.confirm':'确认或发送消息','message.open':'打开确认窗口','task.intent':'理解任务','task.create':'创建任务','calendar.intent':'理解日程','calendar.create':'创建日程'};
   const action=event.actionId==='message'?'消息':event.actionId==='task'?'任务':'日程';
   const stage=failure?labels[failure.stage]||'处理请求':'处理请求';
   const elapsed=(Math.round(performance.now()-started)/1000).toFixed(1);
   if(error instanceof PreparationError)return {title:`${action}处理失败`,text:`${stage}失败：${error.message}。耗时 ${elapsed} 秒。本次请求未执行发送或创建。`};
   const codes=[failure?.code,failure?.upstreamCode].filter(value=>value!==undefined);
   const detail=codes.length?`（${codes.join(' / ')}）`:'';
   const dialogUnsent=failure?.stage==='message.confirm'&&['MESSAGE_NOTICE_FAILED','MESSAGE_NOTICE_INVALID_RECEIPT'].includes(failure.code||'');
   const uncertain=!failure||!['message.prepare','message.open'].includes(failure.stage);
   return {title:`${action}处理失败`,text:`${stage}失败${detail}，耗时 ${elapsed} 秒。${dialogUnsent?'消息尚未发送，草稿已保留，请重新打开确认窗口。':uncertain?'操作结果尚未确认，请先在飞书核对，避免重复提交。':'本次请求未执行发送或创建。'}`};
  }
 };
}
