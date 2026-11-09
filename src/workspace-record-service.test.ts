import {expect,it,vi} from 'vitest';
import {experimentsRequest} from './experiments/client';
import {editWorkspaceEvent,deleteWorkspaceEvent,deleteWorkspaceTask,editWorkspaceTask,searchWorkspaceContacts,syncWorkspaceContacts} from './workspace-record-service';

const {request,legacy}=vi.hoisted(()=>({request:vi.fn(),legacy:vi.fn()}));
vi.mock('./client',()=>({getClient:()=>({request}),feishu:legacy}));
const owner='ou_owner';
const id='13bf963b-8419-41e0-9a83-83f1330c5799';
const output=(body:unknown)=>({exitCode:0,stdout:JSON.stringify(body),stderr:''});
const status={is_resigned:false,is_exited:false,is_unjoin:false,is_frozen:false,is_activated:true};
function fixture(run:(args:string[])=>unknown,accounts=[owner]) {
  request.mockReset();legacy.mockReset();
  let checks=0;
  request.mockImplementation(async(method,params)=>{
    expect(method).toBe('native.execute');
    expect(params.dependencyId).toBe('lark-cli');
    if(params.args[0]==='auth')return output({identities:{user:{openId:accounts[Math.min(checks++,accounts.length-1)],status:'ready',tokenStatus:'valid',scope:'task:task:write calendar:calendar:readonly calendar:calendar.event:read calendar:calendar.event:delete calendar:calendar.event:update'}}});
    const data=await run(params.args);
    if(data && typeof data === "object" && "nativeFailure" in data) return data.nativeFailure;
    return output({ok:true,data});
  });
}

it('routes the task list through generic CLI and preserves pagination and owners',async()=>{
  fixture(args=>{
    expect(args.slice(0,3)).toEqual(['task','tasks','list']);
    expect(JSON.parse(args[4])).toEqual({type:'my_tasks',page_size:50,user_id_type:'open_id',completed:false,page_token:'page-1'});
    return {items:[{guid:id,summary:'核对资料',members:[{role:'assignee',id:'ou_a'},{role:'assignee',id:'ou_b'}],due:{timestamp:123,is_all_day:true}}],has_more:true,page_token:'page-2'};
  });
  const result=await experimentsRequest({action:'feishuTaskList',completed:false,pageToken:'page-1'});
  expect(result).toMatchObject({accountId:owner,hasMore:true,nextPageToken:'page-2',items:[{id,title:'核对资料',ownerId:'ou_a',ownerIds:['ou_a','ou_b'],dueTimestamp:'123',dueIsAllDay:true,completed:false}]});
  expect(legacy).not.toHaveBeenCalled();
});

it('discards task data if the current account changes during the read',async()=>{
  fixture(()=>({items:[],has_more:false}),[owner,'ou_other']);
  await expect(experimentsRequest({action:'feishuTaskList'})).rejects.toThrow(/账号已变化/);
});

it('submits completion once using an account-scoped identity and verifies the same task by readback',async()=>{
  const calls:string[][]=[];
  fixture(args=>{calls.push(args);return args[1]==='+complete'?{}:{task:{guid:id,updated_at:'100',completed_at:calls.length===1?'0':'1'}};});
  await expect(experimentsRequest({action:'feishuTaskComplete',accountId:owner,id})).resolves.toMatchObject({status:'completed'});
  expect(calls.map(args=>args.slice(0,3))).toEqual([['task','tasks','get'],['task','+complete','--task-id'],['task','tasks','get']]);
  expect(request.mock.calls.find(([,params])=>params.args[1]==='+complete')?.[1].operationId).toMatch(/^task-complete:[a-f0-9]{64}$/);
  expect(legacy).not.toHaveBeenCalled();
});

it('keeps a missing completion receipt uncertain without repeating the mutation',async()=>{
  fixture(args=>{if(args[1]==='+complete')throw new Error('timeout');return {task:{guid:id,updated_at:'100',completed_at:'0'}};});
  await expect(experimentsRequest({action:'feishuTaskComplete',accountId:owner,id})).resolves.toMatchObject({status:'uncertain'});
  expect(request.mock.calls.filter(([,params])=>params.args[1]==='+complete')).toHaveLength(1);
  expect(request.mock.calls.filter(([,params])=>params.args[2]==='get')).toHaveLength(1);
});

it('rejects a malformed task identifier before querying the account',async()=>{
  fixture(()=>({}));
  await expect(experimentsRequest({action:'feishuTaskComplete',accountId:owner,id:`${id}\n`})).rejects.toThrow(/任务标识无效/);
  expect(request).not.toHaveBeenCalled();
});

