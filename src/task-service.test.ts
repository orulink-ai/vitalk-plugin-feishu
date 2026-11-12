import {expect,it,vi} from 'vitest';
import {createTask} from './task-service';
const plan={action:'create' as const,assigneeId:'ou_ice',summary:'带上电脑来找我',description:'记得充电器，不买新的',due:null};
it('creates one task with several user assignees rather than one task per person',async()=>{
 const cli=vi.fn().mockResolvedValue({guid:'shared-task'});
 await createTask(cli,{...plan,assigneeIds:['ou_ice','ou_other']},'shared-1');
 expect(cli).toHaveBeenCalledTimes(1);const args=cli.mock.calls[0][0];
 expect(JSON.parse(args[args.indexOf('--data')+1]).members).toEqual([{id:'ou_ice',type:'user',role:'assignee'},{id:'ou_other',type:'user',role:'assignee'}]);
});
it('creates with literal arguments and returns a task deep link from validated receipt',async()=>{
  const cli=vi.fn().mockResolvedValue({guid:'a12-b34'});
  expect(await createTask(cli,plan,'recording-1')).toEqual({guid:'a12-b34',url:'https://applink.feishu.cn/client/todo/detail?guid=a12-b34'});
  expect(cli).toHaveBeenCalledWith(['task','+create','--summary',plan.summary,'--assignee','ou_ice','--idempotency-key','vitalk-recording-1','--as','user','--format','json','--description',plan.description],'recording-1');
});
it('never retries an uncertain remote result',async()=>{
  const cli=vi.fn().mockRejectedValue(new Error('结果未知'));
  await expect(createTask(cli,plan,'recording-1')).rejects.toThrow('结果未知');
  expect(cli).toHaveBeenCalledTimes(1);
});
it.each([{},null,{guid:'https://evil.test'},{guid:'x&token=secret'}])('rejects invalid receipt %j without manufacturing a link',async receipt=>{
  await expect(createTask(vi.fn().mockResolvedValue(receipt),plan,'recording-1')).rejects.toThrow('核对');
});
it('requires a stable operation identifier before executing',async()=>{
  const cli=vi.fn();
  await expect(createTask(cli,plan,'')).rejects.toThrow('操作编号');
  expect(cli).not.toHaveBeenCalled();
});
