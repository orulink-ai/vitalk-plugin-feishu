import {expect,it,vi} from 'vitest';
import {createCliAuthService} from './cli-auth-service';
const raw=(data:unknown,exitCode=0)=>({exitCode,stdout:JSON.stringify(data)});
const begin=raw({verification_url:'https://accounts.feishu.cn/auth?code=public',device_code:'private-code',expires_in:600});
const status=raw({identities:{user:{openId:'ou_me',status:'ready',tokenStatus:'valid',scope:'im:message'}}});
it('keeps device code private and checks fresh status after completion',async()=>{
 const request=vi.fn().mockResolvedValueOnce(begin).mockResolvedValueOnce(raw({event:'authorization_complete',user_open_id:'ou_me'})).mockResolvedValueOnce(status);
 const service=createCliAuthService(request,['im:message'],async()=> 'data:image/png;base64,test');
 const flow=await service.startLogin();expect(JSON.stringify(flow)).not.toContain('private-code');
 expect(await service.complete(flow.flowId)).toEqual({accountId:'ou_me',scopes:['im:message']});
 expect(request.mock.calls[1][1].args).toContain('--device-code');expect(request.mock.calls[2][1].args).toEqual(['auth','status','--json']);
 await expect(service.complete(flow.flowId)).rejects.toThrow('不存在');
});
it('rejects untrusted authorization URLs before rendering QR',async()=>{
 const qr=vi.fn();const service=createCliAuthService(vi.fn().mockResolvedValue(raw({verification_url:'https://feishu.cn.evil.test/a',device_code:'private'})),[],qr);
 await expect(service.startLogin()).rejects.toThrow('官方');expect(qr).not.toHaveBeenCalled();
});
it('does not treat successful login as permission grant',async()=>{
 const request=vi.fn().mockResolvedValueOnce(begin).mockResolvedValueOnce(raw({success:true})).mockResolvedValueOnce(status);
 const service=createCliAuthService(request,['calendar:calendar.event:create'],async()=> '');const flow=await service.startLogin();
 await expect(service.complete(flow.flowId)).rejects.toThrow('缺少');
});
it('cancellation removes private flow and prevents later completion',async()=>{
 const request=vi.fn().mockResolvedValueOnce(begin);const service=createCliAuthService(request,[],async()=> '');const flow=await service.startLogin();
 service.cancel();await expect(service.complete(flow.flowId)).rejects.toThrow('不存在');expect(request).toHaveBeenCalledTimes(1);
});
it('refuses expired flows',async()=>{
 let now=0;const service=createCliAuthService(vi.fn().mockResolvedValueOnce(begin),[],async()=> '',()=>now);const flow=await service.startLogin();now=601000;
 await expect(service.complete(flow.flowId)).rejects.toThrow('过期');
});
it('restores only public pending authorization in status snapshots and clears it on cancel',async()=>{
 const request=vi.fn().mockResolvedValueOnce(begin).mockResolvedValue(status).mockResolvedValue(status);
 const service=createCliAuthService(request,['im:message'],async()=> 'data:image/png;base64,test');const flow=await service.startLogin();
 expect((await service.snapshot()).pendingAuthorization).toEqual(flow);
 service.cancel();expect((await service.snapshot()).pendingAuthorization).toBeUndefined();
});
