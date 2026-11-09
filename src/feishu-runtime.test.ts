import {expect,it,vi} from 'vitest';
import {createFeishuRuntime} from './feishu-runtime';
const status={exitCode:0,stdout:JSON.stringify({identities:{user:{openId:'ou_self',status:'ready',tokenStatus:'valid',scope:'task:task:write'}}})};
it('reads live auth through plugin CLI, not desktop Feishu actions',async()=>{
 const request=vi.fn().mockResolvedValue(status);
 const runtime=createFeishuRuntime(request);
 expect(await runtime.readAccount()).toEqual({accountId:'ou_self',scopes:['task:task:write']});
 expect(request).toHaveBeenCalledWith('native.execute',expect.objectContaining({dependencyId:'lark-cli',args:['auth','status','--json']}),expect.anything());
});
it('uses distinct operation identities for fresh reads',async()=>{
 const request=vi.fn().mockResolvedValue(status);const runtime=createFeishuRuntime(request);
 await runtime.readAccount();await runtime.readAccount();
 expect(request.mock.calls[0][1].operationId).not.toBe(request.mock.calls[1][1].operationId);
});
it('builds literal API arguments and unwraps confirmed data',async()=>{
 const request=vi.fn().mockResolvedValue({exitCode:0,stdout:JSON.stringify({ok:true,data:{items:[]}})});
 const runtime=createFeishuRuntime(request);
 expect(await runtime.readApi('/open-apis/contact/v3/users',{department_id:'0'},'bot')).toEqual({items:[]});
 expect(request.mock.calls[0][1].args).toEqual(['api','GET','/open-apis/contact/v3/users','--params','{"department_id":"0"}','--as','bot','--format','json']);
});
it.each(['https://attacker.test','/other','/open-apis/../secrets'])('rejects non-API paths %s',async path=>{
 const request=vi.fn();const runtime=createFeishuRuntime(request);
 await expect(runtime.readApi(path,{},'user')).rejects.toThrow();expect(request).not.toHaveBeenCalled();
});
