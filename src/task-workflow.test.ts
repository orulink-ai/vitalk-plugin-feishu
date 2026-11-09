import {expect,it,vi} from 'vitest';
import {runTaskCreation} from './task-workflow';
const people=[{id:'ou_ice',name:'阳晓冰',aliases:['小冰'],active:true,external:false}];
const plan={action:'create',assigneeId:'ou_ice',summary:'带电脑来找我',description:'',due:null};
const review={supported:true,complete:true,recipientSupported:true,timeSupported:true};
function fixture(){
  return {readAccount:vi.fn().mockResolvedValue({accountId:'ou_self',scopes:['task:task:write']}),
    readPeople:vi.fn().mockResolvedValue(people),model:vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(review),
    cli:vi.fn().mockResolvedValue({guid:'task-123'})};
}
const input={source:'让小冰带着电脑找我。',operationId:'task-operation-1',referenceTime:'2026-11-07T10:00:00+08:00'};
it('runs natural-language interpretation and one direct creation under the same live account',async()=>{
  const deps=fixture();
  expect(await runTaskCreation(input,deps)).toMatchObject({guid:'task-123',assignee:'阳晓冰',summary:'带电脑来找我',plan});
  expect(deps.readAccount).toHaveBeenCalledTimes(2);
  expect(deps.cli).toHaveBeenCalledTimes(1);
  expect(deps.cli.mock.calls[0][1]).toBe(input.operationId);
});
it('does not execute when account changes during model processing',async()=>{
  const deps=fixture();deps.readAccount.mockResolvedValueOnce({accountId:'ou_self',scopes:['task:task:write']}).mockResolvedValueOnce({accountId:'ou_other',scopes:['task:task:write']});
  await expect(runTaskCreation(input,deps)).rejects.toThrow('账号');expect(deps.cli).not.toHaveBeenCalled();
});
it.each([0,1])('checks task permission before and after model processing (%s)',async index=>{
  const deps=fixture();
  if(index)deps.readAccount.mockResolvedValueOnce({accountId:'ou_self',scopes:['task:task:write']});
  deps.readAccount.mockResolvedValue({accountId:'ou_self',scopes:[]});
  await expect(runTaskCreation(input,deps)).rejects.toThrow('重新授权');expect(deps.cli).not.toHaveBeenCalled();
});
it('preserves uncertain execution without a second creation',async()=>{
  const deps=fixture();deps.cli.mockRejectedValue(new Error('结果未知'));
  await expect(runTaskCreation(input,deps)).rejects.toThrow('结果未知');expect(deps.cli).toHaveBeenCalledTimes(1);
});

it('retains confirmed task if receipt persistence fails and never sends notification',async()=>{
 const deps=fixture();
 const onCreated=vi.fn().mockRejectedValue(new Error('storage failed'));
 const result=await runTaskCreation(input,{...deps,onCreated,shareCard:true});
 expect(result.guid).toBe('task-123');
 expect(result.notification).toMatchObject({status:'not_sent'});
 expect(deps.cli).toHaveBeenCalledTimes(1);
});
it('shares only after persisting the task and rechecking account and message grant',async()=>{
 const deps=fixture();deps.readAccount.mockResolvedValue({accountId:'ou_self',scopes:['task:task:write','im:message.send_as_user']});
 deps.cli.mockResolvedValueOnce({guid:'task-123'}).mockResolvedValueOnce({message_id:'om_card'});
 const onCreated=vi.fn().mockResolvedValue(undefined);
 const result=await runTaskCreation(input,{...deps,onCreated,shareCard:true});
 expect(result.notification).toMatchObject({status:'sent',messageId:'om_card'});
 expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({guid:'task-123'}),plan);
 expect(onCreated.mock.invocationCallOrder[0]).toBeLessThan(deps.cli.mock.invocationCallOrder[1]);
});
it('does not lose created task when notification permission is absent',async()=>{
 const deps=fixture();
 const result=await runTaskCreation(input,{...deps,onCreated:vi.fn().mockResolvedValue(undefined),shareCard:true});
 expect(result.guid).toBe('task-123');expect(result.notification).toMatchObject({status:'not_sent'});
 expect(deps.cli).toHaveBeenCalledTimes(1);
});


