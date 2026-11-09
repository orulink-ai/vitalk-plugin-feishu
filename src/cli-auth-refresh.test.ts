import {expect,it,vi} from 'vitest';
import {readFreshCliStatus} from './cli-auth-refresh';
import {parseCliAuthStatus} from './cli-auth';
const receipt=(state='ready',id='ou_self',token=state==='ready'?'valid':state)=>({exitCode:0,stdout:JSON.stringify({identities:{user:{openId:id,status:state,tokenStatus:token,scope:'task:task:write'}}})});
it('refreshes a refreshable token with one read-only request and verifies fresh status',async()=>{
 const run=vi.fn().mockResolvedValueOnce(receipt('needs_refresh')).mockResolvedValueOnce({exitCode:0,stdout:'{"code":0}'}).mockResolvedValueOnce(receipt());
 expect(parseCliAuthStatus(await readFreshCliStatus(run),[]).accountId).toBe('ou_self');
 expect(run.mock.calls.map(x=>x[0])).toEqual([['auth','status','--json'],['api','GET','/open-apis/authen/v1/user_info','--as','user','--format','json'],['auth','status','--json']]);
});
it('does not probe healthy or revoked credentials',async()=>{
 for(const state of ['ready','revoked']){const raw=receipt(state);const run=vi.fn().mockResolvedValue(raw);expect(await readFreshCliStatus(run)).toBe(raw);expect(run).toHaveBeenCalledTimes(1);}
});
it.each([receipt('needs_refresh'),receipt('ready','ou_other')])('rejects an unfinished refresh or account switch',async fresh=>{
 const run=vi.fn().mockResolvedValueOnce(receipt('needs_refresh')).mockResolvedValueOnce({exitCode:0,stdout:'{"code":0}'}).mockResolvedValueOnce(fresh);
 await expect(readFreshCliStatus(run)).rejects.toThrow();expect(run).toHaveBeenCalledTimes(3);
});
it('does not retry a failed refresh',async()=>{
 const run=vi.fn().mockResolvedValueOnce(receipt('needs_refresh')).mockResolvedValueOnce({exitCode:1,stdout:'{"code":999}'});
 await expect(readFreshCliStatus(run)).rejects.toThrow();expect(run).toHaveBeenCalledTimes(2);
});
it('accepts a successful enveloped read receipt but rejects nested failures',async()=>{
 const run=vi.fn().mockResolvedValueOnce(receipt('needs_refresh')).mockResolvedValueOnce({exitCode:0,stdout:'{"ok":true,"data":{"name":"self"}}'}).mockResolvedValueOnce(receipt());
 expect(parseCliAuthStatus(await readFreshCliStatus(run),[]).accountId).toBe('ou_self');
 const fail=vi.fn().mockResolvedValueOnce(receipt('needs_refresh')).mockResolvedValueOnce({exitCode:0,stdout:'{"ok":true,"data":{"code":999}}'});
 await expect(readFreshCliStatus(fail)).rejects.toThrow();expect(fail).toHaveBeenCalledTimes(2);
});
