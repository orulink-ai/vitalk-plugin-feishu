import {expect,it,vi} from 'vitest';
import {prepareTask, type Person} from './task-intent';
const people:Person[]=[{id:'ou_ice',name:'阳晓冰',aliases:['小冰'],active:true,external:false}];
const plan={action:'create',assigneeId:'ou_ice',summary:'带上电脑来找我',description:'',due:null};
const approved={supported:true,complete:true,recipientSupported:true,timeSupported:true};
it('all people resolves all verified individual contacts into one shared task',async()=>{
 const model=vi.fn().mockResolvedValueOnce({action:'create',assigneeScope:'allContacts',scopeEvidence:'所有联系人',summary:'等会找我',description:'',due:null}).mockResolvedValueOnce(approved);
 const result=await prepareTask('给所有联系人创建一个任务，让他们等会找我',[...people,{...people[0],id:'ou_second',name:'同事'}, {...people[0],id:'ou_left',active:false}],'2026-11-11T10:00:00+08:00',model);
 expect(result).toMatchObject({assigneeIds:['ou_ice','ou_second'],assigneeScope:'allContacts',due:null});
});
it.each(['让小冰带着电脑找我。','给小冰创一个任务，让他等会来找我，顺便带上电脑。'])('interprets free speech without task markers: %s',async source=>{
  const model=vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(approved);
  expect(await prepareTask(source,people,'2026-11-07T10:00:00+08:00',model)).toEqual(plan);
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[0][0]).toMatchObject({source,mode:'task',people});
});
it('passes aliases as model context and excludes departed/external contacts',async()=>{
  const model=vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(approved);
  await prepareTask('让小冰带电脑过来', [...people,{id:'ou_left',name:'离职',aliases:[],active:false,external:false},{id:'ou_external',name:'外部',aliases:[],active:true,external:true}], '2026-11-07T10:00:00+08:00',model);
  expect(model.mock.calls[0][0].people).toEqual(people);
});
it.each(['ou_left','ou_invented'])('rejects unsupported person %s before further model work',async assigneeId=>{
  const model=vi.fn().mockResolvedValue({...plan,assigneeId});
  await expect(prepareTask('给小冰任务',people,'2026-11-07T10:00:00+08:00',model)).rejects.toThrow('负责人');
  expect(model).toHaveBeenCalledTimes(1);
});
it.each(['cancel','update','clarify'])('does not create for %s intent',async action=>{
  const model=vi.fn().mockResolvedValue({...plan,action});
  await expect(prepareTask('不用创建了',people,'2026-11-07T10:00:00+08:00',model)).rejects.toThrow('创建');
});
it.each(['supported','complete','recipientSupported','timeSupported'])('does not accept failed semantic check %s',async flag=>{
  const model=vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce({...approved,[flag]:false});
  await expect(prepareTask('带电脑，顺便拿充电器，不能买新的',people,'2026-11-07T10:00:00+08:00',model)).rejects.toThrow('语义');
});
it('rejects invented or invalid deadlines rather than substituting a default',async()=>{
  const model=vi.fn().mockResolvedValue({...plan,due:'2026-02-30'});
  await expect(prepareTask('带电脑来',people,'2026-11-07T10:00:00+08:00',model)).rejects.toThrow('日期');
});
