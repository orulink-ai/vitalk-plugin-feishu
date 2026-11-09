import {expect,it,vi} from 'vitest';
import {prepareMessage} from './message-intent';
const people=[{id:'ou_bing',name:'阳晓冰',aliases:['小冰'],active:true,external:false,kind:'person' as const}];
it('lets the model resolve natural wording and aliases without fixed templates',async()=>{
 const model=vi.fn().mockResolvedValue({action:'send',recipientId:'ou_bing',content:'等会带电脑来找我。'});
 expect(await prepareMessage('让小冰等会带电脑找我',people,model,'简洁自然')).toMatchObject({recipient:people[0],content:'等会带电脑来找我。'});
 expect(model.mock.calls[0][0]).toMatchObject({recipients:people,expressionPreference:'简洁自然'});
});
it('does not guess an unavailable or external recipient',async()=>{
 await expect(prepareMessage('说一声',people,async()=>({action:'send',recipientId:'ou_other',content:'好'}),'')).rejects.toThrow('对象');
 await expect(prepareMessage('发消息',[{...people[0],external:true}],async()=>({action:'send',recipientId:'ou_bing',content:'好'}),'')).rejects.toThrow('对象');
});
it('does not turn recall intent into a new send',async()=>{await expect(prepareMessage('撤回刚才的话',people,async()=>({action:'recall',recipientId:'ou_bing',content:'好'}),'')).rejects.toThrow('发送');});
