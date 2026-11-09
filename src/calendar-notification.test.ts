import {expect,it,vi} from 'vitest';
import {notifyCalendar} from './calendar-notification';
import type {CalendarReceipt} from './calendar-service';
const plan={summary:'讨论计划',description:'',start:'2026-11-08T01:00:00Z',end:'2026-11-08T02:00:00Z',participantIds:['ou_b','ou_a']};
const receipt:CalendarReceipt & {confirmedRecipientIds:readonly string[]}={calendarId:'cal',eventId:'event',url:'https://applink.feishu.cn/client/calendar/event/detail?event_id=event',status:'completed',invitationStatus:'sent',participantCount:2,invitedCount:2,reason:'',confirmedRecipientIds:['ou_a','ou_b']};
it('checks each recipient and uses stable per-recipient identities',async()=>{
  const cli=vi.fn().mockResolvedValue({message_id:'om_ok'}), guard=vi.fn().mockResolvedValue(undefined);
  const result=await notifyCalendar(cli,plan,receipt,'operation',guard);
  expect(result.status).toBe('sent');expect(guard).toHaveBeenCalledTimes(2);
  expect(cli.mock.calls.map(call=>call[1])).toEqual(['operation:calendar-notification:ou_a','operation:calendar-notification:ou_b']);
});
it.each([
  {...receipt,status:'partial' as const},
  {...receipt,confirmedRecipientIds:undefined},
  {...receipt,confirmedRecipientIds:['ou_a']},
  {...receipt,confirmedRecipientIds:['ou_a','ou_stranger']},
  {...receipt,invitationStatus:'unconfirmed' as const},
])('does not infer invitation recipients from a count',async value=>{
  const cli=vi.fn();expect((await notifyCalendar(cli,plan,value,'operation',async()=>{})).status).toBe('not_sent');expect(cli).not.toHaveBeenCalled();
});
it('does not share personal events',async()=>{
 const cli=vi.fn();expect((await notifyCalendar(cli,{...plan,participantIds:[]},receipt,'operation',async()=>{})).status).toBe('not_sent');expect(cli).not.toHaveBeenCalled();
});
it('retains partial receipts and stops on account guard failure',async()=>{
 const cli=vi.fn().mockResolvedValue({message_id:'om_ok'}),guard=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('secret'));
 const result=await notifyCalendar(cli,plan,receipt,'operation',guard);
 expect(result.status).toBe('partial');expect(result.sentRecipientIds).toEqual(['ou_a']);expect(cli).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain('secret');
});
it('does not retry uncertain sends',async()=>{
 const cli=vi.fn().mockRejectedValue(Error('secret'));
 const result=await notifyCalendar(cli,plan,receipt,'operation',async()=>{});
 expect(result.status).toBe('unconfirmed');expect(cli).toHaveBeenCalledTimes(2);expect(JSON.stringify(result)).not.toContain('secret');
});

it('uses stable distinct provider keys of at most 50 characters for real calendar operations',async()=>{
  const cli=vi.fn().mockResolvedValue({message_id:'om_ok'});
  const id='13bf963b-8419-41e0-9a83-83f1330c5799';
  await notifyCalendar(cli,plan,receipt,id,async()=>{});
  await notifyCalendar(cli,plan,receipt,id,async()=>{});
  const keys=cli.mock.calls.map(([args])=>args[args.indexOf('--idempotency-key')+1]);
  expect(keys.every(key=>key.length<=50)).toBe(true);
  expect(keys.slice(0,2)).toEqual(keys.slice(2));
  expect(new Set(keys).size).toBe(2);
  expect(cli.mock.calls[0][1]).toBe(id+':calendar-notification:ou_a');
});
