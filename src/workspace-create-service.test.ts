// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {createElement} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {createWorkspaceItem} from './workspace-create-service';
import {WorkspaceCreateAction} from './original-workspace/WorkspaceCreateAction';

const {request,readAliases,appendHistory,readState}=vi.hoisted(()=>({request:vi.fn(),readAliases:vi.fn(),appendHistory:vi.fn(),readState:vi.fn()}));
vi.mock('./client',()=>({getClient:()=>({request}),getWorkspaceState:()=>({readAliases,appendHistory,read:readState}),openFeishuUrl:vi.fn(),feishu:vi.fn()}));
afterEach(cleanup);
const operationId='13bf963b-8419-41e0-9a83-83f1330c5799';
const eventTime={start:'2099-11-08T15:00:00+08:00',end:'2099-11-08T15:30:00+08:00'};
const scopes='task:task:write im:message.send_as_user calendar:calendar.calendar:readonly calendar:calendar.event:create calendar:calendar.event:update calendar:calendar.free_busy:read';
const status={is_resigned:false,is_exited:false,is_unjoin:false,is_frozen:false,is_activated:true};
const review={supported:true,complete:true,recipientSupported:true,timeSupported:true,scopeSupported:true};
const output=(body:unknown)=>({exitCode:0,stdout:JSON.stringify(body),stderr:''});

function fixture(plan:object,options:{storageFails?:boolean;unknownCreate?:boolean;lookup?:boolean;cancelAfterCreate?:AbortController}={}) {
  request.mockReset();
  readAliases.mockReset().mockResolvedValue([]);
  readState.mockReset().mockResolvedValue({accountId:'ou_self',catalog:{recipients:[]},entries:[]});
  appendHistory.mockReset().mockResolvedValue(undefined);
  let modelCalls=0;
  request.mockImplementation(async (method:string,params:{args?:string[]})=>{
    if(method==='ai.generate'){
      const input=JSON.parse((params as {messages?:{content:string}[]}).messages?.at(-1)?.content ?? '{}');
      if(input.purpose==='creationContactQueries')return {text:JSON.stringify({queries:options.lookup?[{query:'小冰',evidence:'小冰'}]:[]})};
      return {text:JSON.stringify(modelCalls++ ? review : plan)};
    }
    if(method==='storage.set'){expect((params as {key?:string}).key).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);return {ok:!options.storageFails};}
    if(method!=='native.execute')throw new Error(`Unexpected protocol ${method}`);
    const args=params.args ?? [];
    if(args[0]==='auth')return output({identities:{user:{openId:'ou_self',status:'ready',tokenStatus:'valid',scope:scopes}}});
    let data:unknown;
    switch(args[1]){
      case '+chat-list': data={chats:options.lookup?[]:[{chat_mode:'p2p',p2p_target_type:'user',p2p_target_id:'ou_ice',name:'小冰'},{chat_mode:'group',chat_id:'oc_team',name:'团队'}],has_more:false}; break;
      case '+search-user': data={users:[{open_id:'ou_ice',name:'小冰',status,is_external:false}],has_more:false}; break;
      case 'GET': data={items:[{open_id:'ou_ice',name:'小冰',status}]}; break;
      case '+create':
        if(options.unknownCreate)throw new Error('创建结果未知');
        data={guid:'task-123'}; options.cancelAfterCreate?.abort(); break;
      case '+messages-send': data={message_id:'om_sent'}; break;
      case 'calendars': data={calendars:[{calendar:{calendar_id:'cal_primary',role:'owner'}}]}; break;
      case 'freebusys': data={freebusy_list:[]}; break;
      case 'events': data={event:{event_id:'event_1',app_link:'https://applink.feishu.cn/calendar/event'}}; options.cancelAfterCreate?.abort(); break;
      case 'event.attendees': data={attendees:[]}; break;
      default: throw new Error(`Unexpected argv ${args.join(' ')}`);
    }
    return output({ok:true,data});
  });
}

