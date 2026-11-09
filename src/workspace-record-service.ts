import {getClient} from './client';
import {createFeishuRuntime} from './feishu-runtime';
import {searchContacts,syncContacts,type ContactCatalog} from './contact-service';
import {feishuDetailUrl} from './original-workspace/workspace-receipts';
import type {FeishuCatalog} from './experiments/client';
import type {Person} from './task-intent';
import {validDate,type EventTime} from './original-workspace/workspace-calendar';

type Row = Record<string,unknown>;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const taskGrant = [['task:task:write']];
const calendarReadGrants = [
  ['calendar:calendar.calendar:readonly','calendar:calendar:readonly','calendar:calendar:read','calendar:calendar'],
  ['calendar:calendar.event:read','calendar:calendar:readonly','calendar:calendar'],
];

function row(value:unknown):Row|undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Row;
}
function text(value:unknown) { return typeof value === 'string' ? value : ''; }
function timestamp(value:unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value);
}

function recordsRuntime(signal?:AbortSignal) {
  const runtime = createFeishuRuntime((method,params,options) => {
    signal?.throwIfAborted();
    return getClient().request(method,params,signal ? {...options,signal} : options);
  });
  const readId = () => `records-read-${crypto.randomUUID()}`;
  const read = (args:string[]) => runtime.cli(args,readId());
  const call = (args:string[], operationId?:string) => runtime.cli(
    [...args,'--as','user','--format','json'],operationId ?? readId(),
  );
  async function account(grants:string[][] = []) {
    const current = await runtime.readAccount();
    if (grants.some(group => !group.some(scope => current.scopes.includes(scope)))) {
      throw new Error('飞书缺少操作所需权限，请重新授权。');
    }
    return current.accountId;
  }
  async function verifyAccount(expected:string) {
    if (await account() !== expected) throw new Error('飞书账号已变化，请刷新后再操作。');
  }
  return {read,call,account,verifyAccount};
}

function taskRow(value:unknown) {
  const task = row(value);
  const id = text(task?.guid);
  if (!task || !uuid.test(id)) throw new Error('飞书任务缺少有效标识，未显示不完整结果。');
  const completedAt = Number(timestamp(task.completed_at));
  const completed = task.status === 'done' || (Number.isFinite(completedAt) && completedAt > 0);
  const members = Array.isArray(task.members) ? task.members : [];
  const ownerIds = [...new Set(members.map(row).filter(member => member?.role === 'assignee')
    .map(member => text(member?.id)).filter(id => id.trim()))];
  return {
    id,title:text(task.summary),description:text(task.description),ownerId:ownerIds[0] ?? '',ownerIds,
    creatorId:text(row(task.creator)?.id),startTimestamp:timestamp(row(task.start)?.timestamp),
    createdAt:timestamp(task.created_at),updatedAt:timestamp(task.updated_at),completed,
    dueTimestamp:timestamp(row(task.due)?.timestamp),dueIsAllDay:row(task.due)?.is_all_day === true,
    url:feishuDetailUrl(text(task.url)) ?? `https://applink.feishu.cn/client/todo/detail?guid=${id}`,
  };
}

export async function listWorkspaceTasks({completed,pageToken}:Row,signal?:AbortSignal) {
  if ((completed !== undefined && typeof completed !== 'boolean') ||
      (pageToken !== undefined && (typeof pageToken !== 'string' || pageToken.length > 2048 || pageToken.includes('\0')))) {
    throw new Error('任务分页参数无效。');
  }
  const runtime = recordsRuntime(signal);
  const accountId = await runtime.account(taskGrant);
  const params = {type:'my_tasks',page_size:50,user_id_type:'open_id',
    ...(completed === undefined ? {} : {completed}),...(pageToken ? {page_token:pageToken} : {})};
  const data = row(await runtime.call(['task','tasks','list','--params',JSON.stringify(params)]));
  await runtime.verifyAccount(accountId);
  if (!Array.isArray(data?.items) || (data.has_more !== undefined && typeof data.has_more !== 'boolean')) {
    throw new Error('飞书任务列表格式无效，请刷新。');
  }
  const hasMore = data.has_more === true;
  const nextPageToken = hasMore ? text(data.page_token) : '';
  if (hasMore && (!nextPageToken.trim() || nextPageToken.length > 2048 || nextPageToken.includes('\0') || nextPageToken === pageToken)) {
    throw new Error('飞书任务分页信息不完整，请刷新。');
  }
  return {items:data.items.map(taskRow),accountId,hasMore,nextPageToken};
}