it('reads the confirmed primary calendar over the generic CLI and omits cancelled entries',async()=>{
  fixture(args=>{
    if(args[1]==='calendars')return {calendars:[{calendar:{calendar_id:'cal_1'}}]};
    expect(args.slice(0,7)).toEqual(['calendar','events','instance_view','--calendar-id','cal_1','--start-time','100']);
    return {items:[{status:'cancelled'},{event_id:'event_1',summary:'讨论',start_time:{timestamp:'110'},end_time:{timestamp:'120'},app_link:'https://evil.invalid'}]};
  });
  await expect(experimentsRequest({action:'feishuCalendarList',start:100,end:200})).resolves.toMatchObject({accountId:owner,calendarId:'cal_1',items:[{id:'event_1',title:'讨论',url:''}]});
  expect(legacy).not.toHaveBeenCalled();
});

it('provides generic search and sync DTOs without claiming full directory coverage',async()=>{
  fixture(args=>{
    if(args[1]==='+search-user')return {users:[{open_id:'ou_a',name:'小冰',status,is_external:false}],has_more:false};
    if(args[1]==='+chat-list')return {chats:[{chat_id:'oc_group',chat_mode:'group',name:'项目组'}],has_more:false};
    return {items:[{open_id:'ou_a',name:'小冰',status}]};
  });
  await expect(searchWorkspaceContacts('小冰')).resolves.toMatchObject({searchQuery:'小冰',partial:true,recipients:[{id:'ou_a',name:'小冰',kind:'person'}]});
  await expect(syncWorkspaceContacts()).resolves.toMatchObject({partial:true,recipients:[{id:'oc_group',name:'项目组',kind:'group'}]});
  const ids=request.mock.calls.map(([,params])=>params.operationId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(legacy).not.toHaveBeenCalled();
});

function apiFailure(code:number) {
  return {nativeFailure:{exitCode:1,stdout:'',stderr:JSON.stringify({ok:false,identity:'user',error:{type:'api',code}})}};
}

it('reads the selected task before and after patching its title and clearing its description',async()=>{
  const calls:string[]=[];
  fixture(args=>{
    calls.push(args[2]);
    if(args[2]==='patch'){
      expect(JSON.parse(args[args.indexOf('--data')+1])).toEqual({task:{summary:'新标题',description:''},update_fields:['summary','description']});
      return {};
    }
    return {task:{guid:id,summary:calls.length===1?'旧标题':'新标题',description:calls.length===1?'旧说明':'',updated_at:'1'}};
  });
  await expect(editWorkspaceTask({id,accountId:owner,title:'新标题',description:''})).resolves.toMatchObject({status:'updated',task:{id,title:'新标题',description:''}});
  expect(calls).toEqual(['get','patch','get']);
});

it('requires an explicit resource absence receipt after deleting the selected task',async()=>{
  let deleted=false;
  fixture(args=>{
    expect(args[args.indexOf('--task-guid')+1]).toBe(id);
    if(args[2]==='delete'){deleted=true;expect(args).toContain('--yes');return {};}
    return deleted?apiFailure(1470404):{task:{guid:id}};
  });
  await expect(deleteWorkspaceTask({id,accountId:owner})).resolves.toMatchObject({status:'deleted'});
});

it('requires a one-time event and confirms absence without repeating a mutation on uncertainty',async()=>{
  const calendarId='cal_1', eventId='event_0';
  let attempts=0;
  fixture(args=>{
    if(args[1]==='calendars')return {calendars:[{calendar:{calendar_id:calendarId}}]};
    if(args[1]==='+delete'){attempts++;throw new Error('timeout');}
    return {event:{event_id:eventId,status:'confirmed',recurrence:''}};
  });
  await expect(deleteWorkspaceEvent({id:eventId,accountId:owner,calendarId})).resolves.toMatchObject({status:'uncertain'});
  await expect(deleteWorkspaceEvent({id:eventId,accountId:owner,calendarId})).resolves.toMatchObject({status:'uncertain'});
  expect(attempts).toBe(1);
});

it('refuses to delete an event that is a recurring master',async()=>{
  fixture(args=>args[1]==='calendars'?{calendars:[{calendar:{calendar_id:'cal_1'}}]}:{event:{event_id:'recurring_0',recurrence:'FREQ=WEEKLY'}});
  await expect(deleteWorkspaceEvent({id:'recurring_0',accountId:owner,calendarId:'cal_1'})).rejects.toThrow(/重复日程/);
  expect(request.mock.calls.some(([,p])=>p.args[1]==='+delete')).toBe(false);
});

it.each([193001,193003,193002])("classifies calendar deletion readback code %s",async code=>{
  const calendarId='cal_1',eventId='calendar_readback_'+code+'_0';
  let deleted=false;
  fixture(args=>{
    if(args[1]==='calendars')return {calendars:[{calendar:{calendar_id:calendarId}}]};
    expect(args[args.indexOf('--event-id')+1]).toBe(eventId);
    if(args[1]==='+delete'){
      expect(args).toContain('--yes');
      expect(args).not.toContain('--apply-to');
      deleted=true;
      return {};
    }
    return deleted?apiFailure(code):{event:{event_id:eventId,status:'confirmed',recurrence:''}};
  });
  await expect(deleteWorkspaceEvent({id:eventId,accountId:owner,calendarId})).resolves.toMatchObject({
    status:code===193002?'uncertain':'deleted',
  });
});

it('does not submit the edit if the readback preflight returns the wrong task',async()=>{
  fixture(()=>({task:{guid:'00000000-0000-4000-8000-000000000002'}}));
  await expect(editWorkspaceTask({id,accountId:owner,title:'新标题',description:''})).rejects.toThrow(/其他任务/);
  expect(request.mock.calls.some(([,p])=>p.args[2]==='patch')).toBe(false);
});

it('patches only the selected event and verifies the saved fields from an independent read',async()=>{
  const id='edit_0',calendarId='cal_1';
  const start={timestamp:'1800000000'},end={timestamp:'1800003600'};
  const before={event_id:id,summary:'旧日程',description:'旧说明',start_time:{timestamp:'1700000000'},end_time:{timestamp:'1700003600'}};
  const writes:string[][]=[];
  fixture(args=>{
    if(args[1]==='calendars')return {calendars:[{calendar:{calendar_id:calendarId}}]};
    expect(args[args.indexOf('--event-id')+1]).toBe(id);
    if(args[2]==='patch'){
      writes.push(args);
      expect(JSON.parse(args[args.indexOf('--data')+1])).toMatchObject({
        summary:'新日程',description_rich:'',start_time:start,end_time:end,
      });
      return {};
    }
    return {event:writes.length?{...before,summary:'新日程',description:'',start_time:start,end_time:end}:before};
  });
  await expect(editWorkspaceEvent({id,accountId:owner,calendarId,title:'新日程',description:'',start,end})).resolves.toMatchObject({
    status:'eventUpdated',event:{id,title:'新日程',description:'',start,end},
  });
  expect(writes).toHaveLength(1);
});

it('keeps an unchanged calendar readback uncertain and does not submit the edit again',async()=>{
  const id='stale_edit_0',calendarId='cal_1';
  const start={date:'2026-11-08'},end={date:'2026-11-08'};
  let writes=0;
  fixture(args=>{
    if(args[1]==='calendars')return {calendars:[{calendar:{calendar_id:calendarId}}]};
    if(args[2]==='patch'){writes++;return {};}
    return {event:{event_id:id,summary:'旧标题',description:'',start_time:start,end_time:end}};
  });
  const input={id,accountId:owner,calendarId,title:'新标题',description:'',start,end};
  await expect(editWorkspaceEvent(input)).resolves.toMatchObject({status:'uncertain'});
  await expect(editWorkspaceEvent(input)).resolves.toMatchObject({status:'uncertain'});
  expect(writes).toBe(1);
});

it('rejects recurring calendar edits before issuing PATCH',async()=>{
  const id='weekly_edit_0',calendarId='cal_1';
  fixture(args=>args[1]==='calendars'
    ? {calendars:[{calendar:{calendar_id:calendarId}}]}
    : {event:{event_id:id,recurrence:'FREQ=WEEKLY'}});
  await expect(editWorkspaceEvent({
    id,accountId:owner,calendarId,title:'更改',description:'',start:{date:'2026-11-08'},end:{date:'2026-11-08'},
  })).rejects.toThrow(/重复日程/);
  expect(request.mock.calls.some(([,params])=>params.args[2]==='patch')).toBe(false);
});

it('rejects a changed event before overwriting the user’s edit baseline',async()=>{
  const id='conflict_edit_0',calendarId='cal_1';
  const start={date:'2026-11-08'},end={date:'2026-11-08'};
  fixture(args=>args[1]==='calendars'
    ? {calendars:[{calendar:{calendar_id:calendarId}}]}
    : {event:{event_id:id,summary:'别处已更改',start_time:start,end_time:end}});
  await expect(editWorkspaceEvent({
    id,accountId:owner,calendarId,title:'更改',description:'',start,end,
    expected:{title:'旧标题',description:'',start,end},
  })).rejects.toThrow(/已在飞书更新/);
  expect(request.mock.calls.some(([,params])=>params.args[2]==='patch')).toBe(false);
});

it('uses distinct completion identities after a remotely reopened task but deduplicates the same version',async()=>{
 let version='100';
 fixture(args=>args[1]==='+complete'?{}:{task:{guid:id,updated_at:version,completed_at:'0'}});
 for(const next of ['100','100','200']){version=next;await experimentsRequest({action:'feishuTaskComplete',accountId:owner,id});}
 const ids=request.mock.calls.filter(([,p])=>p.args[1]==='+complete').map(([,p])=>p.operationId);
 expect(ids).toHaveLength(3);expect(ids[0]).toBe(ids[1]);expect(ids[2]).not.toBe(ids[0]);
});