const task={action:'create',assigneeId:'ou_ice',summary:'核对资料',description:'带电脑',due:'2026-11-13'};
it.each([false,true])('excludes cached synthetic self from all-contact tasks even when its profile is verified: %s',async(verifiedSelf)=>{
 fixture({...task,assigneeScope:'allContacts',scopeEvidence:'所有联系人'});
 readState.mockResolvedValue({accountId:'ou_self',catalog:{recipients:[{id:'ou_self',name:'本人',kind:'person',isContact:false}]},entries:[]});
 const original=request.getMockImplementation()!;
 request.mockImplementation(async(...args:unknown[])=>{
  const argv=args[0]==='native.execute'?(args[1] as {args:string[]}).args:[];
  if(argv[0]==='api')return output({ok:true,data:{items:[{open_id:'ou_ice',name:'小冰',status},...(verifiedSelf?[{open_id:'ou_self',name:'本人',status}]:[])]}});
  if(argv[1]==='+search-user')return output({ok:true,data:{users:[],has_more:false}});
  return original(...args);
 });
 await createWorkspaceItem({kind:'task',prompt:'给所有联系人建任务核对资料',operationId});
 const argv=nativeCalls().find(c=>c.args[1]==='+create')!.args;
 expect(JSON.parse(argv[argv.indexOf('--data')+1]).members.map((p:any)=>p.id)).toEqual(['ou_ice']);
});
it('does not add a name-search-only directory hit to the all-contact task set',async()=>{
 fixture({...task,assigneeScope:'allContacts',scopeEvidence:'所有联系人'},{lookup:true});
 const original=request.getMockImplementation()!;request.mockImplementation(async(...args:unknown[])=>{
  const argv=args[0]==='native.execute'?(args[1] as {args:string[]}).args:[];
  if(argv[1]==='+chat-list')return output({ok:true,data:{chats:[{chat_mode:'p2p',p2p_target_type:'user',p2p_target_id:'ou_contact',name:'实际联系人'}],has_more:false}});
  if(argv[0]==='api')return output({ok:true,data:{items:JSON.parse(argv[argv.indexOf('--params')+1]).user_ids.map((id:string)=>({open_id:id,name:'实际联系人',status}))}});
  return original(...args);
 });
 await createWorkspaceItem({kind:'task',prompt:'给所有联系人建任务，内容是联系小冰核对资料',operationId});
 const argv=nativeCalls().find(c=>c.args[1]==='+create')!.args;
 expect(JSON.parse(argv[argv.indexOf('--data')+1]).members.map((p:any)=>p.id)).toEqual(['ou_contact']);
});
it('never turns an unavailable all-contact directory into a task for fallback self',async()=>{
 fixture({...task,assigneeScope:'allContacts',scopeEvidence:'所有联系人'});
 const original=request.getMockImplementation()!;request.mockImplementation(async(...args:unknown[])=>{
  if(args[0]==='native.execute'&&(args[1] as {args:string[]}).args[1]==='+chat-list')throw Error('directory unavailable');
  return original(...args);
 });
 await expect(createWorkspaceItem({kind:'task',prompt:'给所有联系人建任务核对资料',operationId})).rejects.toThrow(/个人联系人|全部/);
 expect(nativeCalls().some(c=>c.args[1]==='+create')).toBe(false);
});
it('publishes and records a confirmed task before the card sender finishes',async()=>{
 fixture(task);const original=request.getMockImplementation()!;let finish!:(value:unknown)=>void;
 request.mockImplementation(async(...args:unknown[])=>{
  if(args[0]==='native.execute'&&(args[1] as {args:string[]}).args[1]==='+messages-send')return new Promise(resolve=>{finish=resolve;});
  return original(...args);
 });
 const confirmed=vi.fn();const work=createWorkspaceItem({kind:'task',prompt:'让小冰带电脑找我',operationId,onConfirmed:confirmed});
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({receipt:expect.objectContaining({guid:'task-123'})}));
 expect(appendHistory).toHaveBeenCalledWith(expect.objectContaining({id:operationId,command:expect.objectContaining({task:expect.objectContaining({guid:'task-123'})})}),'ou_self');
 finish(output({ok:true,data:{message_id:'om_sent'}}));await work;
 expect(nativeCalls().filter(call=>call.args[1]==='+create')).toHaveLength(1);
});

