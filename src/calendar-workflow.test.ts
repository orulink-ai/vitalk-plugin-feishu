import {expect,it,vi} from 'vitest';
import {runCalendarCreation} from './calendar-workflow';

const input={source:'明天下午三点帮我留半小时整理方案',operationId:'13bf963b-8419-41e0-9a83-83f1330c5799',referenceTime:'2026-11-07T10:00:00+08:00'};
const personal={action:'create',participantScope:'personal',participantIds:[],scopeEvidence:'',summary:'整理方案',description:'',start:'2026-11-08T15:00:00+08:00',end:'2026-11-08T15:30:00+08:00',allowConflict:false};
const review={supported:true,complete:true,recipientSupported:true,timeSupported:true,scopeSupported:true};
const scopes=['calendar:calendar.calendar:readonly','calendar:calendar.event:create','calendar:calendar.event:update','calendar:calendar.free_busy:read'];
const account={accountId:'ou_self',scopes};
const person=(id:string,active=true,external=false)=>({id,name:id,aliases:['小冰'],active,external});
const named={...personal,participantScope:'named',participantIds:['ou_ice']};
const company={...personal,participantScope:'allCurrentEmployees',scopeEvidence:'每位仍在我们公司工作的同事'};
const companyInput={...input,source:'明天下午三点和每位仍在我们公司工作的同事聊半小时方案'};
const status={is_resigned:false,is_exited:false,is_unjoin:false,is_frozen:false,is_activated:true};

it('shares cards only to receipt-confirmed attendees after calendar creation',async()=>{
  const deps=fixture(named);
  deps.readAccount.mockResolvedValue({...account,scopes:[...scopes,'im:message.send_as_user']});
  const original=deps.cli.getMockImplementation()!;
  deps.cli.mockImplementation(async args=>{
    if(args[0]==='im')return {message_id:'om_card'};
    const value=await original(args);
    if(args[1]==='events')value.event.app_link='https://applink.feishu.cn/client/calendar/event/detail?event=1';
    return value;
  });
  const result=await runCalendarCreation({...input,source:'明天下午三点跟小冰对齐半小时'},{...deps,shareCard:true});
  expect(result.notification).toMatchObject({status:'sent',sentRecipientIds:['ou_ice']});
  expect(deps.cli.mock.calls.at(-1)?.[0].slice(0,4)).toEqual(['im','+messages-send','--user-id','ou_ice']);
});

it('keeps a created invitation when card permissions are missing',async()=>{
  const deps=fixture(named);
  const original=deps.cli.getMockImplementation()!;
  deps.cli.mockImplementation(async args=>{
    const value=await original(args);
    if(args[1]==='events')value.event.app_link='https://applink.feishu.cn/client/calendar/event/detail?event=1';
    return value;
  });
  const result=await runCalendarCreation(input,{...deps,shareCard:true});
  expect(result.receipt).toMatchObject({status:'completed',invitationStatus:'sent'});
  expect(result.notification?.status).toBe('not_sent');
  expect(deps.cli.mock.calls.filter(([args])=>args[1]==='events')).toHaveLength(1);
  expect(deps.cli.mock.calls.some(([args])=>args[0]==='im')).toBe(false);
});

it('does not share cards for a personal calendar',async()=>{
  const deps=fixture();
  const result=await runCalendarCreation(input,{...deps,shareCard:true});
  expect(result.notification?.status).toBe('not_sent');
  expect(deps.cli.mock.calls.some(([args])=>args[0]==='im')).toBe(false);
});

