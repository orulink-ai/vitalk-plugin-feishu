import {expect,it,vi} from 'vitest';
import {createPluginMessageDialog} from './plugin-message-dialog';

const input={requestId:'voice-1',draft:{draftId:'draft-1',recipientId:'ou_1',content:'带电脑过来',recipients:[{id:'ou_1',name:'小冰'}]}};
it('passes account-scoped history into the independent confirmation window',async()=>{
 const history=[{id:'h1',prompt:'创建任务',text:'已创建',status:'completed'}];
 const request=vi.fn().mockResolvedValueOnce({installed:true}).mockResolvedValueOnce({exitCode:0,stdout:'{"confirmed":false}'});
 await expect(createPluginMessageDialog(request)({...input,history} as any)).rejects.toMatchObject({name:'AbortError'});
 const payload=JSON.parse(Buffer.from(request.mock.calls[1][1].args[0],'base64').toString());
 expect(payload.history).toEqual(history);
});
it('transfers a large history without exceeding the Windows command-line limit',async()=>{
 const request=vi.fn(async(method:string,params:any)=>method==='native.status'?{installed:true}:params.args[0]==='--store'?{exitCode:0,stdout:'{"stored":true}'}:{exitCode:0,stdout:'{"confirmed":false}'});
 await expect(createPluginMessageDialog(request)({...input,history:[{text:'历史'.repeat(16000)}]})).rejects.toMatchObject({name:'AbortError'});
 const executions=request.mock.calls.filter(c=>c[0]==='native.execute');
 expect(executions.length).toBeGreaterThan(2);
 expect(executions.every(c=>JSON.stringify((c[1] as any).args).length<25000)).toBe(true);
 expect((executions.at(-2)?.[1] as any).args[0]).toBe('--open');
});
it('installs the plugin dialog only when absent before opening it',async()=>{
 const request=vi.fn().mockResolvedValueOnce({installed:false}).mockResolvedValueOnce({installed:true}).mockResolvedValueOnce({exitCode:0,stdout:'{"confirmed":false}'});
 await expect(createPluginMessageDialog(request)(input)).rejects.toMatchObject({name:'AbortError'});
 expect(request.mock.calls.map(call=>call[0])).toEqual(['native.status','native.install','native.execute']);
});
it('does not open an uninstalled dialog after a failed installation',async()=>{
 const request=vi.fn().mockResolvedValue({installed:false});
 await expect(createPluginMessageDialog(request)(input)).rejects.toThrow('安装');
 expect(request.mock.calls.map(call=>call[0])).toEqual(['native.status','native.install']);
});
it('uses only the generic native executor and accepts an explicit confirmation',async()=>{
 const request=vi.fn().mockResolvedValueOnce({installed:true}).mockResolvedValue({exitCode:0,stdout:JSON.stringify({confirmed:true,draftId:'draft-1',recipientId:'ou_1',content:'明天带电脑过来'})});
 await expect(createPluginMessageDialog(request)(input)).resolves.toEqual({draftId:'draft-1',recipientId:'ou_1',content:'明天带电脑过来'});
 expect(request.mock.calls.map(call=>call[0])).toEqual(['native.status','native.execute']);
 expect(request.mock.calls[1][1].dependencyId).toBe('feishu-message-dialog');
});
it('treats closing the window as cancellation, never as confirmation',async()=>{
 const request=vi.fn().mockResolvedValueOnce({installed:true}).mockResolvedValue({exitCode:0,stdout:'{"confirmed":false}'});
 await expect(createPluginMessageDialog(request)(input)).rejects.toMatchObject({name:'AbortError'});
});
it('rejects wrong drafts, unknown recipients and malformed receipts',async()=>{
 for(const stdout of ['not json',JSON.stringify({confirmed:true,draftId:'other',recipientId:'ou_1',content:'x'}),JSON.stringify({confirmed:true,draftId:'draft-1',recipientId:'unknown',content:'x'})]){
  await expect(createPluginMessageDialog(vi.fn().mockResolvedValueOnce({installed:true}).mockResolvedValue({exitCode:0,stdout}))(input)).rejects.toThrow('确认');
 }
});

it('identifies a failed dialog before any message can be sent',async()=>{
 const request=vi.fn().mockResolvedValueOnce({installed:true}).mockResolvedValueOnce({exitCode:1,stdout:''});
 await expect(createPluginMessageDialog(request)(input)).rejects.toMatchObject({code:'MESSAGE_DIALOG_FAILED'});
});

it('reports rejected native execution as an unsent dialog failure',async()=>{
 const request=vi.fn().mockResolvedValueOnce({installed:true}).mockRejectedValueOnce(Object.assign(Error('private transport detail'),{code:'NATIVE_EXECUTION_FAILED'}));
 await expect(createPluginMessageDialog(request)(input)).rejects.toMatchObject({code:'MESSAGE_DIALOG_FAILED',message:'消息确认窗口未正常完成，消息尚未发送。'});
});
it('reports rejected installation as an unsent installation failure',async()=>{
 const request=vi.fn().mockResolvedValueOnce({installed:false}).mockRejectedValueOnce(Error('download failed'));
 await expect(createPluginMessageDialog(request)(input)).rejects.toMatchObject({code:'MESSAGE_DIALOG_INSTALL_FAILED'});
});
it('preserves native cancellation',async()=>{
 const request=vi.fn().mockResolvedValueOnce({installed:true}).mockRejectedValueOnce(new DOMException('cancelled','AbortError'));
 await expect(createPluginMessageDialog(request)(input)).rejects.toMatchObject({name:'AbortError'});
});