it('does not create after recording cancellation during model generation',async()=>{
  fixture(task);
  const original=request.getMockImplementation()!;
  const controller=new AbortController();
  request.mockImplementation(async(...args:unknown[])=>{
    const result=await original(...args);
    if(args[0]==='ai.generate')controller.abort();
    return result;
  });
  await expect(createWorkspaceItem({kind:'task',prompt:'让小冰带电脑找我',operationId,signal:controller.signal})).rejects.toThrow();
  expect(request.mock.calls.some(([method,p])=>method==='native.execute'&&p.args[1]==='+create')).toBe(false);
});
const calendar={action:'create',participantScope:'named',participantIds:['ou_ice'],scopeEvidence:'',summary:'核对资料',description:'',allowConflict:false,...eventTime};
it('publishes and records a confirmed calendar before waiting for invitations',async()=>{
 fixture(calendar);const original=request.getMockImplementation()!;let finish!:(value:unknown)=>void;
 request.mockImplementation(async(...args:unknown[])=>{
  if(args[0]==='native.execute'&&(args[1] as {args:string[]}).args[1]==='event.attendees')return new Promise(resolve=>{finish=resolve;});
  return original(...args);
 });
 const confirmed=vi.fn();const work=createWorkspaceItem({kind:'calendar',prompt:'2099年11月8日下午三点和小冰核对资料半小时',operationId,onConfirmed:confirmed});
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({receipt:expect.objectContaining({eventId:'event_1',invitationStatus:'pending'}),plan:expect.objectContaining({participantQueries:['小冰']})}));
 expect(appendHistory).toHaveBeenCalledWith(expect.objectContaining({id:operationId,command:expect.objectContaining({meeting:expect.objectContaining({eventId:'event_1'})})}),'ou_self');
 finish(output({ok:true,data:{attendees:[]}}));await work;
 expect(nativeCalls().filter(call=>call.args[1]==='events'&&call.args[2]==='create')).toHaveLength(1);
});
const nativeCalls=()=>request.mock.calls.filter(([method])=>method==='native.execute').map(([,params])=>params);

it('runs the actual task entry via generic SDK methods and persists the confirmed task before sharing its card',async()=>{
  fixture(task);
  const result=await createWorkspaceItem({kind:'task',prompt:'周五前让小冰带电脑核对资料',operationId});
  expect(result).toMatchObject({receipt:{guid:'task-123',notification:expect.stringContaining('分享任务卡片')},plan:{summary:'核对资料',description:'带电脑',recipientQuery:'小冰',due:'2026-11-13'}});
  const methods=request.mock.calls.map(([method])=>method);
  expect([...new Set(methods)].sort()).toEqual(['ai.generate','native.execute','storage.set']);
  const share=request.mock.calls.findIndex(([method,params])=>method==='native.execute'&&params.args[1]==='+messages-send');
  expect(share).toBeGreaterThan(methods.indexOf('storage.set'));
  expect(nativeCalls().find(call=>call.args[1]==='+create').operationId).toBe(operationId);
  expect(new Set(nativeCalls().map(call=>call.operationId)).size).toBe(nativeCalls().length);
});

it('runs the actual calendar entry via generic SDK methods and keeps an event when invitations are unconfirmed',async()=>{
  fixture(calendar);
  const result=await createWorkspaceItem({kind:'calendar',prompt:'2099年11月8日下午三点和小冰核对资料半小时',operationId});
  expect(result).toMatchObject({receipt:{eventId:'event_1',status:'partial',invitationStatus:'unconfirmed'},plan:{participantQueries:['小冰']}});
  expect(request.mock.calls.some(([method])=>method==='feishu.request')).toBe(false);
  expect(nativeCalls().find(call=>call.args[1]==='events').operationId).toBe(`${operationId}:create`);
  expect(request).toHaveBeenCalledWith('storage.set',expect.objectContaining({value:expect.objectContaining({eventId:'event_1'})}));
});

it('preserves the task when storage fails and does not send its share card',async()=>{
  fixture(task,{storageFails:true});
  const result=await createWorkspaceItem({kind:'task',prompt:'让小冰带电脑核对资料',operationId});
  expect(result).toMatchObject({receipt:{guid:'task-123',notification:expect.stringContaining('保存失败')}});
  expect(nativeCalls().some(call=>call.args[1]==='+messages-send')).toBe(false);
});

it('does not repeat an unconfirmed task creation or send a card',async()=>{
  fixture(task,{unknownCreate:true});
  await expect(createWorkspaceItem({kind:'task',prompt:'让小冰带电脑核对资料',operationId})).rejects.toThrow('结果未知');
  expect(nativeCalls().filter(call=>call.args[1]==='+create')).toHaveLength(1);
  expect(nativeCalls().some(call=>call.args[1]==='+messages-send')).toBe(false);
});

