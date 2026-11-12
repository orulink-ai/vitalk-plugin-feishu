import {expect,it,vi} from 'vitest';
import {createMessageNotice,noticeRecords} from './message-notice';
it('keeps newest-first history when limiting the visible range',()=>{
 const records=Array.from({length:501},(_,i)=>({id:String(i),prompt:`记录${i}`,text:'已完成',status:'completed',command:{destination:'feishuMessage'}}));
 const visible=noticeRecords(records);expect(visible[1].id).toBe('0');expect(visible.at(-1)?.id).toBe('498');expect(visible[0].title).toContain('501');
});
const input={requestId:'r',draft:{draftId:'d',recipientId:'p',content:'原始内容',recipients:[{id:'p',name:'本人'}]}};
it('uses the existing host notice and returns edited confirmation without launching a helper',async()=>{
 const present=vi.fn().mockResolvedValue({confirmed:true,values:{recipient:'p',content:'编辑内容'}});
 expect(await createMessageNotice(present)(input)).toEqual({draftId:'d',recipientId:'p',content:'编辑内容'});
 expect(present).toHaveBeenCalledWith(expect.objectContaining({title:'消息待确认',submitLabel:'确认发送',fields:expect.arrayContaining([expect.objectContaining({id:'recipient',type:'select'})])}),expect.objectContaining({timeoutMs:660000}));
});
it('closing is an explicit unsent cancellation',async()=>{
 await expect(createMessageNotice(vi.fn().mockResolvedValue({confirmed:false,values:{}}))(input)).rejects.toMatchObject({code:'MESSAGE_CONFIRMATION_CANCELLED'});
});
it('rejects invented recipients, empty text and injected image IDs',async()=>{
 for(const values of [{recipient:'other',content:'x'},{recipient:'p',content:' '},{recipient:'p',content:'x',images:['other']}])await expect(createMessageNotice(vi.fn().mockResolvedValue({confirmed:true,values}))(input)).rejects.toThrow('确认');
});
it('passes images directly to the host and accepts removal before sending',async()=>{
 const image={id:'image',dataUrl:'data:image/png;base64,aGVsbG8=',width:1,height:1};
 const present=vi.fn().mockResolvedValue({confirmed:true,values:{recipient:'p',content:'图片消息',images:[]}});
 expect(await createMessageNotice(present)({...input,draft:{...input.draft,attachments:[image]}})).toMatchObject({attachmentIds:[]});
 expect(present.mock.calls[0][0].fields).toContainEqual(expect.objectContaining({id:'images',images:[{id:'image',dataUrl:image.dataUrl}]}));
});
import {validNotice} from '@vitalk/plugin-sdk';
it('bounds only history display fields so long valid history never prevents message confirmation',async()=>{
 const history=[{id:'history',prompt:'中'.repeat(1000),text:'正文'.repeat(20000),status:'completed',command:{destination:'feishuTask',task:{summary:'题'.repeat(900),assignee:'人'.repeat(1500),notification:'已分享'}}}];
 const original=structuredClone(history);
 const present=vi.fn(async(form)=>{expect(validNotice(form)).toBe(true);return {confirmed:true,values:{recipient:'p',content:'原始内容'}};});
 await expect(createMessageNotice(present)({...input,history})).resolves.toMatchObject({content:'原始内容'});
 expect(history).toEqual(original);expect(noticeRecords(history)[0].title.endsWith('…')).toBe(true);
});
