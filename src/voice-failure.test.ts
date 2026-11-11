import {expect,it,vi} from 'vitest';
import {createReportedVoiceWorkflow} from './voice-workflow';
it('correlates stages and preserves safe nested failure codes',async()=>{
 const diagnostic=vi.fn();
 const cause=Object.assign(Error('private secret'),{code:'NATIVE_TIMEOUT'});
 const run=createReportedVoiceWorkflow({diagnostic,prepareMessage:vi.fn().mockRejectedValue(Object.assign(Error('wrapper'),{code:'MESSAGE_DIALOG_FAILED',cause})),create:vi.fn(),showMessage:vi.fn()});
 await run({requestId:'r',actionId:'message',transcript:'private',sessionId:'s'},new AbortController().signal);
 expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({requestId:'r',stage:'message.prepare',status:'started'}));
 expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({requestId:'r',status:'failed',causeCodes:['NATIVE_TIMEOUT']}));
 expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private');
});
it('reports numeric upstream errors without exposing the raw response',async()=>{
 const diagnostic=vi.fn();
 const run=createReportedVoiceWorkflow({diagnostic,prepareMessage:vi.fn().mockRejectedValue(Object.assign(Error('private response'),{code:'CLI_REJECTED',upstreamCode:99991672})),create:vi.fn(),showMessage:vi.fn()});
 const result=await run({requestId:'r',actionId:'message',transcript:'x',sessionId:'s'},new AbortController().signal);
 expect(result.text).toContain('99991672');
 expect(result.text).not.toContain('private response');
 expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({upstreamCode:99991672}));
});
it('returns a useful failure instead of allowing the SDK to discard the cause',async()=>{
 const prepareMessage=vi.fn().mockRejectedValue(Object.assign(Error('secret provider response'),{code:'MODEL_TIMEOUT'}));
 const run=createReportedVoiceWorkflow({prepareMessage,create:vi.fn(),showMessage:vi.fn()});
 const result=await run({requestId:'r',actionId:'message',transcript:'private text',sessionId:'s'},new AbortController().signal);
 expect(result.title).toBe('消息处理失败');
 expect(result.text).toContain('整理消息');expect(result.text).toContain('MODEL_TIMEOUT');
 expect(result.text).toContain('耗时');expect(result.text).not.toContain('secret');expect(result.text).not.toContain('private text');
 expect(prepareMessage).toHaveBeenCalledTimes(1);
});
it('preserves cancellation instead of showing failure after dismissal',async()=>{
 const c=new AbortController();c.abort();
 const run=createReportedVoiceWorkflow({prepareMessage:vi.fn(),create:vi.fn(),showMessage:vi.fn()});
 await expect(run({requestId:'r',actionId:'task',transcript:'x',sessionId:'s'},c.signal)).rejects.toThrow();
});
it('does not claim no mutation when task operation fails after a possible edit',async()=>{
 const run=createReportedVoiceWorkflow({prepareMessage:vi.fn(),create:vi.fn(),showMessage:vi.fn(),operation:vi.fn().mockRejectedValue(Error('lost receipt'))});
 const result=await run({requestId:'r',actionId:'task',transcript:'x',sessionId:'s'},new AbortController().signal);
 expect(result.text).toContain('操作结果尚未确认');
 expect(result.text).not.toContain('未执行发送或创建');
});

it('reports a dialog failure as unsent, not an uncertain send',async()=>{
 const run=createReportedVoiceWorkflow({prepareMessage:vi.fn().mockResolvedValue({id:'d'}),confirmMessage:vi.fn().mockRejectedValue(Object.assign(Error('private'),{code:'MESSAGE_DIALOG_FAILED'})),create:vi.fn(),showMessage:vi.fn()});
 const result=await run({requestId:'r',actionId:'message',transcript:'x',sessionId:'s'},new AbortController().signal);
 expect(result.text).toContain('消息尚未发送');
 expect(result.text).not.toContain('操作结果尚未确认');
});