export async function completeWorkspaceTask({id,accountId}:Row,signal?:AbortSignal) {
  if (typeof id !== 'string' || !uuid.test(id)) throw new Error('任务标识无效，尚未提交。');
  const runtime = recordsRuntime(signal);
  const owner = await runtime.account(taskGrant);
  if (owner !== accountId) throw new Error('飞书账号已变化，请刷新任务后再操作。');
  const uncertain = {status:'uncertain',message:'完成操作尚未取得明确回执，请在飞书核对。不会自动重试。'};
  try {
    const before = checkedTask(await runtime.call(taskGet(id)),id.toLowerCase());
    await runtime.verifyAccount(owner);
    if(before.completed)return {status:'completed',message:'飞书已确认任务完成。'};
    if(!before.updatedAt)throw Error('任务缺少状态版本，请在飞书完成操作。');
    const key=await operationKey('task-complete',owner,id.toLowerCase(),before.updatedAt);
    await runtime.call(['task','+complete','--task-id',id],key);
    await runtime.verifyAccount(owner);
    const result = row(await runtime.call(['task','tasks','get','--task-guid',id,'--user-id-type','open_id']));
    await runtime.verifyAccount(owner);
    const confirmed = taskRow(result?.task);
    if (confirmed.id.toLowerCase() === id.toLowerCase() && confirmed.completed) {
      return {status:'completed',message:'飞书已确认任务完成。'};
    }
  } catch {
    return uncertain;
  }
  return uncertain;
}

export async function listWorkspaceCalendar({start,end,requireComplete}:Row,signal?:AbortSignal) {
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) || start <= 0 || end <= start || end-start > 32*86400) {
    throw new Error('日程查询时间范围无效，最多查询 32 天。');
  }
  const runtime = recordsRuntime(signal);
  const accountId = await runtime.account(calendarReadGrants);
  const calendarId = await primaryCalendar(runtime);
  await runtime.verifyAccount(accountId);
  const data = row(await runtime.call(['calendar','events','instance_view','--calendar-id',calendarId,
    '--start-time',String(start),'--end-time',String(end),'--user-id-type','open_id']));
  await runtime.verifyAccount(accountId);
  // The established instance-view contract omits items on a confirmed empty response.
  if (requireComplete && (data?.has_more === true || data?.page_token)) {
    throw new Error('日程查询结果不完整，请缩小范围后重试。');
  }
  const items = data && Object.keys(data).length === 0 ? [] : data?.items;
  if (!Array.isArray(items)) throw new Error('飞书日程列表格式无效，请刷新。');
  const events = items.map(row).filter(item => item?.status !== 'cancelled').map(eventRow);
  return {items:events,calendarId,accountId};
}

function visibleCatalog(catalog:ContactCatalog,lastSync:number|null):FeishuCatalog {
  return {lastSync,partial:true,recipients:[
    ...catalog.people.filter(person => person.active && !person.external)
      .map(({id,name})=>({id,name,kind:'person' as const})),
    ...catalog.chats.map(({id,name})=>({id,name,kind:'group' as const})),
  ]};
}

export async function searchWorkspaceContacts(query:string,cached?:readonly Person[]):Promise<FeishuCatalog> {
  const runtime = recordsRuntime();
  const owner = await runtime.account();
  const catalog = await searchContacts(runtime.read,query,'workspace-search',{cached});
  await runtime.verifyAccount(owner);
  return {...visibleCatalog(catalog,null),searchQuery:query.trim()};
}

export async function syncWorkspaceContacts(cached?:readonly Person[]):Promise<FeishuCatalog> {
  const runtime = recordsRuntime();
  const owner = await runtime.account();
  const catalog = await syncContacts(runtime.read,'workspace-sync',{cached});
  await runtime.verifyAccount(owner);
  return visibleCatalog(catalog,Date.now());
}

const uncertain = {status:'uncertain' as const,message:'飞书尚未确认操作结果。请在飞书核对，本次操作不会再次提交。'};
const unresolved = new Set<string>();
async function mutateRecord<T>(key:string,change:()=>Promise<T|undefined>) {
  if (unresolved.has(key)) return uncertain;
  unresolved.add(key);
  try {
    const confirmed = await change();
    if (confirmed) {
      unresolved.delete(key);
      return confirmed;
    }
  } catch {
    // An attempted write may already have reached Feishu.
  }
  return uncertain;
}

