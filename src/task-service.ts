import type {TaskPlan} from './task-intent';
export type Cli = (args: string[], operationId: string) => Promise<unknown>;
/** Called after intent resolution and current-account permission validation. */
export async function createTask(cli: Cli, plan: TaskPlan, operationId: string): Promise<{guid:string;url:string}> {
  if (!operationId.trim() || operationId.length > 256 || operationId.includes('\0')) throw new Error('任务操作编号无效');
  const members=plan.assigneeIds?[...new Set(plan.assigneeIds)]:[plan.assigneeId];
  if(!members.length||members.some(id=>!/^ou_[A-Za-z0-9_]+$/.test(id)))throw new Error('任务负责人无效，尚未创建');
  const args=['task','+create','--summary',plan.summary,...(plan.assigneeIds?['--data',JSON.stringify({members:members.map(id=>({id,type:'user',role:'assignee'}))})]:['--assignee',plan.assigneeId]),'--idempotency-key',`vitalk-${operationId}`,'--as','user','--format','json'];
  if(plan.description) args.push('--description',plan.description);
  if(plan.due) args.push('--due',plan.due);
  const result=await cli(args,operationId);
  const guid=result && typeof result==='object' ? (result as {guid?:unknown}).guid : undefined;
  if(typeof guid!=='string' || !/^[a-zA-Z0-9-]{1,80}$/.test(guid)) throw new Error('任务回执未确认，请在飞书核对；不会重复创建。');
  return {guid,url:`https://applink.feishu.cn/client/todo/detail?guid=${guid}`};
}