it('routes the workspace creation button through the generic SDK to a real service result',async()=>{
  fixture(task);
  render(createElement(WorkspaceCreateAction,{kind:'task'}));
  fireEvent.click(screen.getByRole('button',{name:'创建任务'}));
  fireEvent.change(screen.getByRole('textbox',{name:'任务要求'}),{target:{value:'让小冰带电脑核对资料'}});
  fireEvent.click(screen.getByRole('button',{name:'创建任务'}));
  expect(await screen.findByText('任务已创建')).toBeTruthy();
  expect(await screen.findByText(/已向负责人分享任务卡片/)).toBeTruthy();
  expect(request.mock.calls.some(([method])=>method==='feishu.request')).toBe(false);
  expect(nativeCalls().filter(call=>call.args[0]==='task'&&call.args[1]==='+create')).toHaveLength(1);
});

it('offers same-account contact aliases as model context and stores the actual task receipt',async()=>{
  fixture(task);
  readState.mockResolvedValue({accountId:'ou_self',catalog:{recipients:[]},entries:[{query:'冰冰',recipientId:'ou_ice'},{query:'过期别名',recipientId:'ou_missing'}]});
  await createWorkspaceItem({kind:'task',prompt:'让冰冰带电脑核对资料',operationId});
  const requestBody=request.mock.calls.find(([method,params])=>method==='ai.generate'&&JSON.parse(params.messages.at(-1).content).people)?.[1];
  const modelInput=JSON.parse(requestBody.messages.find((message:{role:string})=>message.role==='user').content);
  expect(modelInput.people).toEqual(expect.arrayContaining([expect.objectContaining({id:'ou_ice',aliases:expect.arrayContaining(['冰冰'])})]));
  expect(JSON.stringify(requestBody)).not.toContain('过期别名');
  expect(readAliases).not.toHaveBeenCalled();
  expect(appendHistory).toHaveBeenCalledWith(expect.objectContaining({
    id:operationId,status:'completed',command:{destination:'feishuTask',task:expect.objectContaining({guid:'task-123',assignee:'小冰'})},
  }),'ou_self');
});

it('keeps a real event receipt when writing the execution history fails',async()=>{
  fixture(calendar);
  appendHistory.mockRejectedValue(new Error('storage unavailable'));
  const result=await createWorkspaceItem({kind:'calendar',prompt:'2099年11月8日下午三点和小冰核对资料半小时',operationId});
  expect(appendHistory).toHaveBeenCalledWith(expect.objectContaining({
    id:operationId,status:'completed',command:{destination:'feishuMeeting',meeting:expect.objectContaining({
      calendarId:'cal_primary',eventId:'event_1',participants:['小冰'],
    })},
  }),'ou_self');
  expect(result).toMatchObject({receipt:{eventId:'event_1',notification:expect.stringContaining('执行记录保存失败')}});
  expect(nativeCalls().filter(call=>call.args[1]==='events'&&call.args[2]==='create')).toHaveLength(1);
});

it.each(['task','calendar'] as const)('resolves a visible %s contact with no previous private chat',async kind=>{
  fixture(kind==='task'?task:calendar,{lookup:true});
  const result=await createWorkspaceItem({kind,prompt:kind==='task'?'让小冰带电脑核对资料':'2099年11月8日下午三点和小冰核对资料半小时',operationId});
  expect(nativeCalls().find(call=>call.args[1]==='+search-user')?.args).toContain('小冰');
  if(kind==='task')expect(result.plan).toMatchObject({recipientQuery:'小冰'});
  else expect(result.plan).toMatchObject({participantQueries:['小冰']});
});

it.each(['task','calendar'] as const)('keeps confirmed %s receipts and history after voice cancellation without further remote writes',async kind=>{
  const controller=new AbortController();
  fixture(kind==='task'?task:calendar,{cancelAfterCreate:controller});
  const result=await createWorkspaceItem({kind,prompt:kind==='task'?'让小冰带电脑核对资料':'2099年11月8日下午三点和小冰核对资料半小时',operationId,signal:controller.signal});
  expect(controller.signal.aborted).toBe(true);
  const key=kind==='task'?'guid':'eventId';
  const id=kind==='task'?'task-123':'event_1';
  expect(result.receipt).toMatchObject({[key]:id});
  expect(request).toHaveBeenCalledWith('storage.set',expect.objectContaining({value:expect.objectContaining({[key]:id})}));
  expect(appendHistory).toHaveBeenCalledWith(expect.objectContaining({
    id:operationId,command:expect.objectContaining({[kind==='task'?'task':'meeting']:expect.objectContaining({[key]:id})}),
  }),'ou_self');
  expect(nativeCalls().some(call=>['event.attendees','+messages-send'].includes(call.args[1]))).toBe(false);
});