async function operationKey(prefix:string,...values:string[]) {
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(values)));
  return prefix + ':' + Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}

function selectedTaskId(id:unknown) {
  if (typeof id !== 'string' || !uuid.test(id)) throw new Error('任务标识无效，尚未提交。');
  return id.toLowerCase();
}
function taskGet(id:string) {
  return ['task','tasks','get','--task-guid',id,'--user-id-type','open_id'];
}
type Runtime = ReturnType<typeof recordsRuntime>;
async function selectedAccount(runtime:Runtime,expected:unknown,grants:string[][]) {
  const owner = await runtime.account(grants);
  if (owner !== expected) throw new Error('飞书账号已变化，请刷新列表后再操作。');
  return owner;
}
function checkedTask(data:unknown,id:string) {
  const task = taskRow(row(data)?.task);
  if (task.id.toLowerCase() !== id) throw new Error('飞书返回了其他任务，请刷新列表。');
  return task;
}

export async function editWorkspaceTask(input:Row,signal?:AbortSignal) {
  const id = selectedTaskId(input.id);
  const title = text(input.title).trim();
  const {description} = input;
  if (!title || title.length > 3000 || typeof description !== 'string' || description.length > 3000 ||
      title.includes('\0') || description.includes('\0')) throw new Error('任务标题或说明无效，尚未提交。');
  const runtime = recordsRuntime(signal);
  const owner = await selectedAccount(runtime,input.accountId,taskGrant);
  const get = taskGet(id);
  const key = 'task:'+owner+':'+id;
  if (unresolved.has(key)) return uncertain;
  const before = checkedTask(await runtime.call(get),id);
  const expected = row(input.expected);
  if (expected && (expected.title !== before.title || expected.description !== before.description ||
      (expected.updatedAt !== undefined && expected.updatedAt !== before.updatedAt))) {
    throw new Error('此任务已在飞书更新，请重新选择后编辑。');
  }
  if (before.title === title && before.description === description) {
    await runtime.verifyAccount(owner);
    return {status:'updated' as const,message:'飞书任务内容已核对。',task:before};
  }
  const patch = {summary:title,description};
  const operationId = await operationKey('task-edit',owner,id,text(input.operationId),before.updatedAt,before.title,before.description,title,description);
  await selectedAccount(runtime,owner,taskGrant);
  return mutateRecord(key,async()=>{
    await runtime.call(['task','tasks','patch','--task-guid',id,'--user-id-type','open_id','--data',
      JSON.stringify({task:patch,update_fields:Object.keys(patch)})],operationId);
    await runtime.verifyAccount(owner);
    const task = checkedTask(await runtime.call(get),id);
    await runtime.verifyAccount(owner);
    if (task.title === title && task.description === description) {
      return {status:'updated' as const,message:'飞书已确认任务修改。',task};
    }
  });
}

async function deletionReadback(args:string[],codes:readonly number[],signal?:AbortSignal,cancelled?:(data:unknown)=>boolean) {
  signal?.throwIfAborted();
  const receipt = row(await getClient().request('native.execute',{
    dependencyId:'lark-cli',args:[...args,'--as','user','--format','json'],operationId:'records-read-'+crypto.randomUUID(),
  },{timeoutMs:675_000,signal}));
  if (receipt?.exitCode === 0 && cancelled && typeof receipt.stdout === 'string') {
    const result = row(JSON.parse(receipt.stdout));
    return result?.ok === true && cancelled(result.data);
  }
  if (typeof receipt?.exitCode !== 'number' || receipt.exitCode === 0 || typeof receipt.stderr !== 'string') return false;
  const result = row(JSON.parse(receipt.stderr));
  const failure = row(result?.error);
  return result?.ok === false && result.identity === 'user' &&
    typeof failure?.code === 'number' && codes.includes(failure.code);
}

