import type {Person} from './task-intent';
import type {Cli} from './task-service';
export type ContactCatalog={people:Person[];chats:{id:string;name:string;kind:'chat';active:boolean;external:boolean}[];scope:'visible';companyComplete:false;unverifiedIds:string[]};
type Options={cached?:readonly Person[]};
type SyncOptions=Options & {peopleOnly?:boolean};
type Row=Record<string,unknown>;
const flags=['is_resigned','is_exited','is_unjoin','is_frozen','is_activated'] as const;
const suffix=['--as','user','--format','json'];
const row=(value:unknown):Row|undefined=>value && typeof value==='object' && !Array.isArray(value)?value as Row:undefined;
function data(value:unknown):Row {
 const envelope=row(value);if(!envelope || envelope.ok===false || ('code' in envelope && envelope.code!==0)) throw new Error('联系人响应未确认成功');
 if(envelope.ok===true) return data(envelope.data);
 const payload=row(envelope.data);
 if(payload) {if('code' in payload || 'ok' in payload) return data(payload);return payload;}
 return envelope;
}
function id(value:unknown):value is string {return typeof value==='string' && /^ou_[A-Za-z0-9_]+$/.test(value);}
function lifecycle(item:Row):Row {return row(item.status)??item;}
function unavailable(item:Row):boolean {
 const state=lifecycle(item);return flags.slice(0,4).some(flag=>state[flag]===true)||state.is_activated===false;
}
function completeStatus(item:Row):boolean {const state=lifecycle(item);return flags.every(flag=>typeof state[flag]==='boolean');}
function text(value:unknown):string|undefined {return typeof value==='string'&&value.trim()?value.trim():undefined;}
function operation(value:string) {if(!value.trim()||value.length>256||value.includes('\0')) throw new Error('联系人操作编号无效');}
async function pages(cli:Cli,args:string[],key:string,operationId:string):Promise<Row[]> {
 const result:Row[]=[];const seen=new Set<string>();let token:string|undefined;
 for(let page=0;page<100;page++) {
  const response=data(await cli([...args,...(token?['--page-token',token]:[]),...suffix],operationId));
  if(typeof response.has_more!=='boolean'||!Array.isArray(response[key])) throw new Error('联系人分页响应无效');
  for(const item of response[key]) {const parsed=row(item);if(!parsed)throw new Error('联系人记录格式无效');result.push(parsed);}
  if(!response.has_more)return result;
  const next=text(response.page_token);if(!next||seen.has(next))throw new Error('联系人分页游标缺失或重复，请重新刷新');
  seen.add(next);token=next;
 }
 throw new Error('联系人分页未完成，请缩小搜索范围');
}
/** Visible candidates are never a company-wide roster. Cached aliases are keyed by
 * exact user ID; old active flags cannot establish current lifecycle evidence. */
