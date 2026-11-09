import {expect,it,vi} from 'vitest';
import {createWorkspaceStateService} from './workspace-state-service';
it('migrates matching account preferences and aliases once, without mutating legacy data',async()=>{
 const values=new Map();const request=vi.fn(async(m:string,p:any)=>m==='storage.get'?{value:values.get(p.key)??null}:m==='storage.set'?(values.set(p.key,structuredClone(p.value)),{ok:true}):{accountId:'ou_me',enabled:true,entries:[{query:'冰哥',recipientId:'ou_bing',source:'manual'}],config:{feishuMessageStyle:'自然'},feishuCatalog:{recipients:[{id:'ou_bing',name:'小冰',kind:'person'}],partial:true,lastSync:1}});
 const service=createWorkspaceStateService(request as any,async()=>({accountId:'ou_me',scopes:[]}));
 expect((await service.read()).config.feishuMessageStyle).toBe('自然');expect((await service.memory({})).entries[0].query).toBe('冰哥');await service.read();expect(request.mock.calls.filter(([m])=>m==='feishu.request')).toHaveLength(2);
});
it('does not apply another accounts legacy aliases',async()=>{const request=vi.fn(async(m:string)=>m==='storage.get'?{value:null}:m==='storage.set'?{ok:true}:{accountId:'ou_other',entries:[{query:'老板',recipientId:'ou_wrong'}],config:{},feishuCatalog:{recipients:[]}});const s=createWorkspaceStateService(request as any,async()=>({accountId:'ou_me',scopes:[]}));expect((await s.memory({})).entries).toEqual([]);});
it('preserves matching legacy history and serializes concurrent appended receipts',async()=>{
 const values=new Map();const old={id:'old',prompt:'历史',text:'成功',status:'completed' as const};
 const request=vi.fn(async(m:string,p:any)=>m==='storage.get'?{value:structuredClone(values.get(p.key)??null)}:m==='storage.set'?(values.set(p.key,structuredClone(p.value)),{ok:true}):{accountId:'ou_me',entries:[],aiReplies:[old],config:{},feishuCatalog:{recipients:[]}});
 const service=createWorkspaceStateService(request as any,async()=>({accountId:'ou_me',scopes:[]}));
 expect(await service.readHistory()).toEqual([old]);
 await Promise.all([service.appendHistory({...old,id:'a'}),service.appendHistory({...old,id:'b'})]);
 expect((await service.readHistory()).map(r=>r.id).sort()).toEqual(['a','b','old']);
 expect(await service.readAliases()).toEqual([]);
});
it('rejects aliases and receipt writes after expected account changes',async()=>{
 const request=vi.fn();const service=createWorkspaceStateService(request as any,async()=>({accountId:'ou_other',scopes:[]}));
 await expect(service.readAliases('ou_me')).rejects.toThrow('账号');await expect(service.appendHistory({id:'r',prompt:'x',text:'x',status:'completed'},'ou_me')).rejects.toThrow('账号');expect(request).not.toHaveBeenCalled();
});
it('initializes defaults when the legacy capability is explicitly unsupported',async()=>{
 const values=new Map();const request=vi.fn(async(m:string,p:any)=>{if(m==='storage.get')return{value:values.get(p.key)??null};if(m==='storage.set'){values.set(p.key,p.value);return{ok:true};}throw Object.assign(Error('legacy unavailable'),{code:'unsupported_method'});});
 const service=createWorkspaceStateService(request as any,async()=>({accountId:'ou_new',scopes:[]}));
 const s=await service.read();expect(s.config.feishuMessageStyle).toBe('');expect(s.entries).toEqual([]);expect(s.enabled).toBe(false);await service.read();expect(request.mock.calls.filter(([m])=>m==='feishu.request')).toHaveLength(1);
});
it.each(['permission_denied','network_error','storage_error'])('preserves actual legacy failures %s',async(code)=>{
 const error=Object.assign(Error(code),{code});const request=vi.fn(async(m:string)=>{if(m==='storage.get')return{value:null};throw error;});
 const service=createWorkspaceStateService(request as any,async()=>({accountId:'ou_new',scopes:[]}));await expect(service.read()).rejects.toBe(error);expect(request.mock.calls.some(([m])=>m==='storage.set')).toBe(false);
});
it('does not import another accounts style, learning or legacy shortcuts',async()=>{
 const request=vi.fn(async(m:string)=>m==='storage.get'?{value:null}:m==='storage.set'?{ok:true}:{accountId:'ou_other',enabled:true,entries:[],config:{feishuTools:false,feishuMessageStyle:'private-style',pluginShortcuts:[{hotkey:'Shift+X'}]},feishuCatalog:{recipients:[]}});
 const s=await createWorkspaceStateService(request as any,async()=>({accountId:'ou_new',scopes:[]})).read();expect(s.config).toMatchObject({feishuTools:true,feishuMessageStyle:'',pluginShortcuts:[]});expect(s.enabled).toBe(false);
});
it('uses host-valid storage keys across initialization, settings, aliases and receipt history',async()=>{
 const values=new Map<string,unknown>();let accountId='ou_one';
 const request=vi.fn(async(method:string,params:any)=>{
  if(method.startsWith('storage.'))expect(params.key).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
  if(method==='storage.get')return {value:structuredClone(values.get(params.key)??null)};
  if(method==='storage.set'){values.set(params.key,structuredClone(params.value));return {ok:true};}
  throw Object.assign(Error('absent'),{code:'unsupported_method'});
 });
 const service=createWorkspaceStateService(request as any,async()=>({accountId,scopes:[]}));
 await service.read();await service.saveConfig({feishuMessageStyle:'简洁'});
 await service.saveCatalog({recipients:[{id:'ou_person',name:'同事',kind:'person'}],partial:true,lastSync:null});
 await service.memory({operation:'save',query:'同事',recipientId:'ou_person'});
 await service.appendHistory({id:'receipt',prompt:'创建',text:'成功',status:'completed'},accountId);
 expect(await service.readHistory()).toHaveLength(1);expect(await service.readAliases()).toHaveLength(1);
 accountId='ou_two';expect((await service.read()).config.feishuMessageStyle).toBe('');expect(await service.readHistory()).toEqual([]);
 accountId='ou_one';expect((await service.read()).config.feishuMessageStyle).toBe('简洁');expect(await service.readHistory()).toHaveLength(1);
});
it('rejects catalog persistence after the originating account changes',async()=>{
 const request=vi.fn();const service=createWorkspaceStateService(request as any,async()=>({accountId:'ou_other',scopes:[]}));
 await expect(service.saveCatalog({recipients:[],partial:true,lastSync:null},'ou_me')).rejects.toThrow('账号');expect(request).not.toHaveBeenCalled();
});
