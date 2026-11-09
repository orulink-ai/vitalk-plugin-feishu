import {describe,expect,it,vi} from 'vitest';
import {createVoiceOperationWorkflow} from './voice-operation-service';

const operationId='a9dd64a6-4de5-4cc9-81d1-d09330a34872';
const owner='ou_owner';
const task={id:'0e39bb15-dc71-48a7-9006-5f44590dd031',title:'核对资料',description:'带电脑',completed:false,url:'https://applink.feishu.cn/client/todo/detail'};
const other={...task,id:'ff4c06f8-9017-405c-aa4e-9f28f4697fb4',title:'确认报价'};
const event={id:'evt_0',title:'项目例会',description:'原议程',start:{timestamp:'1799996400'},end:{timestamp:'1799998200'},url:'https://applink.feishu.cn/calendar/event',editable:true};
const referenceTime='2027-01-14T08:00:00Z';
const taskInput={kind:'task' as const,prompt:'那个核对资料的活儿就算做完了',operationId,referenceTime};
const review={supported:true,unique:true,changesSupported:true};
function setup(...answers:Record<string,unknown>[]) {
  const model=vi.fn();
  answers.forEach(answer=>model.mockResolvedValueOnce(answer));
  const deps={
    model,
    tasks:vi.fn().mockResolvedValue({items:[other,task],accountId:owner,hasMore:false,nextPageToken:''}),
    calendar:vi.fn().mockResolvedValue({items:[event],accountId:owner,calendarId:'cal_1'}),
    eventForEdit:vi.fn().mockResolvedValue(event),
    editTask:vi.fn().mockResolvedValue({status:'updated',message:'飞书已确认任务修改。',task}),
    deleteTask:vi.fn().mockResolvedValue({status:'deleted',message:'飞书已确认删除任务。'}),
    completeTask:vi.fn().mockResolvedValue({status:'completed',message:'飞书已确认任务完成。'}),
    editEvent:vi.fn().mockResolvedValue({status:'eventUpdated',message:'飞书已确认日程修改。',event}),
    deleteEvent:vi.fn().mockResolvedValue({status:'deleted',message:'飞书已确认删除日程。'}),
  };
  return {deps,run:createVoiceOperationWorkflow(deps)};
}

describe('voice record operations',()=>{
  it('lets creation proceed without fetching records or writing a mutation',async()=>{
    const {deps,run}=setup({action:'create'});
    await expect(run(taskInput)).resolves.toEqual({kind:'create'});
    expect(deps.tasks).not.toHaveBeenCalled();
    expect(deps.completeTask).not.toHaveBeenCalled();
  });

  it('completes only the selected current account task from a colloquial instruction',async()=>{
    const {deps,run}=setup({action:'complete',targetEvidence:'核对资料'},{candidateIndices:[1]},review);
    await expect(run(taskInput)).resolves.toMatchObject({kind:'result',title:'任务已完成'});
    expect(deps.completeTask).toHaveBeenCalledWith({id:task.id,accountId:owner},undefined);
    expect(deps.deleteTask).not.toHaveBeenCalled();
  });

  it.each([{indices:[0,1]},{indices:[88]}])('rejects ambiguous or fabricated model candidate indices %j',async ({indices})=>{
    const {deps,run}=setup({action:'delete',targetEvidence:'核对资料'},{candidateIndices:indices},review);
    await expect(run({...taskInput,prompt:'核对资料那条不用留了'})).rejects.toThrow(/唯一/);
    expect(deps.deleteTask).not.toHaveBeenCalled();
  });

  it('requires a separate positive review before deleting a calendar event',async()=>{
    const prompt='明天的项目例会取消掉';
    const {deps,run}=setup({action:'delete',targetEvidence:'项目例会',dateEvidence:'明天',startDate:'2027-01-15',endDate:'2027-01-15'},
      {candidateIndices:[0]},{...review,unique:false});
    await expect(run({kind:'calendar',prompt,operationId,referenceTime})).rejects.toThrow(/核对/);
    expect(deps.deleteEvent).not.toHaveBeenCalled();
  });

  it('edits only the requested event field and keeps the independently loaded description and dates',async()=>{
    const prompt='明天的项目例会名字换成项目进展同步';
    const {deps,run}=setup({action:'edit',targetEvidence:'项目例会',dateEvidence:'明天',startDate:'2027-01-15',endDate:'2027-01-15'},
      {candidateIndices:[0],changes:{title:'项目进展同步'}},review);
    await expect(run({kind:'calendar',prompt,operationId,referenceTime})).resolves.toMatchObject({kind:'result',title:'日程已修改'});
    expect(deps.editEvent).toHaveBeenCalledWith(expect.objectContaining({
      id:event.id,calendarId:'cal_1',accountId:owner,title:'项目进展同步',description:event.description,start:event.start,end:event.end,expected:event,
    }),undefined);
  });

  it('stops before writing if the voice request is cancelled during the semantic review',async()=>{
    const controller=new AbortController();
    const {deps,run}=setup({action:'complete',targetEvidence:'核对资料'},{candidateIndices:[1]});
    deps.model.mockImplementationOnce(async()=>{controller.abort();return review;});
    await expect(run({...taskInput,signal:controller.signal})).rejects.toThrow();
    expect(deps.completeTask).not.toHaveBeenCalled();
  });
});

