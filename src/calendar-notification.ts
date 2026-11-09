import {cardIdempotencyKey} from './card-idempotency';
import {calendarCard} from './calendar-card';
import type {CalendarCreatePlan,CalendarReceipt} from './calendar-service';
import type {Cli} from './task-service';

export type CalendarShareReceipt={status:'sent'|'partial'|'not_sent'|'unconfirmed';sentRecipientIds:string[];unconfirmedRecipientIds:string[];reason:string};
/** The caller must supply identities confirmed by invitation receipts. Counts
 * alone are never evidence of which people received an invitation. */
export async function notifyCalendar(cli:Cli,plan:CalendarCreatePlan,receipt:CalendarReceipt & {confirmedRecipientIds?:readonly string[]},operationId:string,beforeSend:()=>Promise<void>):Promise<CalendarShareReceipt>{
  const sentRecipientIds:string[]=[],unconfirmedRecipientIds:string[]=[];
  const result=(status:CalendarShareReceipt['status'],reason:string):CalendarShareReceipt=>({status,sentRecipientIds,unconfirmedRecipientIds,reason});
  const ids=[...new Set(plan.participantIds)].sort();
  const confirmed=receipt.confirmedRecipientIds;
  if(!ids.length)return result('not_sent','个人日程已创建，无需分享邀请卡片。');
  if(receipt.status!=='completed'||receipt.invitationStatus!=='sent'||!confirmed||
    confirmed.length!==ids.length||new Set(confirmed).size!==ids.length||ids.some(id=>!confirmed.includes(id))||
    receipt.participantCount!==ids.length||receipt.invitedCount!==ids.length||ids.some(id=>!/^ou_[A-Za-z0-9_]{1,125}$/.test(id)))
    return result('not_sent','日程邀请名单尚未完整确认，未分享卡片。');
  if(!operationId.trim()||operationId.length>80||!/^[A-Za-z0-9_-]+$/.test(operationId))throw Error('日程通知操作编号无效');
  let card:ReturnType<typeof calendarCard>;
  try{card=calendarCard(plan,receipt.url);}catch{return result('not_sent','日程已创建，详情链接或卡片内容不可用，未分享卡片。');}
  const content=JSON.stringify(card);
  for(const id of ids){
    let providerKey:string;
    try{providerKey=await cardIdempotencyKey('calendar',operationId,id);}
    catch{return result(sentRecipientIds.length?'partial':unconfirmedRecipientIds.length?'unconfirmed':'not_sent','日程已创建，暂时无法生成卡片发送标识，已停止后续卡片分享。');}
    try{await beforeSend();}catch{return result(sentRecipientIds.length?'partial':unconfirmedRecipientIds.length?'unconfirmed':'not_sent','账号或权限发生变化，已停止后续卡片分享。');}
    const key=`${operationId}:calendar-notification:${id}`;
    try{
      const response=await cli(['im','+messages-send','--user-id',id,'--msg-type','interactive','--content',content,'--idempotency-key',providerKey,'--as','user','--format','json'],key);
      const messageId=response&&typeof response==='object'?(response as {message_id?:unknown}).message_id:undefined;
      if(typeof messageId==='string'&&/^om_[A-Za-z0-9_-]+$/.test(messageId)){sentRecipientIds.push(id);continue;}
    }catch{/* Sending uncertainty must not replay the calendar or message. */}
    unconfirmedRecipientIds.push(id);
  }
  if(sentRecipientIds.length===ids.length)return result('sent','已向全部受邀参与人分享日程卡片；不代表已接受邀请。');
  return result(sentRecipientIds.length?'partial':'unconfirmed','部分或全部卡片分享结果未确认，请在飞书核对；不会自动重复发送。');
}
