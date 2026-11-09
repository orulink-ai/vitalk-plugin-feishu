import type {CliAuthStatus} from './cli-auth';
import {prepareTask,type Person,type TaskPlan} from './task-intent';
import {createTask,type Cli} from './task-service';
import {notifyTask} from './task-notification';

type TaskReceipt={guid:string;url:string;assignee:string;summary:string};
type Dependencies={
  readAccount:()=>Promise<CliAuthStatus>;
  readPeople:()=>Promise<Person[]>;
  model:(input:unknown,instructions:string)=>Promise<unknown>;
  cli:Cli;
  onCreated?:(receipt:TaskReceipt,plan:TaskPlan)=>Promise<void>;
  shareCard?:boolean;
};
function requireTaskGrant(account:CliAuthStatus){
  if(!/^ou_[A-Za-z0-9_-]+$/.test(account.accountId))throw new Error('飞书账号未确认，请重新检查连接。');
  if(!account.scopes.includes('task:task:write'))throw new Error('飞书缺少任务权限，请重新授权。');
}
/** Fresh CLI identity reads bracket model work. A confirmed creation is kept even
 * when saving its receipt or sending the subsequent share card fails. */
export async function runTaskCreation(input:{source:string;operationId:string;referenceTime:string},deps:Dependencies){
  if(!input.operationId.trim()||input.operationId.length>240||input.operationId.includes('\0'))throw new Error('任务操作编号无效');
  const before=await deps.readAccount();
  requireTaskGrant(before);
  const people=await deps.readPeople();
  const plan=await prepareTask(input.source,people,input.referenceTime,deps.model);
  const current=await deps.readAccount();
  requireTaskGrant(current);
  if(current.accountId!==before.accountId)throw new Error('飞书账号已切换，未创建任务。');
  const receipt=await createTask(deps.cli,plan,input.operationId);
  const task={...receipt,assignee:people.find(person=>person.id===plan.assigneeId)!.name,summary:plan.summary};
  try{await deps.onCreated?.(task,plan);}catch{
    return {...task,plan,notification:{status:'not_sent' as const,reason:'任务已创建，本地回执保存失败，通知未发送；请在飞书查看任务。'}};
  }
  if(!deps.shareCard)return {...task,plan,notification:undefined};
  const notification=await notifyTask(deps.cli,plan,receipt.guid,input.operationId,async()=>{
    const account=await deps.readAccount();
    if(account.accountId!==before.accountId||!account.scopes.includes('im:message.send_as_user'))throw new Error('消息授权已变化');
  });
  return {...task,plan,notification};
}


