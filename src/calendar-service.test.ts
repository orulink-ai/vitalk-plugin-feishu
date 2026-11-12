import {expect,it,vi} from 'vitest';
import {createCalendar} from './calendar-service';

const operationId = '13bf963b-8419-41e0-9a83-83f1330c5799';
const plan = {summary:'项目评审',description:'带电脑',start:'2026-11-08T15:00:00+08:00',end:'2026-11-08T15:30:00+08:00',participantIds:['ou_b','ou_a','ou_b']};
const calendar = {calendars:[{calendar:{calendar_id:'cal_primary',role:'owner'}}]};
const event = {event:{event_id:'event_1',app_link:'https://applink.feishu.cn/client/calendar/event/detail?event=1'}};
const attendees = {attendees:[{user_id:'ou_a'},{user_id:'ou_b'}]};

it('uses the desktop CLI shapes, stable stage IDs and verified attendee receipts',async()=>{
  const cli=vi.fn().mockResolvedValueOnce(calendar).mockResolvedValueOnce({freebusy_list:[]}).mockResolvedValueOnce({freebusy_list:[]}).mockResolvedValueOnce(event).mockResolvedValueOnce(attendees);
  const onCreated=vi.fn();
  const receipt=await createCalendar(cli,plan,operationId,{onCreated});
  expect(receipt).toMatchObject({calendarId:'cal_primary',eventId:'event_1',url:event.event.app_link,status:'completed',invitationStatus:'sent',invitedCount:2,participantCount:2});
  expect(cli.mock.calls.map(([argv,id])=>[argv.slice(0,3),id])).toEqual([
    [['calendar','calendars','primary'],`${operationId}:primary`],
    [['calendar','freebusys','list'],`${operationId}:busy:0`],
    [['calendar','freebusys','list'],`${operationId}:busy:1`],
    [['calendar','events','create'],`${operationId}:create`],
    [['calendar','event.attendees','create'],`${operationId}:invite:0`],
  ]);
  const create=cli.mock.calls[3][0];
  expect(create[create.indexOf('--idempotency-key')+1]).toBe(operationId);
  expect(JSON.parse(create[create.indexOf('--data')+1])).toMatchObject({summary:plan.summary,description:plan.description,visibility:'private',need_notification:false,start_time:{timestamp:String(Date.parse(plan.start)/1000),timezone:'Asia/Shanghai'}});
  const invite=cli.mock.calls[4][0];
  expect(JSON.parse(invite[invite.indexOf('--data')+1])).toEqual({attendees:[{type:'user',user_id:'ou_a'},{type:'user',user_id:'ou_b'}],need_notification:true});
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({eventId:'event_1',invitationStatus:'pending'}));
  expect(onCreated.mock.invocationCallOrder[0]).toBeLessThan(cli.mock.invocationCallOrder[4]);
  expect(receipt.confirmedRecipientIds).toEqual(['ou_a','ou_b']);
  expect(Object.isFrozen(receipt.confirmedRecipientIds)).toBe(true);
});

it('stops before creation when availability is busy or malformed',async()=>{
  for(const busy of [{freebusy_list:[{}]},{freebusy_list:null},{},{unrecognized:[]}]){
    const cli=vi.fn().mockResolvedValueOnce(calendar).mockResolvedValueOnce(busy);
    await expect(createCalendar(cli,plan,operationId)).rejects.toThrow(/尚未预约/);
    expect(cli).toHaveBeenCalledTimes(2);
  }
});

it.each([{summary:'  '},{summary:'字'.repeat(501)},{description:'字'.repeat(2667)}])('rejects invalid title or description before calling the CLI',async patch=>{
  const cli=vi.fn();
  await expect(createCalendar(cli,{...plan,...patch},operationId)).rejects.toThrow(/标题|说明/);
  expect(cli).not.toHaveBeenCalled();
});

it('keeps an uncertain creation terminal within the call and skips invitations',async()=>{
  const cli=vi.fn().mockResolvedValueOnce(calendar).mockRejectedValueOnce(new Error('connection lost'));
  await expect(createCalendar(cli,{...plan,allowConflict:true},operationId)).rejects.toThrow(/未确认.*不会重复预约/);
  expect(cli).toHaveBeenCalledTimes(2);
});

