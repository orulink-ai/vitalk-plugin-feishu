import {expect,it} from 'vitest';
import {calendarCard} from './calendar-card';
const plan={summary:'<at id=all>开会</at>',description:'讨论 **计划**',start:'2026-11-08T01:00:00Z',end:'2026-11-08T02:00:00Z',participantIds:['ou_a']};
it('uses plain text and Beijing time with a real event link',()=>{
  const card=calendarCard(plan,'https://applink.feishu.cn/client/calendar/event/detail?event_id=abc');
  expect(card.schema).toBe('2.0');
  expect(card.header.title).toEqual({tag:'plain_text',content:plan.summary});
  expect(JSON.stringify(card)).toContain('09:00');
  expect(JSON.stringify(card)).toContain('北京时间');
  expect(JSON.stringify(card)).not.toContain('lark_md');
});
it.each(['','https://evil.test/a','https://applink.feishu.cn.evil.test/a','http://applink.feishu.cn/a','https://x@applink.feishu.cn/a'])('rejects unsafe or missing links %s',url=>expect(()=>calendarCard(plan,url)).toThrow());

it('opens an official tenant calendar event link without widening the allowed path',()=>{
 const url='https://sample.feishu.cn/calendar/event/example?calendarId=example_calendar&key=example_event';
 expect(JSON.stringify(calendarCard(plan,url))).toContain(url);
 expect(()=>calendarCard(plan,'https://sample.feishu.cn/drive/anything')).toThrow();
 expect(()=>calendarCard(plan,'https://sample.feishu.cn:8443/calendar/event/example')).toThrow();
});
