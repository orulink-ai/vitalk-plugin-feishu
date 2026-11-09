import {expect,it} from 'vitest';
import {parseCliAuthStatus,verifyCliLogin} from './cli-auth';

const output=(value:unknown,exitCode=0)=>({exitCode,stdout:JSON.stringify(value),stderr:'PRIVATE_TOKEN'});
const status=(patch:Record<string,unknown>={})=>({identities:{user:{openId:'ou_owner',status:'ready',tokenStatus:'valid',scope:'task:task:write, im:message.send_as_user\ncontact:user:search',access_token:'PRIVATE_TOKEN',...patch}}});
const scopes=['task:task:write','im:message.send_as_user'];

it.each([false,true])('accepts raw/wrapped status and returns only verified identity/scopes (%s)',wrapped=>{
  const raw=status();
  const result=parseCliAuthStatus(output(wrapped?{ok:true,data:raw}:raw),scopes);
  expect(result.accountId).toBe('ou_owner');
  expect(result.scopes).toEqual(['task:task:write','im:message.send_as_user','contact:user:search']);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN');
});
it.each([{status:'needs_refresh'},{tokenStatus:'expired'},{openId:''},{openId:'ou_'},{status:'not_logged_in'}])('rejects invalid credentials with a fixed safe error: %j',patch=>{
  expect(()=>parseCliAuthStatus(output(status(patch)),scopes)).toThrow('飞书登录状态无效或已过期，请重新检查连接。');
});
it('checks exact scopes instead of accepting login success or substring matches',()=>{
  expect(()=>parseCliAuthStatus(output(status({scope:'task:task:write_extra im:message.send_as_user'})),scopes)).toThrow('飞书授权缺少所需权限，请重新授权后核对。');
});
it.each([
  {exitCode:1,stdout:'PRIVATE_TOKEN',stderr:'PRIVATE_TOKEN'},
  {exitCode:0,stdout:'PRIVATE_TOKEN',stderr:''},
  output({ok:false,data:status(),error:'PRIVATE_TOKEN'}),
  output({identities:[]}),
])('rejects malformed/failed status without exposing output',result=>{
  expect(()=>parseCliAuthStatus(result,scopes)).toThrow();
  try{parseCliAuthStatus(result,scopes);}catch(error){expect(String(error)).not.toContain('PRIVATE_TOKEN');}
});
it.each([{success:true},{ok:true,data:{success:true}},{event:'authorization_complete',user_open_id:'ou_owner'}])('requires fresh status after login receipt %j',receipt=>{
  expect(verifyCliLogin(output(receipt),output(status()),scopes).accountId).toBe('ou_owner');
  expect(()=>verifyCliLogin(output(receipt),output(status({tokenStatus:'missing'})),scopes)).toThrow(/登录状态无效/);
});
it('accepts only the known exit-3 completion warning and verifies actual scopes',()=>{
  const completed=output({event:'authorization_complete',user_open_id:'ou_owner',warning:{type:'missing_scope'}},3);
  expect(verifyCliLogin(completed,output(status()),scopes).accountId).toBe('ou_owner');
  expect(()=>verifyCliLogin(completed,output(status({scope:'task:task:write'})),scopes)).toThrow(/缺少所需权限/);
  expect(()=>verifyCliLogin(output({success:true},3),output(status()),scopes)).toThrow(/未确认/);
});
it('rejects an account switch between login completion and status readback',()=>{
  expect(()=>verifyCliLogin(output({event:'authorization_complete',user_open_id:'ou_other'}),output(status()),scopes)).toThrow('飞书授权账号与当前账号不一致，请重新检查连接。');
});
it.each([{}, {ok:false,success:true}, {event:'authorization_complete'}, {success:false}])('does not infer login completion from an unrelated receipt %j',receipt=>{
  expect(()=>verifyCliLogin(output(receipt),output(status()),scopes)).toThrow(/未确认/);
});
import {CliNotAuthenticatedError} from './cli-auth';
it('distinguishes explicit unsigned status from malformed or failed status',()=>{
 expect(()=>parseCliAuthStatus(output({identities:{user:{status:'not_logged_in'}}}),[])).toThrow(CliNotAuthenticatedError);
 for(const result of [output({identities:{user:{status:'unknown'}}}),output({code:999,identities:{user:{status:'not_logged_in'}}}),output({identities:{user:{status:'not_logged_in'}}},1)]){
  try{parseCliAuthStatus(result,[]);throw Error('unexpected success');}catch(error){expect(error).not.toBeInstanceOf(CliNotAuthenticatedError);}
 }
});
