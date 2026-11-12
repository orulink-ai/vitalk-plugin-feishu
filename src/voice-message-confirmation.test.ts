import {expect,it,vi} from 'vitest';
import {confirmVoiceMessage} from './voice-message-confirmation';
const draft={id:'draft',content:'带电脑过来',recipient:{id:'person',name:'小冰'}};
it('waits for the floating confirmation and sends the edited draft only once',async()=>{
 let confirm!: (value:any)=>void;
 const deps={confirm:vi.fn(()=>new Promise<any>(resolve=>{confirm=resolve;})),send:vi.fn().mockResolvedValue({status:'sent',receipt:'om_test'}),show:vi.fn()};
 const pending=confirmVoiceMessage(deps,'request',draft,new AbortController().signal);
 expect(deps.send).not.toHaveBeenCalled();
 confirm({draftId:'draft',recipientId:'person',content:'明天带电脑过来'});
 await expect(pending).resolves.toMatchObject({title:'消息已发送'});
 expect(deps.send).toHaveBeenCalledExactlyOnceWith({id:'draft',recipientId:'person',content:'明天带电脑过来'});
});
it('never sends after cancellation or on an unmatched confirmation',async()=>{
 for(const cancelled of [true,false]){
  const controller=new AbortController();
  const deps={confirm:vi.fn(async()=>{if(cancelled)controller.abort();return {draftId:'other',recipientId:'person',content:'test'};}),send:vi.fn(),show:vi.fn()};
  await expect(confirmVoiceMessage(deps,'request',draft,controller.signal)).rejects.toThrow();
  expect(deps.send).not.toHaveBeenCalled();
 }
});
it('does not report an unknown send result as success',async()=>{
 const deps={confirm:vi.fn().mockResolvedValue({draftId:'draft',recipientId:'person',content:'test'}),send:vi.fn().mockResolvedValue({status:'unknown'}),show:vi.fn()};
 await expect(confirmVoiceMessage(deps,'request',draft,new AbortController().signal)).resolves.toMatchObject({title:'消息发送待核实'});
});
it('opens recipient and body confirmation for an unresolved candidate instead of a generic notice',async()=>{
 const deps={confirm:vi.fn().mockResolvedValue({draftId:'draft',recipientId:'second',content:'带电脑来找我'}),send:vi.fn().mockResolvedValue({status:'sent',receipt:'om_test'}),show:vi.fn()};
 await confirmVoiceMessage(deps,'request',{id:'draft',recipientCandidates:[{id:'first',name:'小冰'},{id:'second',name:'小兵'}]},new AbortController().signal);
 expect(deps.confirm).toHaveBeenCalledWith({requestId:'request',draft:{draftId:'draft',recipientId:'',content:'',recipients:[{id:'first',name:'小冰'},{id:'second',name:'小兵'}]}});
 expect(deps.show).not.toHaveBeenCalled();
 expect(deps.send).toHaveBeenCalledExactlyOnceWith({id:'draft',recipientId:'second',content:'带电脑来找我'});
});
it('keeps the body in the confirmation dialog when no recipient matched, without sending',async()=>{
 const deps={confirm:vi.fn().mockRejectedValue(new DOMException('已取消消息发送','AbortError')),send:vi.fn(),show:vi.fn()};
 await expect(confirmVoiceMessage(deps,'request',{id:'draft',content:'带电脑来找我',recipientCandidates:[]},new AbortController().signal)).rejects.toThrow('已取消消息发送');
 expect(deps.confirm).toHaveBeenCalledWith({requestId:'request',draft:{draftId:'draft',recipientId:'',content:'带电脑来找我',recipients:[]}});
 expect(deps.show).not.toHaveBeenCalled();
 expect(deps.send).not.toHaveBeenCalled();
});