it('returns the confirmed event after a failed second invite batch and stops remaining work',async()=>{
  const participantIds=Array.from({length:201},(_,i)=>`ou_${String(i).padStart(3,'0')}`);
  const cli=vi.fn().mockResolvedValueOnce(calendar).mockResolvedValueOnce(event)
    .mockResolvedValueOnce({attendees:participantIds.slice(0,100).map(user_id=>({user_id}))})
    .mockRejectedValueOnce(new Error('connection lost'));
  const receipt=await createCalendar(cli,{...plan,allowConflict:true,participantIds},operationId);
  expect(receipt).toMatchObject({eventId:'event_1',status:'partial',invitationStatus:'unconfirmed',invitedCount:100,participantCount:201});
  expect(receipt.confirmedRecipientIds).toEqual(participantIds.slice(0,100));
  expect(cli).toHaveBeenCalledTimes(4);
});

it('stops if storing the event receipt fails and returns the event and warning',async()=>{
  const cli=vi.fn().mockResolvedValueOnce(calendar).mockResolvedValueOnce(event);
  const onCreated=vi.fn().mockRejectedValue(new Error('storage unavailable'));
  const receipt=await createCalendar(cli,{...plan,allowConflict:true},operationId,{onCreated});
  expect(receipt).toMatchObject({eventId:'event_1',status:'partial',invitationStatus:'not_sent',persistenceWarning:expect.any(String)});
  expect(cli).toHaveBeenCalledTimes(2);
});

it('preserves the created event when a subsequent submission is cancelled',async()=>{
  const cli=vi.fn().mockResolvedValueOnce(calendar).mockResolvedValueOnce(event);
  const beforeSubmit=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('cancelled'));
  const receipt=await createCalendar(cli,{...plan,allowConflict:true},operationId,{beforeSubmit});
  expect(receipt).toMatchObject({eventId:'event_1',status:'partial',invitationStatus:'cancelled',invitedCount:0});
  expect(cli).toHaveBeenCalledTimes(2);
});

it('creates a personal event without inviting anyone or returning an unsafe link',async()=>{
  const cli=vi.fn().mockResolvedValueOnce(calendar).mockResolvedValueOnce({event:{...event.event,app_link:'https://applink.feishu.cn.evil.test/event'}});
  const receipt=await createCalendar(cli,{...plan,participantIds:[]},operationId);
  expect(receipt).toMatchObject({eventId:'event_1',url:'',status:'completed',invitationStatus:'not_sent',participantCount:0});
  expect(cli).toHaveBeenCalledTimes(3);
});

it('reads back the same created event when its creation receipt omits the link',async()=>{
 const cli=vi.fn().mockResolvedValueOnce(calendar)
  .mockResolvedValueOnce({event:{event_id:'event_1'}}).mockResolvedValueOnce(event);
 const onCreated=vi.fn();
 const receipt=await createCalendar(cli,{...plan,participantIds:[]},operationId,{onCreated});
 expect(receipt.url).toBe(event.event.app_link);
 expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({url:event.event.app_link}));
 expect(cli.mock.calls[2]).toEqual([
  ['calendar','events','get','--calendar-id','cal_primary','--event-id','event_1','--as','user','--format','json'],
  `${operationId}:read-link`,
 ]);
});

it.each([
 {event:{event_id:'another_event',app_link:event.event.app_link}},
 {event:{event_id:'event_1',app_link:'https://evil.test/event'}},
])('does not attach an unverified readback link or recreate the event',async readback=>{
 const cli=vi.fn().mockResolvedValueOnce(calendar)
  .mockResolvedValueOnce({event:{event_id:'event_1'}}).mockResolvedValueOnce(readback);
 await expect(createCalendar(cli,{...plan,participantIds:[]},operationId)).resolves.toMatchObject({eventId:'event_1',url:'',status:'completed'});
 expect(cli).toHaveBeenCalledTimes(3);
});

it('preserves the official tenant calendar event app link in the receipt',async()=>{
 const url='https://sample.feishu.cn/calendar/event/example?calendarId=example_calendar&key=example_event';
 const cli=vi.fn().mockResolvedValueOnce(calendar).mockResolvedValueOnce({event:{event_id:'event_1',app_link:url}});
 await expect(createCalendar(cli,{...plan,participantIds:[]},operationId)).resolves.toMatchObject({eventId:'event_1',url});
});
