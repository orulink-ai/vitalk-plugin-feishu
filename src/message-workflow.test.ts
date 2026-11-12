import {expect,it,vi} from 'vitest';
import {createMessageWorkflow,type MessageDraft} from './message-workflow';
function pendingBulk(){
 const contacts=[{id:'ou_a',name:'甲',aliases:[],kind:'person' as const,active:true,external:false},{id:'ou_b',name:'乙',aliases:[],kind:'person' as const,active:true,external:false}];
 const draft:MessageDraft={id:'bulk-edge',accountId:'ou_a',prompt:'通知所有人',recipientScope:'allContacts',recipientIds:['ou_a','ou_b'],recipient:{id:'all-contacts',name:'全部联系人',aliases:[],kind:'allContacts',active:true,external:false},content:'通知',status:'ready'};
 const cli=vi.fn();const readAllRecipients=vi.fn().mockResolvedValue(contacts);let stored=structuredClone(draft);
 const workflow=createMessageWorkflow({cli,readAllRecipients,readAccount:async()=>({accountId:'ou_a',scopes:['im:message.send_as_user','im:message']}),readRecipients:async()=>contacts,model:vi.fn(),store:{read:async()=>stored,write:async d=>{stored=structuredClone(d);}}});
 return {workflow,cli,readAllRecipients,contacts};
}
it('a partial bulk send keeps confirmed receipts and never retries the uncertain remainder',async()=>{
 const {workflow,cli}=pendingBulk();cli.mockResolvedValueOnce({message_id:'om_first'}).mockRejectedValueOnce(Error('lost response'));
 const result=await workflow.confirm('bulk-edge');expect(result.status).toBe('unknown');expect(result.messageIds).toEqual({ou_a:'om_first'});
 await workflow.confirm('bulk-edge');expect(cli).toHaveBeenCalledTimes(2);
});
it('a changed or unreadable complete-contact snapshot prevents any bulk submission',async()=>{
 const {workflow,cli,readAllRecipients,contacts}=pendingBulk();readAllRecipients.mockResolvedValue([...contacts,{...contacts[0],id:'ou_new'}]);
 await expect(workflow.confirm('bulk-edge')).rejects.toThrow('变化');expect(cli).not.toHaveBeenCalled();
 readAllRecipients.mockRejectedValue(Error('directory unavailable'));await expect(workflow.confirm('bulk-edge')).rejects.toThrow('unavailable');expect(cli).not.toHaveBeenCalled();
});
it('a partially failed bulk recall does not claim that every message was recalled',async()=>{
 const {workflow,cli}=pendingBulk();cli.mockResolvedValueOnce({message_id:'om_first'}).mockResolvedValueOnce({message_id:'om_second'});await workflow.confirm('bulk-edge');
 cli.mockResolvedValueOnce({}).mockRejectedValueOnce(Error('uncertain recall'));
 const result=await workflow.recall('bulk-edge',true);expect(result.status).toBe('recall_unknown');expect(result.recalledMessageIds).toEqual(['om_first']);
});
it('bulk confirmation sends only to frozen personal contacts, once per person and never to groups',async()=>{
 const rows=new Map<string,MessageDraft>();const cli=vi.fn().mockResolvedValueOnce({message_id:'om_first'}).mockResolvedValueOnce({message_id:'om_second'});
 const contacts=[{id:'ou_a',name:'甲',aliases:[],kind:'person' as const,active:true,external:false},{id:'ou_b',name:'乙',aliases:[],kind:'person' as const,active:true,external:false},{id:'oc_team',name:'群',aliases:[],kind:'group' as const,active:true,external:false}];
 const workflow=createMessageWorkflow({cli,readAccount:async()=>({accountId:'ou_a',scopes:['im:message.send_as_user','im:message']}),readRecipients:async()=>contacts,model:async(input:any)=>input.purpose==='reviewAllContacts'?{supported:true,scopeSupported:true}:{action:'send',recipientScope:'allContacts',scopeEvidence:'所有联系人',content:'等会开会'},store:{read:async id=>rows.get(id),write:async d=>{rows.set(d.id,structuredClone(d));}}});
 const draft=await workflow.prepare('告诉所有联系人等会开会','');expect(cli).not.toHaveBeenCalled();
 const sent=await workflow.confirm(draft.id);expect(sent.status).toBe('sent');expect(sent.messageIds).toEqual({ou_a:'om_first',ou_b:'om_second'});
 expect(cli.mock.calls.map(([args])=>args[args.indexOf('--user-id')+1])).toEqual(['ou_a','ou_b']);
 await workflow.confirm(draft.id);expect(cli).toHaveBeenCalledTimes(2);
 cli.mockResolvedValue({});const recalled=await workflow.recall(draft.id,true);
 expect(recalled.status).toBe('recalled');expect(cli.mock.calls.filter(([args])=>args[1]==='messages'&&args[2]==='delete')).toHaveLength(2);
});
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