it.each(['task','calendar'] as const)('queries only people and does not read group details when creating a %s',async kind=>{
  fixture(kind==='task'?task:calendar);
  await createWorkspaceItem({kind,prompt:kind==='task'?'让小冰带电脑核对资料':'2099年11月8日下午三点和小冰核对资料半小时',operationId});
  const chatList=nativeCalls().find(call=>call.args[1]==='+chat-list')?.args;
  expect(chatList?.[chatList.indexOf('--types')+1]).toBe('p2p');
  expect(nativeCalls().some(call=>call.args[0]==='im'&&call.args[1]==='chats'&&call.args[2]==='get')).toBe(false);
  expect(nativeCalls().some(call=>call.args.includes('/open-apis/contact/v3/users/batch'))).toBe(true);
});
it('persists calendar card delivery uncertainty alongside confirmed invitation results',async()=>{
 fixture(calendar);const original=request.getMockImplementation()!;
 request.mockImplementation(async(...args:unknown[])=>{
  const argv=(args[1] as {args?:string[]})?.args;
  if(args[0]==='native.execute'&&argv?.[1]==='events')return output({ok:true,data:{event:{event_id:'event_1',app_link:'https://applink.feishu.cn/client/calendar/event/detail?event_id=event_1'}}});
  if(args[0]==='native.execute'&&argv?.[1]==='event.attendees')return output({ok:true,data:{attendees:[{type:'user',user_id:'ou_ice'}]}});
  if(args[0]==='native.execute'&&argv?.[1]==='+messages-send')throw Error('transport disconnected');
  return original(...args);
 });
 const refreshed=vi.fn();window.addEventListener('feishu-workspace-changed',refreshed);
 try{
  const result=await createWorkspaceItem({kind:'calendar',prompt:'2099年11月8日下午三点和小冰核对资料半小时',operationId});
  expect(result.receipt.notification).toBeTruthy();
  expect(appendHistory.mock.calls.at(-1)?.[0].command.meeting.invitation).toContain(result.receipt.notification);
  expect(refreshed).toHaveBeenCalled();
  expect(nativeCalls().filter(call=>call.args[1]==='+messages-send')).toHaveLength(1);
 }finally{window.removeEventListener('feishu-workspace-changed',refreshed);}
});


it('starts contact enumeration while the independent name-query model is pending',async()=>{
 fixture(task);const original=request.getMockImplementation()!;let finish!:(value:unknown)=>void;
 request.mockImplementation(async(...args:unknown[])=>{
  if(args[0]==='ai.generate'&&JSON.parse((args[1] as any).messages.at(-1).content).purpose==='creationContactQueries')return new Promise(resolve=>{finish=resolve;});
  return original(...args);
 });
 const work=createWorkspaceItem({kind:'task',prompt:'让小冰核对资料',operationId});
 await vi.waitFor(()=>expect(nativeCalls().some(c=>c.args[1]==='+chat-list')).toBe(true));
 finish({text:'{"queries":[]}'});await work;
});

it('limits independent name searches to two CLI workers',async()=>{
 fixture(task);const original=request.getMockImplementation()!;const releases:(()=>void)[]=[];
 request.mockImplementation(async(...args:unknown[])=>{
  if(args[0]==='ai.generate'&&JSON.parse((args[1] as any).messages.at(-1).content).purpose==='creationContactQueries')return {text:JSON.stringify({queries:['甲','乙','丙'].map(query=>({query,evidence:query}))})};
  if(args[0]==='native.execute'&&(args[1] as any).args.includes('--query'))await new Promise<void>(resolve=>releases.push(resolve));
  return original(...args);
 });
 const work=createWorkspaceItem({kind:'task',prompt:'让甲乙丙核对资料',operationId});
 await vi.waitFor(()=>expect(releases.length).toBeGreaterThanOrEqual(2));
 const firstWave=releases.length;releases.splice(0).forEach(release=>release());
 await vi.waitFor(()=>expect(releases.length).toBe(1));releases.splice(0).forEach(release=>release());await work;
 expect(firstWave).toBe(2);
});
