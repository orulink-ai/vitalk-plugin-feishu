const MESSAGE_SCOPES=['contact:user:search','contact:user.base:readonly','contact:contact.base:readonly','im:chat:read','im:message.send_as_user','im:message','im:resource'];
const CALENDAR_SCOPES=['calendar:calendar:read','calendar:calendar.event:create','calendar:calendar.event:update','calendar:calendar.event:delete','calendar:calendar.free_busy:read','calendar:calendar.event:read'];
export const AUTH_SCOPES=[...MESSAGE_SCOPES,'task:task:write',...CALENDAR_SCOPES];
export function authSnapshot(result:unknown){
 const raw=result as {exitCode?:number;stdout?:string};
 if(raw?.exitCode!==0||typeof raw.stdout!=='string'||raw.stdout.length>1_000_000)throw Error('无法读取飞书授权状态，请重新检查');
 let body;try{body=JSON.parse(raw.stdout);if(body?.ok===false)throw Error();body=body?.data??body;if(!body||typeof body!=='object'||body.ok===false)throw Error();}catch{throw Error('无法读取飞书授权状态，请重新检查');}
 const user=body.identities?.user;
 const logged=typeof user?.openId==='string'&&/^ou_[A-Za-z0-9_-]+$/.test(user.openId)&&user.status==='ready'&&user.tokenStatus==='valid';
 const scopes:string[]=logged&&typeof user.scope==='string'?user.scope.split(/[\s,]+/):[];
 const missingScopes=MESSAGE_SCOPES.filter(s=>!scopes.includes(s));
 const calendarMissingScopes=CALENDAR_SCOPES.filter(s=>!scopes.includes(s));
 const connected=logged&&missingScopes.length===0,taskConnected=logged&&scopes.includes('task:task:write'),calendarConnected=logged&&calendarMissingScopes.length===0;
 const allPermissionsGranted=connected&&taskConnected&&calendarConnected;
 return {connected,taskConnected,calendarConnected,allPermissionsGranted,missingScopes,calendarMissingScopes,message:allPermissionsGranted?'已连接飞书，联系人、消息、任务与日历权限已就绪；具体对象权限将在操作时校验':logged?'已登录飞书，请重新授权补齐所需权限':'请连接飞书，一次授权联系人、消息、任务与日历权限'};
}