function fixture(plan:unknown=personal, checked:unknown=review){
  return {
    readAccount:vi.fn().mockResolvedValue(account),
    readPeople:vi.fn().mockResolvedValue([person('ou_ice'),person('ou_resigned',false),person('ou_external',true,true)]),
    model:vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(checked),
    rosterRequest:vi.fn().mockImplementation(async ({endpoint})=>{
      if(endpoint.endsWith('/find_by_department'))return {ok:true,data:{has_more:false,items:['ou_self','ou_staff'].map(open_id=>({open_id,name:open_id,status}))}};
      return {ok:true,data:{has_more:false,items:[]}};
    }),
    cli:vi.fn().mockImplementation(async (args:string[])=>{
      if(args[1]==='calendars')return {calendars:[{calendar:{role:'owner',calendar_id:'cal_primary'}}]};
      if(args[1]==='freebusys')return {freebusy_list:[]};
      if(args[1]==='events')return {event:{event_id:'event_1'}};
      const data=JSON.parse(args[args.indexOf('--data')+1]);
      return {attendees:data.attendees};
    }),
  };
}

it('creates a personal calendar event directly from natural language',async()=>{
  const deps=fixture();
  const result=await runCalendarCreation(input,deps);
  expect(result.receipt).toMatchObject({eventId:'event_1',invitationStatus:'not_sent'});
  expect(deps.model.mock.calls[0][0]).toMatchObject({source:input.source,referenceTime:input.referenceTime,mode:'calendar'});
  expect(deps.model).toHaveBeenCalledTimes(2);
  expect(deps.rosterRequest).not.toHaveBeenCalled();
  expect(deps.cli.mock.calls.map(([args])=>args[1])).toEqual(['calendars','events']);
});

it('uses only eligible named contacts and passes their exact IDs to the invite service',async()=>{
  const deps=fixture(named);
  const result=await runCalendarCreation({...input,source:'明天下午三点跟小冰对齐半小时'},deps);
  expect(deps.model.mock.calls[0][0].people).toEqual([person('ou_ice')]);
  expect(result.receipt).toMatchObject({invitationStatus:'sent',participantCount:1});
  expect(deps.cli.mock.calls.at(-1)?.[0].join(' ')).toContain('ou_ice');
  expect(deps.rosterRequest).not.toHaveBeenCalled();
});

it('keeps all six explicitly named eligible attendees',async()=>{
  const ids=['ou_ice','ou_qiong','ou_yun','ou_li','ou_wang','ou_zhao'];
  const names=['小冰','小琼','小云','小李','小王','小赵'];
  const deps=fixture({...named,summary:'讨论方案',participantIds:ids});
  deps.readPeople.mockResolvedValue(ids.map((id,index)=>({...person(id),name:names[index],aliases:[]})));
  const result=await runCalendarCreation({...input,source:`明天下午三点和${names.join('、')}讨论半小时方案`},deps);
  expect(result.receipt).toMatchObject({invitationStatus:'sent',participantCount:6,invitedCount:6});
  const args=deps.cli.mock.calls.at(-1)?.[0];
  const invite=JSON.parse(args[args.indexOf('--data')+1]);
  expect(invite.attendees.map(({user_id}:{user_id:string})=>user_id).sort()).toEqual([...ids].sort());
});

it.each([[input,personal,'not_sent'],[companyInput,company,'sent']])('can use an independently confirmed scope when ordinary contacts cannot be read',async (request,plan,invitationStatus)=>{
  const deps=fixture(plan);
  deps.readPeople.mockRejectedValue(new Error('普通联系人不可用'));
  const result=await runCalendarCreation(request,deps);
  expect(deps.model.mock.calls[0][0].people).toEqual([]);
  expect(result.receipt.invitationStatus).toBe(invitationStatus);
});

it('stops named creation when ordinary contacts are unavailable',async()=>{
  const deps=fixture(named);
  deps.readPeople.mockRejectedValue(new Error('普通联系人不可用'));
  await expect(runCalendarCreation({...input,source:'明天下午三点跟小冰聊半小时'},deps)).rejects.toThrow(/参与人/);
  expect(deps.cli).not.toHaveBeenCalled();
});

it.each(['ou_unknown','ou_external','ou_resigned'])('never invites an ineligible model-selected contact %s',async id=>{
  const deps=fixture({...named,participantIds:[id]});
  await expect(runCalendarCreation(input,deps)).rejects.toThrow(/参与人/);
  expect(deps.cli).not.toHaveBeenCalled();
});

