import {expect,it,vi} from 'vitest';
import {createWorkspaceMessageService} from './workspace-message-service';
function setup(){const values=new Map();const request=vi.fn(async(method:string,params:any):Promise<any>=>{
 if(method.startsWith('storage.'))expect(params.key).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
 if(method==='storage.get')return {value:values.get(params.key)??null};
 if(method==='storage.set'){values.set(params.key,structuredClone(params.value));return {ok:true};}
 if(method==='ai.generate')return {text:JSON.stringify({action:'send',recipientId:'ou_bing',content:'带电脑来找我'})};
 if(method==='native.execute')return {exitCode:0,stdout:JSON.stringify(params.args[0]==='auth'?{ok:true,data:{identities:{user:{openId:'ou_me',status:'ready',tokenStatus:'valid',scope:'im:message.send_as_user im:message'}}}}:{ok:true,data:{message_id:'om_sent'}})};
 throw Error(method);
 });return {request,service:createWorkspaceMessageService(request as any,{readRecipients:async()=>[{id:'ou_bing',name:'小冰',aliases:['冰哥'],kind:'person',active:true,external:false}],readPreference:async()=>''})};}
it('persists a plugin draft and never sends until the confirmation action',async()=>{
 const {service,request}=setup();const draft=await service.prepare({prompt:'给冰哥说带电脑来找我'});expect(draft.status).toBe('ready');expect(await service.read()).toMatchObject({id:draft.id});expect(request.mock.calls.filter(([m,p])=>m==='native.execute'&&p.args[0]==='im')).toHaveLength(0);
 expect(await service.send({id:draft.id,recipientId:'ou_bing',content:'带电脑来找我',attachmentIds:[]})).toMatchObject({status:'sent',receipt:'om_sent'});
});
it('rejects attachment IDs absent from the owned draft',async()=>{const {service,request}=setup();const d=await service.prepare({prompt:'给小冰说好'});request.mockClear();await expect(service.send({id:d.id,content:'好',attachmentIds:['image']})).rejects.toThrow('图片');expect(request.mock.calls.some(([m,p])=>m==='native.execute'&&p.args[0]==='im')).toBe(false);});

it('refuses dismissing another account sent draft',async()=>{
 const {service,request}=setup();const draft=await service.prepare({prompt:'给小冰说好'});await service.send({id:draft.id,content:draft.content});
 const original=request.getMockImplementation()!;request.mockImplementation(async(m,p)=>m==='native.execute'&&p.args[0]==='auth'?{exitCode:0,stdout:JSON.stringify({identities:{user:{openId:'ou_other',status:'ready',tokenStatus:'valid',scope:'im:message.send_as_user im:message'}}})}:original(m,p));
 await expect(service.dismiss({id:draft.id})).rejects.toThrow('账号');
});
it('does not start any preparation request when cancelled',async()=>{const {service,request}=setup();const controller=new AbortController();controller.abort();await expect(service.prepare({prompt:'好'},{signal:controller.signal})).rejects.toThrow();expect(request).not.toHaveBeenCalled();});
it('regenerates only owned ready drafts and permits an explicit recipient correction',async()=>{const {service}=setup();const d=await service.prepare({prompt:'给小冰说好'});expect(await service.prepare({prompt:d.prompt,sourceDraftId:d.id,attachmentIds:[]})).toMatchObject({status:'ready'});expect(await service.prepare({prompt:d.prompt,recipientSourceDraftId:d.id,recipientId:'ou_bing'})).toMatchObject({id:d.id,recipient:{id:'ou_bing'}});});
it('keeps PNG previews and sends selected images only after confirmation',async()=>{
 const {service,request}=setup();const original=request.getMockImplementation()!;
 request.mockImplementation(async(m,p)=>{
  if(m==='files.stage')return {fileId:'file',path:'input/file.png',expiresAt:123};if(m==='files.release')return {ok:true};
  if(m==='native.execute'&&p.args[0]==='auth')return {exitCode:0,stdout:JSON.stringify({ok:true,data:{identities:{user:{openId:'ou_me',status:'ready',tokenStatus:'valid',scope:'im:message.send_as_user im:message im:resource'}}}})};
  if(m==='native.execute'&&p.args[1]==='images')return {exitCode:0,stdout:JSON.stringify({ok:true,data:{image_key:'img_picture'}})};
  return original(m,p);
 });
 const image={id:'image',dataUrl:'data:image/png;base64,iVBORw0KGgo=',width:1,height:1};
 const d=await service.prepare({prompt:'给小冰发图',attachments:[image]});expect(d.attachments).toEqual([image]);expect(request.mock.calls.some(([m])=>m==='files.stage')).toBe(false);
 expect(await service.send({id:d.id,content:d.content,attachmentIds:['image']})).toMatchObject({status:'sent'});
 const sent=request.mock.calls.find(([m,p])=>m==='native.execute'&&p.args[1]==='+messages-send')![1];expect(sent.args).toContain('post');expect(sent.args.join(' ')).toContain('img_picture');expect(request.mock.calls.some(([m])=>m==='files.release')).toBe(true);
});
it('keeps a clarification draft for manual recipient selection without sending',async()=>{
 const {service,request}=setup();const original=request.getMockImplementation()!;request.mockImplementation(async(m,p)=>m==='ai.generate'?{text:JSON.stringify({action:'clarify',recipientQuery:'小冰',content:'带电脑来找我'})}:original(m,p));
 const d=await service.prepare({prompt:'叫小冰带电脑过来'});expect(d.awaitingRecipient).toBe(true);expect(d.recipient).toBeUndefined();expect(d.recipientCandidates?.[0].id).toBe('ou_bing');
 await expect(service.send({id:d.id,content:d.content})).rejects.toThrow('对象');
 const selected=await service.prepare({recipientSourceDraftId:d.id,recipientId:'ou_bing'});expect(selected.awaitingRecipient).toBe(false);expect(selected.content).toBe('带电脑来找我');
 expect(request.mock.calls.some(([m,p])=>m==='native.execute'&&p.args[1]==='+messages-send')).toBe(false);
});
it('uses host-valid keys when cancelling and recalling durable drafts',async()=>{
 const {service}=setup();
 const cancelled=await service.prepare({prompt:'给小冰说好'});
 await service.dismiss({id:cancelled.id});expect(await service.read()).toBeNull();
 const sent=await service.prepare({prompt:'给小冰说好'});
 await service.send({id:sent.id,content:sent.content});
 expect(await service.recall({id:sent.id,confirmed:true})).toMatchObject({status:'recalled'});
 expect(await service.read()).toMatchObject({status:'recalled',receipt:'om_sent'});
});
it('keeps single-recipient confirmation compatible with the host strict JSON storage boundary',async()=>{
 const {service,request}=setup();const original=request.getMockImplementation()!;
 request.mockImplementation(async(m,p)=>{
  if(m==='storage.set')JSON.stringify(p.value,(key,value)=>{if(value===undefined)throw Error('host rejects undefined: '+key);return value;});
  return original(m,p);
 });
 const draft=await service.prepare({prompt:'给小冰说好'});
 await expect(service.send({id:draft.id,content:draft.content})).resolves.toMatchObject({status:'sent',receipt:'om_sent'});
});
