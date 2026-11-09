import {expect,it,vi} from 'vitest';
import {uploadMessageAttachments} from './message-attachments';
it('stages PNGs, uploads with literal path, creates rich post and always releases',async()=>{
 const request=vi.fn(async(m:string)=>m==='files.stage'?{fileId:'file',path:'input/file.png',expiresAt:123}:{ok:true});
 const cli=vi.fn(async(_args:string[],_id:string)=>({image_key:'img_ok'}));
 const args=await uploadMessageAttachments(request as any,cli,'draft','hello',[{id:'a',dataUrl:'data:image/png;base64,iVBORw0KGgo=',width:1,height:1}],async()=>{});
 expect(args[0]).toBe('--msg-type');expect(args[1]).toBe('post');expect(JSON.parse(args[3]).zh_cn.content).toEqual([[{tag:'text',text:'hello'}],[{tag:'img',image_key:'img_ok'}]]);
 expect(cli.mock.calls[0][0]).toContain('input/file.png');expect(request.mock.calls.map(x=>x[0])).toEqual(['files.stage','files.release']);
});
it('cleans staged file on upload failure and rejects invalid image before requests',async()=>{
 const request=vi.fn(async(_method:string,_params:any)=>({fileId:'f',path:'input/f.png'}));const cli=vi.fn(async()=>{throw Error('failed')});
 await expect(uploadMessageAttachments(request as any,cli,'draft','hello',[{id:'a',dataUrl:'data:image/png;base64,iVBORw0KGgo=',width:1,height:1}],async()=>{})).rejects.toThrow('failed');expect(request.mock.calls[1][0]).toBe('files.release');
 request.mockClear();await expect(uploadMessageAttachments(request as any,cli,'draft','hello',[{id:'a',dataUrl:'file:///secret',width:1,height:1}],async()=>{})).rejects.toThrow('PNG');expect(request).not.toHaveBeenCalled();
});
