import {expect,it} from 'vitest';
import {taskCard} from './task-card';
const task={summary:'带电脑来找我',description:'顺便带充电器',assigneeId:'ou_ice',due:null};
it('builds a task share card with a single action and no raw link text',()=>{
  const card=taskCard(task,'task-123');
  expect(card.header.title.content).toBe(task.summary);
  expect(card.body.elements.filter(e=>e.tag==='button')).toHaveLength(1);
  expect(card.body.elements.find(e=>e.tag==='button')).toMatchObject({behaviors:[{type:'open_url',default_url:'https://applink.feishu.cn/client/todo/detail?guid=task-123'}]});
});
it('keeps user text plain instead of interpreting mentions or markup',()=>{
  const card=taskCard({...task,summary:'<at id=all>所有人</at>',description:'[打开](https://evil.test)'},'task-123');
  expect(card.header.title.tag).toBe('plain_text');
  expect(JSON.stringify(card)).not.toContain('lark_md');
});
it.each(['../evil','abc&x=1','https://evil.test'])('rejects malformed task identity %s',guid=>{
  expect(()=>taskCard(task,guid)).toThrow('任务');
});
it('shows an explicit Beijing deadline without duplicating task description',()=>{
  const card=taskCard({...task,due:'2026-11-07T10:00:00Z'},'task-123');
  expect(JSON.stringify(card)).toContain('2026年11月7日 18:00（北京时间）');
});