export async function deleteWorkspaceTask(input:Row,signal?:AbortSignal) {
  const id = selectedTaskId(input.id);
  const runtime = recordsRuntime(signal);
  const owner = await selectedAccount(runtime,input.accountId,taskGrant);
  const key = 'task:'+owner+':'+id;
  if (unresolved.has(key)) return uncertain;
  const get = taskGet(id);
  checkedTask(await runtime.call(get),id);
  const operationId = await operationKey('task-delete',owner,id);
  await selectedAccount(runtime,owner,taskGrant);
  return mutateRecord(key,async()=>{
    await runtime.call(['task','tasks','delete','--task-guid',id,'--yes'],operationId);
    await runtime.verifyAccount(owner);
    const absent = await deletionReadback(get,[1470404],signal);
    await runtime.verifyAccount(owner);
    if (absent) return {status:'deleted' as const,message:'飞书已确认删除任务。'};
  });
}

const calendarDeleteGrants = [...calendarReadGrants,
  ['calendar:calendar','calendar:calendar.event:writeonly','calendar:calendar.event:delete'],
];

const calendarEditGrants = [...calendarReadGrants, ['calendar:calendar','calendar:calendar.event:update']];
const oneTimeId = /^[A-Za-z0-9_-]{1,120}_0$/;

function eventRow(event:Row|undefined) {
  const id = text(event?.event_id), start = row(event?.start_time), end = row(event?.end_time);
  if (!id.trim() || !start || !end) throw new Error('飞书日程字段不完整。');
  return {
    id,title:text(event?.summary),description:eventDescription(event),start:displayTime(start),end:displayTime(end),
    url:feishuDetailUrl(text(event?.app_link)) ?? '',
    editable:oneTimeId.test(id) && event?.is_exception !== true && !event?.recurrence,
  };
}
function eventDescription(event:Row|undefined) {
  return text(event?.description_rich) || text(event?.description);
}
function displayTime(time:Row):EventTime {
  return {
    ...(text(time.date) ? {date:text(time.date)} : {}),
    ...(timestamp(time.timestamp) ? {timestamp:timestamp(time.timestamp)} : {}),
    ...(text(time.timezone) ? {timezone:text(time.timezone)} : {}),
  };
}
function requestedTime(value:unknown):EventTime {
  const time = row(value);
  if (typeof time?.date === 'string' && validDate(time.date) && time.timestamp === undefined) return {date:time.date};
  if (typeof time?.timestamp === 'string' && /^[1-9]\d{0,10}$/.test(time.timestamp) && time.date === undefined) {
    return {timestamp:time.timestamp};
  }
  throw new Error('日程日期或时间无效，尚未提交。');
}
function sameTime(a:EventTime,b:EventTime) {
  return a.date ? a.date === b.date : !b.date && a.timestamp === b.timestamp;
}

async function selectedEvent(input:Row,grants:string[][],signal?:AbortSignal) {
  const {id,calendarId} = input;
  if (typeof id !== 'string' || !oneTimeId.test(id) ||
      typeof calendarId !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_@.:-]{0,255}$/.test(calendarId)) {
    throw new Error('此日程不是可在此处操作的单次日程，请在飞书核对。');
  }
  const runtime = recordsRuntime(signal);
  const owner = await selectedAccount(runtime,input.accountId,grants);
  const key = JSON.stringify(['event',owner,calendarId,id]);
  const target = ['--calendar-id',calendarId,'--event-id',id];
  return {id,calendarId,runtime,owner,key,target,get:['calendar','events','get',...target]};
}
type SelectedEvent = Awaited<ReturnType<typeof selectedEvent>>;
function checkedEvent(data:unknown,id:string) {
  const event = row(row(data)?.event);
  if (event?.event_id !== id || event.status === 'cancelled') throw new Error('飞书未返回该日程，请刷新列表。');
  if (event.is_exception === true || event.recurrence) throw new Error('请在飞书中处理重复日程。');
  return event;
}
async function loadSelectedEvent({runtime,owner,calendarId,get,id}:SelectedEvent) {
  if (await primaryCalendar(runtime) !== calendarId) throw new Error('飞书主日历已变化，请刷新列表。');
  await runtime.verifyAccount(owner);
  return checkedEvent(await runtime.call(get),id);
}

export async function readWorkspaceEventForEdit(input:Row,signal?:AbortSignal) {
  const selected = await selectedEvent(input,calendarEditGrants,signal);
  const event = eventRow(await loadSelectedEvent(selected));
  await selected.runtime.verifyAccount(selected.owner);
  return event;
}

