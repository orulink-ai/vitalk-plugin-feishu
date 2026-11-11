type Recipient={id:string;name:string};
type Draft={id:string;content?:string;recipient?:Recipient;recipientCandidates?:Recipient[];attachments?:unknown[]};
type Confirmation={draftId:string;recipientId:string;content:string;attachmentIds?:string[]};
type Dependencies={
 context?():Promise<{recipients:Recipient[];history:unknown[]}>;
 confirm(input:{requestId:string;history?:unknown[];draft:Confirmation&{recipients:Recipient[];attachments?:unknown[]}}):Promise<Confirmation>;
 send(input:{id:string;recipientId:string;content:string;attachmentIds?:string[]}):Promise<{status:string;receipt?:string;error?:string}>;
 show(draftId:string):Promise<void>;
};
export async function confirmVoiceMessage(deps:Dependencies,requestId:string,draft:Draft,signal:AbortSignal){
 signal.throwIfAborted();
 const context=deps.context?await deps.context():undefined;
 signal.throwIfAborted();
 const recipients=[...new Map([...(context?.recipients??[]),...(draft.recipient?[draft.recipient]:[]),...(draft.recipientCandidates??[])].map(r=>[r.id,r])).values()];
 const reply=await deps.confirm({requestId,...(context?{history:context.history}:{}),draft:{draftId:draft.id,recipientId:draft.recipient?.id??'',content:draft.content??'',recipients,...(draft.attachments?.length?{attachments:draft.attachments}:{})}});
 signal.throwIfAborted();
 if(reply.draftId!==draft.id||!recipients.some(r=>r.id===reply.recipientId)||!reply.content.trim())throw Error('消息确认与当前草稿不匹配，未发送。');
 const result=await deps.send({id:draft.id,recipientId:reply.recipientId,content:reply.content,...(reply.attachmentIds?{attachmentIds:reply.attachmentIds}:{})});
 if(result.status==='sent'&&result.receipt)return {title:'消息已发送',text:reply.content};
 return {title:'消息发送待核实',text:result.error||'尚未取得飞书发送成功回执，请先在飞书核对，避免重复发送。'};
}
