import {expect,it,vi} from 'vitest';
import {readMessageRecipient,searchContacts,syncContacts} from './contact-service';
it('reads group details with bounded concurrency while retaining order and failed groups as ineligible',async()=>{
 const waiting:(()=>void)[]=[];
 let active=0,peak=0;
 const cli=vi.fn(async(args:string[])=>{
  if(args[1]!=='chats')return {chats:Array.from({length:9},(_,i)=>({chat_mode:'group',chat_id:`oc_${i}`,name:`群${i}`})),has_more:false};
  active++;peak=Math.max(peak,active);
  await new Promise<void>(resolve=>waiting.push(resolve));active--;
  if(args.includes('oc_2'))throw Error('unavailable');
  return {external:false,chat_status:'normal',chat_mode:'group'};
 });
 const pending=syncContacts(cli,'parallel-groups');
 let initial=0;
 for(let round=0;round<12;round++){
  for(let tick=0;tick<10;tick++)await Promise.resolve();
  if(round===0)initial=active;
  waiting.splice(0).forEach(resolve=>resolve());
 }
 const result=await pending;
 expect(initial).toBe(4);
 expect(peak).toBe(4);
 expect(result.chats.map(chat=>chat.id)).toEqual(Array.from({length:9},(_,i)=>`oc_${i}`));
 expect(result.unverifiedIds).toEqual(['oc_2']);
 expect(result.chats[2]).toMatchObject({active:false,external:true});
});
const status={is_activated:true,is_resigned:false,is_exited:false,is_unjoin:false,is_frozen:false};
it('pages chats, preserves aliases and excludes departed members using batch lifecycle',async()=>{
 const cli=vi.fn(async(args:string[])=>{
  if(args[1]==='chats')return {external:false,chat_status:'normal',chat_mode:'group'};
  if(args[0]==='api') return {data:{items:[{open_id:'ou_ice',name:'阳晓冰',status},{open_id:'ou_left',status:{...status,is_resigned:true}}]}};
  return args.includes('--page-token') ? {chats:[{chat_mode:'group',chat_id:'oc_team',name:'团队'}],has_more:false} : {chats:[{chat_mode:'p2p',p2p_target_type:'user',p2p_target_id:'ou_ice',name:'小冰'},{chat_mode:'p2p',p2p_target_type:'user',p2p_target_id:'ou_left',name:'已离职'}],has_more:true,page_token:'next'};
 });
 const result=await syncContacts(cli,'contacts',{cached:[{id:'ou_ice',name:'阳晓冰',aliases:['小冰'],active:true,external:false}]});
 expect(result.people).toEqual([{id:'ou_ice',name:'阳晓冰',aliases:['小冰'],active:true,external:false}]);
 expect(result.chats).toEqual([{id:'oc_team',name:'团队',kind:'chat',active:true,external:false}]);
 expect(result.companyComplete).toBe(false);
 expect(cli.mock.calls.some(([args])=>args.includes('--left-organization'))).toBe(false);
});
it('uses explicit resignation search fallback when batch scope is unavailable',async()=>{
 const cli=vi.fn(async(args:string[])=>{
  if(args[0]==='api') throw new Error('scope');
  if(args.includes('--left-organization')) return {users:[{open_id:'ou_left'}],has_more:false};
  return {users:[{open_id:'ou_ice',localized_name:'阳晓冰',is_activated:true,is_external:false},{open_id:'ou_left',name:'旧同事'}],has_more:false};
 });
 expect((await searchContacts(cli,'小冰','search')).people.map(p=>p.id)).toEqual(['ou_ice']);
 expect(cli.mock.calls.some(([args])=>args.includes('--left-organization'))).toBe(true);
});
it('never treats missing lifecycle or partial fallback as active',async()=>{
 const cli=vi.fn(async(args:string[])=>args[0]==='api'?{items:[]}:args.includes('--left-organization')?{users:[],has_more:true}:{users:[{open_id:'ou_ice',name:'小冰'}],has_more:false});
 await expect(searchContacts(cli,'小冰','search')).rejects.toThrow('在职状态');
});
it('rejects repeated chat-list pagination cursors',async()=>{
 const cli=vi.fn().mockResolvedValue({chats:[],has_more:true,page_token:'same'});
 await expect(syncContacts(cli,'sync')).rejects.toThrow('游标');
 expect(cli).toHaveBeenCalledTimes(2);
});
it('rejects malformed response and empty query without executing mutations',async()=>{
 const cli=vi.fn().mockResolvedValue({code:999,data:{users:[],has_more:false}});
 await expect(searchContacts(cli,'小冰','search')).rejects.toThrow('响应');
 await expect(searchContacts(cli,'','search')).rejects.toThrow('姓名');
 expect(cli).toHaveBeenCalledTimes(1);
});
it('retains unknown internal identity as ineligible instead of defaulting external false',async()=>{
 const cli=vi.fn(async(args:string[])=>args[0]==='api'?{items:[]}:args.includes('--left-organization')?{users:[],has_more:false}:{users:[{open_id:'ou_unknown',name:'陌生人',is_activated:true}],has_more:false});
 const result=await searchContacts(cli,'陌生人','lookup');
 expect(result.people[0]).toMatchObject({id:'ou_unknown',external:true});
 expect(result.unverifiedIds).toEqual(['ou_unknown']);
});
it('batches profile requests and preserves unambiguous identity across pages',async()=>{
 const users=Array.from({length:51},(_,i)=>({open_id:`ou_${i}`,name:`同事${i}`}));
 const cli=vi.fn(async(args:string[])=>{
  if(args[0]==='api') {const params=JSON.parse(args[args.indexOf('--params')+1]);return {items:params.user_ids.map((open_id:string)=>({open_id,status}))};}
    const chats=users.map(user=>({chat_mode:'p2p',p2p_target_type:'user',p2p_target_id:user.open_id,name:user.name}));
  return args.includes('--page-token')?{chats:chats.slice(30),has_more:false}:{chats:chats.slice(0,30),has_more:true,page_token:'second'};
 });
 const result=await syncContacts(cli,'sync');
 expect(result.people).toHaveLength(51);
 expect(result.people.every(person=>person.active&&!person.external)).toBe(true);
 expect(cli.mock.calls.filter(([args])=>args[0]==='api')).toHaveLength(2);
});

