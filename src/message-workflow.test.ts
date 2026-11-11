import {expect,it,vi} from 'vitest';
import {createMessageWorkflow,type MessageDraft} from './message-workflow';
function setup(readRecipient?: (id:string)=>Promise<import('./message-intent').MessageRecipient|undefined>){
 const rows=new Map<string,MessageDraft>();const cli=vi.fn().mockResolvedValue({message_id:'om_sent'});
 const readAccount=vi.fn().mockResolvedValue({accountId:'ou_me',scopes:['im:message.send_as_user','im:message']});
 const readRecipients=vi.fn().mockResolvedValue([{id:'ou_bing',name:'小冰',aliases:[],kind:'person',active:true,external:false}]);
 const workflow=createMessageWorkflow({cli,readAccount,readRecipients,readRecipient,model:vi.fn().mockResolvedValue({action:'send',recipientId:'ou_bing',content:'带电脑来找我'}),store:{read:async id=>rows.get(id),write:async d=>{rows.set(d.id,structuredClone(d));}}});
 return {workflow,cli,rows,readAccount,readRecipients};
}
it('confirms final edits with one recipient refresh and never resends on retry',async()=>{
 const {workflow,cli,readRecipients}=setup();const draft=await workflow.prepare('发消息','');
 readRecipients.mockClear();readRecipients.mockResolvedValue([{id:'ou_other',name:'同事',aliases:[],kind:'person',active:true,external:false}]);
 const result=await workflow.confirm(draft.id,{recipientId:'ou_other',content:'最终确认的正文'});
 expect(result.status).toBe('sent');expect(result.recipient?.id).toBe('ou_other');expect(result.content).toBe('最终确认的正文');
 expect(readRecipients).toHaveBeenCalledTimes(1);expect(cli.mock.calls[0][0]).toContain('ou_other');expect(cli.mock.calls[0][0]).toContain('最终确认的正文');
 expect(await workflow.confirm(draft.id,{content:'重复点击的新正文'})).toEqual(result);expect(cli).toHaveBeenCalledTimes(1);expect(readRecipients).toHaveBeenCalledTimes(1);
});
it('prepares without sending, then sends once only after explicit confirmation',async()=>{
 const {workflow,cli}=setup();const draft=await workflow.prepare('让小冰带电脑来','');expect(draft.status).toBe('ready');expect(cli).not.toHaveBeenCalled();
 const result=await workflow.confirm(draft.id);expect(result.status).toBe('sent');expect(cli).toHaveBeenCalledTimes(1);
 expect(await workflow.confirm(draft.id)).toEqual(result);expect(cli).toHaveBeenCalledTimes(1);
});
it('cancels a ready draft without sending',async()=>{const {workflow,cli}=setup();const draft=await workflow.prepare('发消息','');await workflow.cancel(draft.id);await expect(workflow.confirm(draft.id)).rejects.toThrow('草稿');expect(cli).not.toHaveBeenCalled();});
it('refuses account switches and departed recipients',async()=>{
 const a=setup();const d=await a.workflow.prepare('发消息','');a.readAccount.mockResolvedValue({accountId:'ou_other',scopes:['im:message.send_as_user']});await expect(a.workflow.confirm(d.id)).rejects.toThrow('账号');expect(a.cli).not.toHaveBeenCalled();
 const b=setup();const e=await b.workflow.prepare('发消息','');b.readRecipients.mockResolvedValue([]);await expect(b.workflow.confirm(e.id)).rejects.toThrow('对象');expect(b.cli).not.toHaveBeenCalled();
});
it('persists sending before network and never repeats an unknown send',async()=>{
 const {workflow,cli,rows}=setup();const d=await workflow.prepare('发消息','');cli.mockImplementation(async()=>{expect(rows.get(d.id)?.status).toBe('sending');throw Error('secret');});
 expect((await workflow.confirm(d.id)).status).toBe('unknown');expect((await workflow.confirm(d.id)).status).toBe('unknown');expect(cli).toHaveBeenCalledTimes(1);
});
it('recalls only its confirmed sent receipt and requires explicit confirmation',async()=>{
 const {workflow,cli}=setup();const d=await workflow.prepare('发消息','');await workflow.confirm(d.id);
 await expect(workflow.recall(d.id,false)).rejects.toThrow('确认');cli.mockResolvedValue({});expect((await workflow.recall(d.id,true)).status).toBe('recalled');
 expect(cli.mock.calls[1][0]).toEqual(['im','messages','delete','--message-id','om_sent','--yes','--as','user','--format','json']);
 await workflow.recall(d.id,true);expect(cli).toHaveBeenCalledTimes(2);
});
it('does not send when persisting the pre-send claim fails',async()=>{
 const cli=vi.fn();let row:MessageDraft|undefined;
 const workflow=createMessageWorkflow({cli,readAccount:async()=>({accountId:'ou_me',scopes:['im:message.send_as_user']}),readRecipients:async()=>[{id:'ou_bing',name:'小冰',aliases:[],kind:'person',active:true,external:false}],model:async()=>({action:'send',recipientId:'ou_bing',content:'好'}),store:{read:async()=>row,write:async d=>{if(d.status==='sending')throw Error('disk');row=structuredClone(d);}}});
 const draft=await workflow.prepare('发消息','');await expect(workflow.confirm(draft.id)).rejects.toThrow('disk');expect(cli).not.toHaveBeenCalled();
});
it('blocks concurrent confirmation while a send is waiting',async()=>{
 const {workflow,cli}=setup();const d=await workflow.prepare('发消息','');let finish!:(v:unknown)=>void;cli.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const first=workflow.confirm(d.id);await vi.waitFor(()=>expect(cli).toHaveBeenCalledTimes(1));await expect(workflow.confirm(d.id)).rejects.toThrow('处理中');finish({message_id:'om_sent'});await first;
});
it('allows editing only before confirmation and keeps the exact confirmed text',async()=>{
 const {workflow,cli}=setup();const d=await workflow.prepare('发消息','');await workflow.edit(d.id,{content:'带两台电脑，不是三台'});await workflow.confirm(d.id);
 expect(cli.mock.calls[0][0]).toContain('带两台电脑，不是三台');await expect(workflow.edit(d.id,{content:'新内容'})).rejects.toThrow('不可编辑');
});
it('does not replay an unconfirmed recall',async()=>{
 const {workflow,cli}=setup();const d=await workflow.prepare('发消息','');await workflow.confirm(d.id);cli.mockRejectedValue(Error('timeout'));
 expect((await workflow.recall(d.id,true)).status).toBe('recall_unknown');expect((await workflow.recall(d.id,true)).status).toBe('recall_unknown');expect(cli).toHaveBeenCalledTimes(2);
});
it('rejects corrupted persisted drafts before any external operation',async()=>{
 const a=setup();const d=await a.workflow.prepare('发消息','');a.rows.get(d.id)!.id='different-id';await expect(a.workflow.confirm(d.id)).rejects.toThrow('草稿');expect(a.cli).not.toHaveBeenCalled();
 const b=setup();const e=await b.workflow.prepare('发消息','');b.rows.get(e.id)!.content='';await expect(b.workflow.confirm(e.id)).rejects.toThrow('草稿');expect(b.cli).not.toHaveBeenCalled();
});
it('does not claim recall success without a structured success payload',async()=>{
 const {workflow,cli}=setup();const d=await workflow.prepare('发消息','');await workflow.confirm(d.id);cli.mockResolvedValue(undefined);expect((await workflow.recall(d.id,true)).status).toBe('recall_unknown');
});
it('keeps image draft editable when resource permission is missing before send',async()=>{
 const {workflow,cli,rows}=setup();
 const image={id:'image',dataUrl:'data:image/png;base64,iVBORw0KGgo=',width:1,height:1};
 const draft=await workflow.prepare('给小冰发图','',[image]);
 await expect(workflow.confirm(draft.id)).rejects.toThrow('权限');
 expect(rows.get(draft.id)?.status).toBe('ready');expect(cli).not.toHaveBeenCalled();
 await workflow.edit(draft.id,{content:'仅文字',attachments:[]});
 expect((await workflow.confirm(draft.id)).status).toBe('sent');
});
it('uses cached draft candidates but revalidates a recipient before sending',async()=>{
 const rows=new Map<string,MessageDraft>();const cli=vi.fn();
 const readRecipients=vi.fn().mockResolvedValue([]);
 const readDraftRecipients=vi.fn().mockResolvedValue([{id:'ou_bing',name:'小冰',aliases:[],kind:'person',active:true,external:false}]);
 const workflow=createMessageWorkflow({cli,readAccount:async()=>({accountId:'ou_me',scopes:['im:message.send_as_user']}),readRecipients,readDraftRecipients,model:async()=>({action:'send',recipientId:'ou_bing',content:'带电脑来找我'}),store:{read:async id=>rows.get(id),write:async d=>{rows.set(d.id,structuredClone(d));}}});
 const draft=await workflow.prepare('让小冰带电脑来','');
 expect(draft.recipient?.id).toBe('ou_bing');expect(readDraftRecipients).toHaveBeenCalledTimes(1);expect(readRecipients).not.toHaveBeenCalled();
 await expect(workflow.confirm(draft.id)).rejects.toThrow('对象');expect(readRecipients).toHaveBeenCalledTimes(1);expect(cli).not.toHaveBeenCalled();
});

it('checks only the selected recipient when confirming a cached draft',async()=>{
 const readRecipient=vi.fn().mockResolvedValue({id:'ou_bing',name:'小冰',aliases:[],kind:'person',active:true,external:false});
 const {workflow,readRecipients,cli}=setup(readRecipient);const draft=await workflow.prepare('发消息','');readRecipients.mockClear();
 expect((await workflow.confirm(draft.id)).status).toBe('sent');expect(readRecipient).toHaveBeenCalledWith('ou_bing');expect(readRecipients).not.toHaveBeenCalled();expect(cli).toHaveBeenCalledTimes(1);
});
it.each([undefined,{id:'ou_bing',name:'小冰',aliases:[],kind:'person',active:false,external:false},{id:'ou_bing',name:'小冰',aliases:[],kind:'person',active:true,external:true}])('rejects unavailable selected recipients without sending',async recipient=>{
 const {workflow,cli}=setup(vi.fn().mockResolvedValue(recipient));const draft=await workflow.prepare('发消息','');await expect(workflow.confirm(draft.id)).rejects.toThrow('消息对象已不可用');expect(cli).not.toHaveBeenCalled();
});