async function qualify(cli:Cli,candidates:Row[],operationId:string,options:Options):Promise<Pick<ContactCatalog,'people'|'unverifiedIds'>> {
 const people=new Map<string,Person>();const excluded=new Set<string>();const verified=new Set<string>();const externalIds=new Set<string>();
 const aliases=new Map((options.cached??[]).map(person=>[person.id,person.aliases.filter(alias=>typeof alias==='string'&&alias.trim())]));
 const knownIds=new Set(candidates.map(candidate=>candidate.open_id));
 // Preserve previous user candidates, but recheck lifecycle rather than trusting
 // cached active/external flags. This matches the existing catalog refresh behavior.
 const current:Row[]=[...candidates,...(options.cached??[]).filter(person=>!knownIds.has(person.id)).map(person=>({open_id:person.id,name:person.name}))];
 for(const candidate of current) {
  if(!id(candidate.open_id))continue;
  const name=text(candidate.localized_name)??text(candidate.name);if(!name)continue;
  if(unavailable(candidate))excluded.add(candidate.open_id);
  if(candidate.is_cross_tenant===true||candidate.is_external===true)externalIds.add(candidate.open_id);
  const previous=people.get(candidate.open_id);
  people.set(candidate.open_id,{id:candidate.open_id,name,aliases:[...new Set([...(aliases.get(candidate.open_id)??[]),...(previous?.aliases??[])])],active:false,external:candidate.is_cross_tenant!==false&&candidate.is_external!==false});
  if(completeStatus(candidate)&&!unavailable(candidate))verified.add(candidate.open_id);
 }
 const ids=[...people.keys()];
 for(let start=0;start<ids.length;start+=50) {
  const batch=ids.slice(start,start+50);
  try {
   const response=data(await cli(['api','GET','/open-apis/contact/v3/users/batch','--params',JSON.stringify({user_id_type:'open_id',user_ids:batch}),...suffix],operationId));
   if(!Array.isArray(response.items))continue;
   for(const value of response.items) {
    const profile=row(value);if(!profile||!id(profile.open_id)||!batch.includes(profile.open_id))continue;
    const person=people.get(profile.open_id)!;
    if(unavailable(profile))excluded.add(profile.open_id);
    if(profile.is_cross_tenant===true||profile.is_external===true)externalIds.add(profile.open_id);
    // A complete enterprise-directory member profile is positive internal identity
    // evidence. Search activation flags alone are not employment evidence.
    if(completeStatus(profile)&&!unavailable(profile)) {verified.add(profile.open_id);person.external=profile.is_external===true;}
    else if(typeof profile.is_external==='boolean')person.external=profile.is_external;
    person.name=text(profile.name)??person.name;
   }
  } catch { /* Existing search permission provides the explicit departure fallback below. */ }
 }
 const unknown=ids.filter(member=>!verified.has(member)&&!excluded.has(member));
 for(let start=0;start<unknown.length;start+=30) {
  const batch=unknown.slice(start,start+30);let response:Row;
  try {response=data(await cli(['contact','+search-user','--user-ids',batch.join(','),'--left-organization','--page-size','30',...suffix],operationId));}
  catch {throw new Error('无法核验联系人在职状态，请检查连接或补充通讯录权限后刷新');}
  if(response.has_more!==false||!Array.isArray(response.users))throw new Error('联系人在职状态核验不完整，请刷新后重试');
  for(const value of response.users) {const member=row(value);if(!member||!id(member.open_id))throw new Error('联系人在职状态格式无效');if(batch.includes(member.open_id))excluded.add(member.open_id);}
 }
 // The departure search can exclude a returned member, but absence is not proof of active status.
 for(const member of excluded)people.delete(member);
 for(const person of people.values()){
  person.active=verified.has(person.id);
  person.external ||= externalIds.has(person.id);
 }
 const result=[...people.values()];
 return {people:result,unverifiedIds:result.filter(person=>!person.active||person.external).map(person=>person.id)};
}
export async function searchContacts(cli:Cli,query:string,operationId:string,options:Options={}):Promise<ContactCatalog> {
 operation(operationId);if(!query.trim()||[...query].length>50||query.includes('\0'))throw new Error('请输入1到50字的联系人姓名');
 // v1.0.98 returns has_more but exposes no continuation flag for this shortcut.
 const response=data(await cli(['contact','+search-user','--query',query,'--page-size','30','--exclude-external-users',...suffix],operationId));
 if(typeof response.has_more!=='boolean'||!Array.isArray(response.users))throw new Error('联系人查询响应无效');
 if(response.has_more)throw new Error('联系人查询结果过多，请补充更具体的姓名以缩小范围');
 const candidates=response.users.map(value=>{
  const candidate=row(value);
  if(!candidate)throw new Error('联系人记录格式无效');
  return candidate;
 });
 const eligible=await qualify(cli,candidates,operationId,options);
 return {...eligible,chats:[],scope:'visible',companyComplete:false};
}
export async function syncContacts(cli:Cli,operationId:string,options:SyncOptions={}):Promise<ContactCatalog> {
 operation(operationId);
 const sessions=await pages(cli,['im','+chat-list','--types',options.peopleOnly?'p2p':'p2p,group','--page-size','100'],'chats',operationId);
 const candidates:Row[]=[];const chats=new Map<string,{id:string;name:string;kind:'chat';active:boolean;external:boolean}>();
 for(const session of sessions) {
  if(session.chat_status!==undefined&&session.chat_status!=='normal')continue;
  const name=text(session.name);if(!name)continue;
  if(session.chat_mode==='p2p') {
   if(session.p2p_target_type==='user'&&id(session.p2p_target_id))candidates.push({...session,open_id:session.p2p_target_id});
  }else if(!options.peopleOnly&&session.chat_mode==='group'&&typeof session.chat_id==='string'&&/^oc_[A-Za-z0-9_]+$/.test(session.chat_id)) chats.set(session.chat_id,{id:session.chat_id,name,kind:'chat',active:false,external:true});
 }
 const eligible=await qualify(cli,candidates,operationId,options);
 for(const chat of chats.values()){
  try{
   const detail=data(await cli(['im','chats','get','--chat-id',chat.id,...suffix],operationId));
   chat.active=detail.chat_status==='normal' && detail.chat_mode==='group';
   chat.external=detail.external!==false;
  }catch{ /* Visible but unverifiable groups remain ineligible, never default internal. */ }
  if(!chat.active || chat.external)eligible.unverifiedIds.push(chat.id);
 }
 return {...eligible,chats:[...chats.values()],scope:'visible',companyComplete:false};
}