it('expands company intent from the verified roster and never from visible contacts',async()=>{
  const deps=fixture(company);
  const result=await runCalendarCreation(companyInput,deps);
  expect(result.receipt).toMatchObject({invitationStatus:'sent',participantCount:2,invitedCount:2});
  expect(deps.rosterRequest).toHaveBeenCalledWith(expect.objectContaining({identity:'bot',endpoint:'/open-apis/contact/v3/users'}));
  expect(deps.cli.mock.calls.at(-1)?.[0].join(' ')).toContain('ou_staff');
  expect(deps.cli.mock.calls.at(-1)?.[0].join(' ')).not.toContain('ou_ice');
  expect(JSON.stringify(deps.model.mock.calls)).not.toContain('ou_staff');
});

it('stops company creation if the full roster cannot be verified',async()=>{
  const deps=fixture(company);
  deps.rosterRequest.mockRejectedValue(new Error('denied'));
  await expect(runCalendarCreation(companyInput,deps)).rejects.toThrow(/全公司/);
  expect(deps.cli).not.toHaveBeenCalled();
});

it.each([[companyInput,personal],[{...input,source:'别叫每位仍在我们公司工作的同事，我自己留半小时'},company]])('uses semantic review to reject an omitted or unsupported company scope',async (request,plan)=>{
  const deps=fixture(plan,{...review,scopeSupported:false});
  await expect(runCalendarCreation(request,deps)).rejects.toThrow(/语义/);
  expect(deps.rosterRequest).not.toHaveBeenCalled();
  expect(deps.cli).not.toHaveBeenCalled();
});

it.each([{accountId:'ou_other',scopes},{accountId:'ou_self',scopes:[]}])('checks live identity and scopes again after model review',async current=>{
  const deps=fixture();
  deps.readAccount.mockResolvedValueOnce(account).mockResolvedValue(current);
  await expect(runCalendarCreation(input,deps)).rejects.toThrow(/账号|授权/);
  expect(deps.cli).not.toHaveBeenCalled();
});

it('preserves an already created event when a fresh invite authorization check fails',async()=>{
  const deps=fixture(named);
  deps.readAccount.mockResolvedValueOnce(account).mockResolvedValueOnce(account).mockResolvedValueOnce(account)
    .mockResolvedValue({accountId:'ou_self',scopes:[]});
  const result=await runCalendarCreation({...input,source:'明天下午三点跟小冰对齐半小时'},deps);
  expect(result.receipt).toMatchObject({eventId:'event_1',status:'partial',invitationStatus:'cancelled'});
  expect(deps.cli.mock.calls.map(([args])=>args[1])).toEqual(['calendars','freebusys','events']);
});

it('checks cancellation after the live account read and before submitting creation',async()=>{
  const deps=fixture();
  let cancelled=false;
  deps.readAccount.mockResolvedValueOnce(account).mockResolvedValueOnce(account).mockImplementation(async()=>{
    cancelled=true;
    return account;
  });
  await expect(runCalendarCreation(input,{...deps,beforeSubmit:()=>{
    if(cancelled)throw new Error('已取消');
  }})).rejects.toThrow('已取消');
  expect(deps.cli.mock.calls.map(([args])=>args[1])).toEqual(['calendars']);
});

it('stops invitations if the verified company roster expires after creation',async()=>{
  const deps=fixture(company);
  let elapsed=0;
  const clock=vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
  try {
    const result=await runCalendarCreation(companyInput,{...deps,onCreated:()=>{elapsed=300_001;}});
    expect(result.receipt).toMatchObject({eventId:'event_1',status:'partial',invitationStatus:'cancelled',invitedCount:0});
    expect(deps.cli.mock.calls.some(([args])=>args[1]==='event.attendees')).toBe(false);
  } finally {
    clock.mockRestore();
  }
});
