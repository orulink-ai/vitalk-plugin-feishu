import {cardIdempotencyKey} from './card-idempotency';
import {taskCard} from './task-card';
import type {TaskPlan} from './task-intent';
import type {Cli} from './task-service';
type Notification={status:'sent'|'not_sent'|'unconfirmed';messageId?:string;reason:string};
/** Invoke only with the frozen plan and a confirmed task receipt. Notification
 * failure does not undo the task and must never trigger another task creation.
 */
async function notifySingleTask(cli:Cli,plan:TaskPlan,guid:string,operationId:string,beforeSend:()=>Promise<void>):Promise<Notification>{
  let card:ReturnType<typeof taskCard>;
  let providerKey:string;
  try{
    if(!operationId.trim()||operationId.length>220||operationId.includes('\0'))throw new Error('任务通知操作编号无效');
    card=taskCard(plan,guid);
    providerKey=await cardIdempotencyKey('task',operationId,plan.assigneeId);
  }catch{return {status:'not_sent',reason:'任务已创建，通知卡片暂不可用，未发送通知。'};}
  try{await beforeSend();}catch{return {status:'not_sent',reason:'任务已创建，连接或权限发生变化，通知未发送。'};}
  try{
    const result=await cli(['im','+messages-send','--user-id',plan.assigneeId,'--msg-type','interactive','--content',JSON.stringify(card),'--idempotency-key',providerKey,'--as','user','--format','json'],`${operationId}:notification`);
    const id=result&&typeof result==='object'?(result as {message_id?:unknown}).message_id:undefined;
    if(typeof id==='string'&&/^om_[A-Za-z0-9_-]+$/.test(id))return {status:'sent',messageId:id,reason:'任务已创建，已向负责人分享任务卡片。'};
  }catch{/* Keep the confirmed task; do not leak CLI output or replay the send. */}
  return {status:'unconfirmed',reason:'任务已创建，通知结果未确认，请在飞书核对；不会重复发送。'};
}
export async function notifyTask(cli:Cli,plan:TaskPlan,guid:string,operationId:string,beforeSend:()=>Promise<void>):Promise<Notification>{
 const ids=[...new Set(plan.assigneeIds??[plan.assigneeId])];
 if(ids.length<=1)return notifySingleTask(cli,plan,guid,operationId,beforeSend);
 const results:Notification[]=[];
 for(let index=0;index<ids.length;index++)results.push(await notifySingleTask(cli,{...plan,assigneeId:ids[index]},guid,`${operationId}:${index}`,beforeSend));
 const sent=results.filter(r=>r.status==='sent').length;
 return {status:sent===ids.length?'sent':results.some(r=>r.status==='unconfirmed')?'unconfirmed':'not_sent',reason:`任务已创建，已向 ${sent}/${ids.length} 位负责人分享同一任务卡片。${sent<ids.length?'其余通知未确认，请在飞书核对。':''}`};
}
