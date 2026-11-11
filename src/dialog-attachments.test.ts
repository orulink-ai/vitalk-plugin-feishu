import {expect,it,vi} from 'vitest';
import {createPluginMessageDialog} from './plugin-message-dialog';
import {confirmVoiceMessage} from './voice-message-confirmation';
const image={id:'img',dataUrl:'data:image/png;base64,aGVsbG8=',width:1,height:1};
it('keeps attachment drafts in the floating confirmation',async()=>{
 const deps={confirm:vi.fn().mockRejectedValue(new DOMException('cancel','AbortError')),send:vi.fn(),show:vi.fn()};
 await expect(confirmVoiceMessage(deps,'r',{id:'d',content:'image',attachments:[image]},new AbortController().signal)).rejects.toMatchObject({name:'AbortError'});
 expect(deps.confirm.mock.calls[0][0].draft.attachments).toEqual([image]);
 expect(deps.show).not.toHaveBeenCalled();expect(deps.send).not.toHaveBeenCalled();
});
it('stages preview images and releases them after cancelling the dialog',async()=>{
 const request=vi.fn(async(method:string)=>{
  if(method==='native.status')return {installed:true};
  if(method==='files.stage')return {fileId:'f',path:'C:/staged/image.png'};
  if(method==='native.execute')return {exitCode:0,stdout:'{"confirmed":false}'};
 });
 await expect(createPluginMessageDialog(request)({requestId:'r',draft:{draftId:'d',recipientId:'',content:'image',recipients:[],attachments:[image]}})).rejects.toMatchObject({name:'AbortError'});
 expect(request.mock.calls.map(c=>c[0])).toEqual(['native.status','files.stage','native.execute','files.release']);
 const payload=JSON.parse(Buffer.from((request.mock.calls as any)[2][1].args[0],'base64').toString());
 expect(payload.attachments).toEqual([{path:'C:/staged/image.png',id:'img'}]);
 expect(JSON.stringify(payload)).not.toContain('base64');
});