export async function editWorkspaceEvent(input:Row,signal?:AbortSignal) {
  const title = text(input.title).trim();
  const {description} = input;
  if (!title || title.length > 1000 || typeof description !== 'string' || description.length > 8000 ||
      title.includes('\0') || description.includes('\0')) throw new Error('日程标题或说明无效，尚未提交。');
  const start = requestedTime(input.start), end = requestedTime(input.end);
  if (start.date ? !end.date || end.date < start.date : !!end.date || Number(end.timestamp) <= Number(start.timestamp)) {
    throw new Error('日程结束时间应晚于开始时间，尚未提交。');
  }
  const selected = await selectedEvent(input,calendarEditGrants,signal);
  const {id,runtime,owner,key,calendarId,target,get} = selected;
  if (unresolved.has(key)) return uncertain;
  const original = await loadSelectedEvent(selected);
  const before = eventRow(original);
  const expected = row(input.expected);
  if (expected && (expected.title !== before.title || expected.description !== before.description ||
      !sameTime(before.start,requestedTime(expected.start)) || !sameTime(before.end,requestedTime(expected.end)))) {
    throw new Error('此日程已在飞书更新，请重新打开编辑。');
  }
  if (!!before.start.date !== !!start.date || !!before.end.date !== !!end.date) {
    throw new Error('请在飞书中切换全天或定时日程。');
  }
  const patch:Row = {};
  if (before.title !== title) patch.summary = title;
  if (before.description !== description) patch.description_rich = description;
  if (!sameTime(before.start,start) || !sameTime(before.end,end)) {
    patch.start_time = {...start,...(before.start.timezone ? {timezone:before.start.timezone} : {})};
    patch.end_time = {...end,...(before.end.timezone ? {timezone:before.end.timezone} : {})};
  }
  if (!Object.keys(patch).length) {
    await runtime.verifyAccount(owner);
    return {status:'eventUpdated' as const,message:'飞书日程内容已核对。',event:before};
  }
  const operationId = await operationKey('calendar-edit',owner,calendarId,id,text(input.operationId),
    JSON.stringify([before.title,before.description,before.start,before.end]),JSON.stringify(patch));
  await selectedAccount(runtime,owner,calendarEditGrants);
  return mutateRecord(key,async()=>{
    await runtime.call(['calendar','events','patch',...target,'--data',JSON.stringify(patch)],operationId);
    await runtime.verifyAccount(owner);
    const event = eventRow(checkedEvent(await runtime.call(get),id));
    await runtime.verifyAccount(owner);
    if (event.title === title && event.description === description && sameTime(event.start,start) && sameTime(event.end,end)) {
      return {status:'eventUpdated' as const,message:'飞书已确认日程修改。',event};
    }
  });
}

export async function deleteWorkspaceEvent(input:Row,signal?:AbortSignal) {
  const selected = await selectedEvent(input,calendarDeleteGrants,signal);
  const {id,runtime,owner,key,calendarId,target,get} = selected;
  if (unresolved.has(key)) return uncertain;
  await loadSelectedEvent(selected);
  const operationId = await operationKey('calendar-delete',owner,calendarId,id);
  await selectedAccount(runtime,owner,calendarDeleteGrants);
  return mutateRecord(key,async()=>{
    // The shortcut rechecks recurrence and requires an explicit series scope.
    await runtime.call(['calendar','+delete',...target,'--yes'],operationId);
    await runtime.verifyAccount(owner);
    const absent = await deletionReadback(get,[193001,193003],signal,data=>{
      const current = row(row(data)?.event);
      return current?.event_id === id && current.status === 'cancelled';
    });
    await runtime.verifyAccount(owner);
    if (absent) return {status:'deleted' as const,message:'飞书已确认删除日程。'};
  });
}

async function primaryCalendar(runtime:Runtime) {
  const primary = row(await runtime.call(['calendar','calendars','primary']));
  const calendars = Array.isArray(primary?.calendars) ? primary.calendars : [];
  const eligible = calendars.map(item => row(row(item)?.calendar))
    .filter(calendar => calendar && calendar.is_deleted !== true && calendar.is_third_party !== true);
  const calendarId = text(eligible[0]?.calendar_id);
  if (eligible.length !== 1 || !/^[A-Za-z0-9_][A-Za-z0-9_@.:-]{0,255}$/.test(calendarId)) {
    throw new Error('未取得唯一的有效主日历。');
  }
  return calendarId;
}
