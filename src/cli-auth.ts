/** Pure CLI receipt validation. Never returns credentials or provider diagnostics.
 * The caller owns command execution, fresh status reads and operation identities.
 * No login, refresh, persistence or UI is performed by this module.
 */
export type CliAuthStatus={accountId:string;scopes:string[]};
const UNCONFIRMED='飞书未确认授权操作结果，请重新检查连接。';
const INVALID='飞书登录状态无效或已过期，请重新检查连接。';
export class CliNotAuthenticatedError extends Error { constructor(){super(INVALID);this.name='CliNotAuthenticatedError';} }
const MISSING='飞书授权缺少所需权限，请重新授权后核对。';
function record(value:unknown):Record<string,unknown> {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function identity(value:unknown):value is string {
  return typeof value==='string'&&/^ou_[A-Za-z0-9_-]+$/.test(value);
}
function decode(result:unknown) {
  const output=record(result);
  if(typeof output.stdout!=='string'||output.stdout.length>1_000_000)throw new Error(UNCONFIRMED);
  let parsed:unknown;
  try{parsed=JSON.parse(output.stdout);}catch{throw new Error(UNCONFIRMED);}
  if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))throw new Error(UNCONFIRMED);
  const raw=record(parsed);
  if(raw.ok===false || ('code' in raw && raw.code!==0))throw new Error(UNCONFIRMED);
  const data=raw.data;
  const body=data!==null&&typeof data==='object'&&!Array.isArray(data)?record(data):raw;
  if(body.ok===false || ('code' in body && body.code!==0))throw new Error(UNCONFIRMED);
  return {exitCode:output.exitCode,body,envelope:raw};
}
/** Required scopes are explicit per operation; a successful login is not a grant. */
export function parseCliAuthStatus(result:unknown,requiredScopes:readonly string[]):CliAuthStatus {
  const {exitCode,body}=decode(result);
  if(exitCode!==0)throw new Error(UNCONFIRMED);
  const user=record(record(body.identities).user);
  if(user.status==='not_logged_in' && !user.openId)throw new CliNotAuthenticatedError();
  if(!identity(user.openId)||user.status!=='ready'||user.tokenStatus!=='valid')throw new Error(INVALID);
  const scopes=typeof user.scope==='string'?[...new Set(user.scope.split(/[\s,]+/).filter(Boolean))]:[];
  if(requiredScopes.some(scope=>!scope||!scopes.includes(scope)))throw new Error(MISSING);
  return {accountId:user.openId,scopes};
}
/** freshStatusResult MUST come from auth status read after this login completed.
 * The known missing_scope warning (exit 3) is only a prompt to verify actual
 * grants; it cannot by itself authorize any action. QR creation is not login.
 */
export function verifyCliLogin(loginResult:unknown,freshStatusResult:unknown,requiredScopes:readonly string[]):CliAuthStatus {
  const {exitCode,body}=decode(loginResult);
  const completion=body.event==='authorization_complete'&&identity(body.user_open_id);
  const warning=completion&&record(body.warning).type==='missing_scope';
  if(!((exitCode===0&&(body.success===true||completion))||(exitCode===3&&warning)))throw new Error(UNCONFIRMED);
  const status=parseCliAuthStatus(freshStatusResult,requiredScopes);
  if(body.user_open_id!==undefined&&body.user_open_id!==status.accountId)throw new Error('飞书授权账号与当前账号不一致，请重新检查连接。');
  return status;
}

/** Only an explicitly refreshable, identified session may trigger a read probe. */
export function refreshableCliAccount(result:unknown):string|undefined {
 const {exitCode,body}=decode(result);
 if(exitCode!==0)throw new Error(UNCONFIRMED);
 const user=record(record(body.identities).user);
 return identity(user.openId)&&user.status==='needs_refresh'&&user.tokenStatus==='needs_refresh'?user.openId:undefined;
}
export function verifyCliReadReceipt(result:unknown):void {
 const {exitCode,body,envelope}=decode(result);
 if(exitCode!==0 || !(envelope.ok===true || envelope.code===0 || body.ok===true || body.code===0))throw new Error(UNCONFIRMED);
}