it('refuses to act on task candidates when a later page belongs to a different account',async()=>{
  const {deps,run}=setup({action:'delete',targetEvidence:'核对资料'},{candidateIndices:[0]},review);
  deps.tasks.mockResolvedValueOnce({items:[task],accountId:owner,hasMore:true,nextPageToken:'later'});
  deps.tasks.mockResolvedValueOnce({items:[other],accountId:'ou_other',hasMore:false,nextPageToken:''});
  await expect(run({...taskInput,prompt:'核对资料那条不用留了'})).rejects.toThrow(/账号已变化/);
  expect(deps.deleteTask).not.toHaveBeenCalled();
  expect(deps.model).toHaveBeenCalledTimes(1);
});

it('keeps a recurring calendar result out of the deletion service even with positive model review',async()=>{
  const {deps,run}=setup({action:'delete',targetEvidence:'项目例会',dateEvidence:'明天',startDate:'2027-01-15',endDate:'2027-01-15'},
    {candidateIndices:[0]},review);
  deps.calendar.mockResolvedValue({items:[{...event,editable:false}],accountId:owner,calendarId:'cal_1'});
  await expect(run({kind:'calendar',prompt:'明天的项目例会取消掉',operationId,referenceTime})).rejects.toThrow(/重复日程/);
  expect(deps.deleteEvent).not.toHaveBeenCalled();
});

it('uses the selected calendar record and preserves an uncertain delete receipt',async()=>{
  const {deps,run}=setup({action:'delete',targetEvidence:'项目例会',dateEvidence:'明天',startDate:'2027-01-15',endDate:'2027-01-15'},
    {candidateIndices:[0]},review);
  deps.deleteEvent.mockResolvedValue({status:'uncertain',message:'请在飞书核对，本次操作不会再次提交。'});
  await expect(run({kind:'calendar',prompt:'明天的项目例会取消掉',operationId,referenceTime})).rejects.toThrow(/不会再次提交/);
  expect(deps.deleteEvent).toHaveBeenCalledOnce();
  expect(deps.deleteEvent).toHaveBeenCalledWith({id:event.id,accountId:owner,calendarId:'cal_1'},undefined);
});

it.each(['task','calendar'] as const)('rejects model approval for indistinguishable %s records',async kind=>{
  const prompt=kind==='task'?'把核对资料那条删了':'取消明天的项目例会';
  const {deps,run}=setup(kind==='task'?{action:'delete',targetEvidence:'核对资料'}:
    {action:'delete',targetEvidence:'项目例会',dateEvidence:'明天',startDate:'2027-01-15',endDate:'2027-01-15'},
    {candidateIndices:[0]},review);
  deps.tasks.mockResolvedValue({items:[task,{...task,id:other.id}],accountId:owner,hasMore:false,nextPageToken:''});
  deps.calendar.mockResolvedValue({items:[event,{...event,id:'duplicate_0'}],accountId:owner,calendarId:'cal_1'});
  await expect(run({kind,prompt,operationId,referenceTime})).rejects.toThrow(/无法区分/);
  expect(deps.deleteTask).not.toHaveBeenCalled();
  expect(deps.deleteEvent).not.toHaveBeenCalled();
});
