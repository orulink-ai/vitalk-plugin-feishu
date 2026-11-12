import {type NoticeForm,type NoticeRecord,type NoticeReply,validNoticeReply} from '@vitalk/plugin-sdk';
import type {AiReply} from './experiments/client';
import {validateMessageAttachments} from './message-attachments';
import {feishuDetailUrl} from './original-workspace/workspace-receipts';
type Present=(form:NoticeForm,options:{timeoutMs:number;signal?:AbortSignal})=>Promise<NoticeReply>;
type Input={requestId:string;history?:unknown[];draft:{draftId:string;recipientId:string;content:string;recipients:{id:string;name:string}[];attachments?:unknown[]}};
function preview(value:string,max:number){return value.length<=max?value:value.slice(0,max-1).replace(/[\uD800-\uDBFF]$/,'')+'…';}
export function noticeRecords(history:unknown[]):NoticeRecord[]{
 const all=(history as AiReply[]).filter(r=>r&&typeof r.id==='string'&&typeof r.prompt==='string'&&r.command?.destination.startsWith('feishu'));
 const records=all.slice(0,499).map(r=>{
  const command=r.command!;const url=feishuDetailUrl(command.task?.url??command.meeting?.url??'');
  const detail=[r.status==='completed'?'已完成':r.status==='cancelled'?'已取消':r.status==='failed'?'执行未完成':'处理中',command.task?.assignee,command.task?.notification,command.meeting&&`${command.meeting.start} — ${command.meeting.end}`,command.meeting?.participants.join('、'),command.meeting?.invitation].filter(Boolean).join(' · ');
  return {id:r.id,title:preview(command.task?.summary||r.prompt,512),text:preview(r.error||r.text||'',32768),detail:preview(detail,1024),...(url?{url}:{})};
 });
 if(all.length>499)records.unshift({id:'history-range',title:`显示最近 499 条，共 ${all.length} 条`,text:'更早的记录仍保存在本机。',detail:''});
 return records;
}
/** Host renders and validates; plugin alone validates draft identity and sends. */
export function createMessageNotice(present:Present){return async(input:Input,signal?:AbortSignal)=>{
 signal?.throwIfAborted();const images=validateMessageAttachments(input.draft.attachments);
 const form:NoticeForm={title:'消息待确认',submitLabel:'确认发送',fields:[
  {id:'recipient',label:'发送对象',type:'select',required:true,value:input.draft.recipientId,options:input.draft.recipients.map(r=>({id:r.id,label:r.name}))},
  {id:'content',label:'正文',type:'text',required:true,value:input.draft.content},
  ...(images.length?[{id:'images',label:'图片',type:'images' as const,value:images.map(i=>i.id),images:images.map(({id,dataUrl})=>({id,dataUrl}))}]:[]),
 ],records:noticeRecords(input.history??[])};
 let reply:NoticeReply;
 try{reply=await present(form,{timeoutMs:660_000,signal});}catch(cause){signal?.throwIfAborted();throw Object.assign(Error('消息确认窗口未正常完成，消息尚未发送。'),{code:'MESSAGE_NOTICE_FAILED',cause});}
 signal?.throwIfAborted();
 if(!validNoticeReply(form,reply))throw Object.assign(Error('消息确认回执与当前草稿不匹配，消息尚未发送。'),{code:'MESSAGE_NOTICE_INVALID_RECEIPT'});
 if(!reply.confirmed)throw Object.assign(Error('已取消消息发送'),{code:'MESSAGE_CONFIRMATION_CANCELLED'});
 return {draftId:input.draft.draftId,recipientId:reply.values.recipient as string,content:reply.values.content as string,...(images.length?{attachmentIds:reply.values.images as string[]}:{})};
};}
