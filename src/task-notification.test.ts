import {expect,it,vi} from 'vitest';
import {notifyTask} from './task-notification';
it('shares the same task to each assignee with independent operation identities',async()=>{
 const cli=vi.fn().mockResolvedValue({message_id:'om_shared'});
 const result=await notifyTask(cli,{action:'create',assigneeId:'ou_a',assigneeIds:['ou_a','ou_b'],summary:'共享任务',description:'',due:null},'task-shared','operation-shared',async()=>{});
 expect(cli).toHaveBeenCalledTimes(2);expect(cli.mock.calls.map(([args])=>args[args.indexOf('--user-id')+1])).toEqual(['ou_a','ou_b']);
 expect(new Set(cli.mock.calls.map(([,operation])=>operation)).size).toBe(2);expect(result.status).toBe('sent');
});
const task={action:'create' as const,assigneeId:'ou_ice',summary:'带电脑找我',description:'',due:null};
it('keeps confirmed task success when card formatting fails',async()=>{
  const cli=vi.fn();
  await expect(notifyTask(cli,{...task,due:'invalid-date'},'task-123','op-1',async()=>{})).resolves.toMatchObject({status:'not_sent',reason:expect.stringContaining('任务已创建')});
  expect(cli).not.toHaveBeenCalled();
});
it('sends one share card only to the confirmed task assignee',async()=>{
  const cli=vi.fn().mockResolvedValue({message_id:'om_123'});
  const result=await notifyTask(cli,task,'task-123','op-1',async()=>{});
  expect(result).toMatchObject({status:'sent',messageId:'om_123'});
  expect(cli).toHaveBeenCalledTimes(1);
  expect(cli.mock.calls[0][0]).toContain('ou_ice');
  expect(cli.mock.calls[0][1]).toBe('op-1:notification');
});
it('does not send when the final account guard fails',async()=>{
  const cli=vi.fn();
  expect(await notifyTask(cli,task,'task-123','op-1',async()=>{throw new Error('账号切换');})).toMatchObject({status:'not_sent'});
  expect(cli).not.toHaveBeenCalled();
});
it.each([null,{}, {message_id:''}])('keeps task success separate from missing notification receipt',async response=>{
  const cli=vi.fn().mockResolvedValue(response);
  expect(await notifyTask(cli,task,'task-123','op-1',async()=>{})).toMatchObject({status:'unconfirmed'});
  expect(cli).toHaveBeenCalledTimes(1);
});
it('does not leak CLI errors or retry uncertain sends',async()=>{
  const cli=vi.fn().mockRejectedValue(new Error('secret-token'));
  const result=await notifyTask(cli,task,'task-123','op-1',async()=>{});
  expect(result.status).toBe('unconfirmed');expect(JSON.stringify(result)).not.toContain('secret-token');expect(cli).toHaveBeenCalledTimes(1);
});

it('uses a stable provider key within the CLI limit and bound to the task recipient',async()=>{
  const cli=vi.fn().mockResolvedValue({message_id:'om_ok'});
  const id='13bf963b-8419-41e0-9a83-83f1330c5799';
  for(const [operationId,assigneeId] of [[id,'ou_ice'],[id,'ou_ice'],[id,'ou_other'],['23bf963b-8419-41e0-9a83-83f1330c5799','ou_ice']]){
    await notifyTask(cli,{...task,assigneeId},'task-123',operationId,async()=>{});
  }
  const keys=cli.mock.calls.map(([args])=>args[args.indexOf('--idempotency-key')+1]);
  expect(keys.every(key=>key.length<=50)).toBe(true);
  expect(keys[0]).toBe(keys[1]);
  expect(new Set(keys).size).toBe(3);
  expect(cli.mock.calls[0][1]).toBe(id+':notification');
});