it('rechecks cached users and drops newly departed users instead of retaining stale active flags',async()=>{
 const cli=vi.fn(async(args:string[])=>args[0]==='api'?{items:[{open_id:'ou_old',status:{...status,is_resigned:true}}]}:{chats:[],has_more:false});
 const result=await syncContacts(cli,'refresh',{cached:[{id:'ou_old',name:'旧同事',aliases:['老同事'],active:true,external:false}]});
 expect(result.people).toEqual([]);
});
it.each([{external:true,chat_status:'normal',chat_mode:'group'},{chat_status:'normal',chat_mode:'group'},{external:false,chat_status:'dissolved',chat_mode:'group'},null])('does not qualify visible groups without current internal active evidence %j',async(profile)=>{
 const cli=vi.fn(async(args:string[])=>{if(args[1]==='chats'){if(profile===null)throw Error('permission');return profile;}return {chats:[{chat_mode:'group',chat_id:'oc_team',name:'团队'}],has_more:false};});
 const result=await syncContacts(cli,'groups');
 expect(result.chats[0].active && !result.chats[0].external).toBe(false);
 expect(result.unverifiedIds).toContain('oc_team');
});
it('verifies current internal group detail before allowing a visible group',async()=>{
 const cli=vi.fn(async(args:string[])=>args[1]==='chats'?{external:false,chat_status:'normal',chat_mode:'group'}:{chats:[{chat_mode:'group',chat_id:'oc_team',name:'团队'}],has_more:false});
 expect((await syncContacts(cli,'groups')).chats[0]).toMatchObject({active:true,external:false});
 expect(cli).toHaveBeenCalledWith(['im','chats','get','--chat-id','oc_team','--as','user','--format','json'],'groups');
});

it('does not mark a status-less internal contact active when absent from departed search results',async()=>{
 const cli=vi.fn(async(args:string[])=>args[0]==='api'?{items:[]}:
  args.includes('--left-organization')?{users:[],has_more:false}:
  {users:[{open_id:'ou_unverified',name:'待核验联系人',is_external:false}],has_more:false});
 const result=await searchContacts(cli,'待核验联系人','lookup');
 expect(result.people).toMatchObject([{id:'ou_unverified',active:false,external:false}]);
 expect(result.unverifiedIds).toEqual(['ou_unverified']);
});

it('uses the v1.0.98 search flags and refuses to page an overbroad name',async()=>{
 const cli=vi.fn(async(args:string[])=>{
  expect(args).toEqual(['contact','+search-user','--query','张三','--page-size','30','--exclude-external-users','--as','user','--format','json']);
  return {users:[{open_id:'ou_zhang',localized_name:'张三',is_cross_tenant:false}],has_more:true};
 });
 await expect(searchContacts(cli,'张三','search')).rejects.toThrow(/缩小/);
 expect(cli).toHaveBeenCalledOnce();
});
it('does not qualify a CLI search hit explicitly marked cross-tenant',async()=>{
 const cli=vi.fn(async(args:string[])=>args[0]==='api'?{items:[{open_id:'ou_cross',status}]}:
   {users:[{open_id:'ou_cross',localized_name:'同名',is_cross_tenant:true}],has_more:false});
 const result=await searchContacts(cli,'同名','search');
 expect(result.people.some(person=>person.active&&!person.external)).toBe(false);
});

it('revalidates only the selected person without enumerating chats',async()=>{
 const cli=vi.fn(async()=>({data:{items:[{open_id:'ou_ice',name:'阳晓冰',status}]}}));
 const result=await readMessageRecipient(cli,{id:'ou_ice',name:'小冰',kind:'person',aliases:[],active:true,external:false},'selected-person');
 expect(result).toMatchObject({id:'ou_ice',kind:'person',active:true,external:false});
 expect(cli).toHaveBeenCalledTimes(1);
 const args=cli.mock.calls[0] as unknown as [string[],string];
 expect(args[0][0]).toBe('api');
 expect(args[0].join(' ')).toContain('ou_ice');
});
it('rejects a departed selected person even when cached as active',async()=>{
 const cli=vi.fn(async()=>({data:{items:[{open_id:'ou_ice',status:{...status,is_resigned:true}}]}}));
 expect(await readMessageRecipient(cli,{id:'ou_ice',name:'小冰',kind:'person',aliases:[],active:true,external:false},'departed')).toBeUndefined();
});
it('revalidates only the selected group and excludes external groups',async()=>{
 const cli=vi.fn(async()=>({data:{name:'团队',external:true,chat_status:'normal',chat_mode:'group'}}));
 expect(await readMessageRecipient(cli,{id:'oc_team',name:'团队',kind:'group',aliases:[],active:true,external:false},'selected-group')).toMatchObject({external:true});
 expect(cli).toHaveBeenCalledTimes(1);
 expect(cli.mock.calls[0]).toEqual([['im','chats','get','--chat-id','oc_team','--as','user','--format','json'],'selected-group']);
});
