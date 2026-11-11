import {validateMessageAttachments} from './message-attachments';
type DialogRequest=(method:'native.status'|'native.install'|'native.execute'|'files.stage'|'files.release',params:{dependencyId:string;args?:string[];operationId?:string;mimeType?:string;base64?:string;fileId?:string},options:{timeoutMs:number;signal?:AbortSignal})=>Promise<unknown>;

type Input={requestId:string;history?:unknown[];historyOnly?:boolean;draft:{draftId:string;recipientId:string;content:string;recipients:{id:string;name:string}[];attachments?:unknown[]}};
/** Plugin-owned dialog. The host only executes a verified native dependency. */
export function createPluginMessageDialog(request:DialogRequest){
 return async(input:Input,signal?:AbortSignal)=>{
  const dialogRequest:DialogRequest=async(method,params,options)=>{
   try{return await request(method,params,options);}
   catch(error){
    signal?.throwIfAborted();
    if(error instanceof Error&&error.name==='AbortError')throw error;
    const installing=method==='native.install';
    throw Object.assign(Error(installing?'消息确认组件安装未完成，消息尚未发送。':'消息确认窗口未正常完成，消息尚未发送。'),{
     code:installing?'MESSAGE_DIALOG_INSTALL_FAILED':'MESSAGE_DIALOG_FAILED',cause:error,
    });
   }
  };
  signal?.throwIfAborted();
  const dependency={dependencyId:'feishu-message-dialog'};
  const status=await dialogRequest('native.status',dependency,{timeoutMs:10_000,signal}) as {installed?:boolean}|null;
  if(!status?.installed){
   const installed=await dialogRequest('native.install',dependency,{timeoutMs:210_000,signal}) as {installed?:boolean}|null;
   if(!installed?.installed)throw Object.assign(Error('消息确认组件安装未完成，消息尚未发送。'),{code:'MESSAGE_DIALOG_INSTALL_FAILED'});
  }
  signal?.throwIfAborted();
  const staged:{fileId:string;path:string}[]=[];
  try {
   for(const image of validateMessageAttachments(input.draft.attachments)){
    signal?.throwIfAborted();
    const file=await dialogRequest('files.stage',{...dependency,mimeType:'image/png',base64:image.dataUrl.slice('data:image/png;base64,'.length)},{timeoutMs:10_000,signal}) as {fileId:string;path:string};
    staged.push(file);
   }
   const preview={...input.draft,history:input.history??[],...(input.historyOnly?{historyOnly:true}:{}),attachments:staged.map((file,index)=>({path:file.path,id:validateMessageAttachments(input.draft.attachments)[index].id}))};
  const payload=btoa(Array.from(new TextEncoder().encode(JSON.stringify(preview)),byte=>String.fromCharCode(byte)).join(''));
  const execute=(args:string[])=>dialogRequest('native.execute',{...dependency,args,operationId:crypto.randomUUID()},{timeoutMs:660_000,signal});
  let raw:unknown;
  if(payload.length<=24000)raw=await execute([payload]);
  else {
   const transfer=crypto.randomUUID();
   try {
    for(let offset=0;offset<payload.length;offset+=8192){
     signal?.throwIfAborted();
     const stored=await execute(['--store',transfer,String(offset),payload.slice(offset,offset+8192)]) as {exitCode?:number;stdout?:string};
     if(stored?.exitCode!==0||stored.stdout?.trim()!=='{"stored":true}')throw Object.assign(Error('消息确认数据传输未完成，消息尚未发送。'),{code:'MESSAGE_DIALOG_FAILED'});
    }
    raw=await execute(['--open',transfer]);
   } finally {
    await request('native.execute',{...dependency,args:['--discard',transfer],operationId:crypto.randomUUID()},{timeoutMs:10_000}).catch(()=>{});
   }
  }
  signal?.throwIfAborted();
  const response=raw as {exitCode?:unknown;stdout?:unknown}|null;
  if(response?.exitCode!==0||typeof response.stdout!=='string')throw Object.assign(Error('消息确认窗口未正常完成，消息尚未发送。'),{code:'MESSAGE_DIALOG_FAILED'});
  let receipt:Record<string,unknown>;
  try{receipt=JSON.parse(response.stdout);if(!receipt||typeof receipt!=='object')throw Error();}
  catch{throw Object.assign(Error('消息确认回执无效，消息尚未发送。'),{code:'MESSAGE_DIALOG_INVALID_RECEIPT'});}
  if(receipt.confirmed===false)throw new DOMException('已取消消息发送','AbortError');
  if(receipt.confirmed!==true||receipt.draftId!==input.draft.draftId||!input.draft.recipients.some(r=>r.id===receipt.recipientId)||typeof receipt.content!=='string'||!receipt.content.trim())throw Object.assign(Error('消息确认与当前草稿不匹配，消息尚未发送。'),{code:'MESSAGE_DIALOG_DRAFT_MISMATCH'});
  if(receipt.attachmentIds!==undefined&&(!Array.isArray(receipt.attachmentIds)||new Set(receipt.attachmentIds).size!==receipt.attachmentIds.length||receipt.attachmentIds.some(id=>typeof id!=='string'||!validateMessageAttachments(input.draft.attachments).some(image=>image.id===id))))throw Object.assign(Error('消息图片与当前草稿不匹配，消息尚未发送。'),{code:'MESSAGE_DIALOG_DRAFT_MISMATCH'});
  return {draftId:input.draft.draftId,recipientId:receipt.recipientId as string,content:receipt.content,...(Array.isArray(receipt.attachmentIds)?{attachmentIds:receipt.attachmentIds as string[]}:{})};
  } finally {
   await Promise.allSettled(staged.map(file=>request('files.release',{...dependency,fileId:file.fileId},{timeoutMs:10_000})));
  }
 };
}
