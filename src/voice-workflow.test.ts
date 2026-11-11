import {expect,it,vi} from 'vitest';
import {createVoiceWorkflow} from './voice-workflow';
const event={requestId:'voice-1',actionId:'message',transcript:'让小冰带电脑找我',sessionId:'recording-1'};
it('preserves the original failure when diagnostic code access throws',async()=>{
 const {deps}=setup();const error=Error('original failure');
 Object.defineProperty(error,'code',{get(){throw Error('code getter failed');}});
 deps.prepareMessage.mockRejectedValue(error);
 await expect(createVoiceWorkflow({...deps,diagnostic:vi.fn()})(event,new AbortController().signal)).rejects.toBe(error);
});
it('records the failed stage before SDK handling without recording private input',async()=>{
 const {deps}=setup();const diagnostic=vi.fn();const error=Object.assign(Error('private provider response'),{code:'MODEL_TIMEOUT'});
 deps.prepareMessage.mockRejectedValue(error);
 await expect(createVoiceWorkflow({...deps,diagnostic})(event,new AbortController().signal)).rejects.toBe(error);
 expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({action:'message',stage:'message.prepare',status:'failed',code:'MODEL_TIMEOUT',elapsedMs:expect.any(Number)}));
 expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(event.transcript);
 expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(error.message);
});
it('diagnostic failures cannot prevent draft preparation',async()=>{
 const {deps}=setup();const diagnostic=()=>{throw Error('diagnostic unavailable');};
 await expect(createVoiceWorkflow({...deps,diagnostic})(event,new AbortController().signal)).resolves.toMatchObject({title:'消息待确认'});
});
it('preserves a saved draft when the host cannot open its confirmation page',async()=>{
 const {deps,run}=setup();deps.showMessage.mockRejectedValue(Error('window ACL denied'));
 await expect(run(event,new AbortController().signal)).resolves.toMatchObject({title:'消息草稿已保存',text:expect.stringContaining('手动打开')});
 expect(deps.prepareMessage).toHaveBeenCalledTimes(1);expect(deps.create).not.toHaveBeenCalled();
});
it('does not turn cancellation during navigation into a successful result',async()=>{
 const {deps,run}=setup();const controller=new AbortController();
 deps.showMessage.mockImplementation(async()=>{controller.abort();throw Error('cancelled');});
 await expect(run(event,controller.signal)).rejects.toThrow();
});
function setup(){const deps={create:vi.fn(),prepareMessage:vi.fn().mockResolvedValue({id:'draft-1'}),showMessage:vi.fn().mockResolvedValue(undefined)};return {deps,run:createVoiceWorkflow(deps)};}
it('message only prepares a draft and opens confirmation, never creates a task',async()=>{
 const {deps,run}=setup();const signal=new AbortController().signal;
 expect(await run(event,signal)).toMatchObject({title:'消息待确认'});
 expect(deps.prepareMessage).toHaveBeenCalledWith(event.transcript,signal,undefined);
 expect(deps.showMessage).toHaveBeenCalledWith('draft-1');expect(deps.create).not.toHaveBeenCalled();
});
it('task uses recording request identity and returns the real receipt link',async()=>{
 const {deps,run}=setup();const signal=new AbortController().signal;
 deps.create.mockResolvedValue({receipt:{guid:'g',url:'https://applink.feishu.cn/task/g'},plan:{summary:'带电脑找我',recipientQuery:'小冰'}});
 expect(await run({...event,actionId:'task'},signal)).toMatchObject({title:'任务已创建',links:[{label:'在飞书查看任务',url:'https://applink.feishu.cn/task/g'}]});
 expect(deps.create).toHaveBeenCalledWith({kind:'task',prompt:event.transcript,operationId:event.requestId,signal,onConfirmed:expect.any(Function)});
});
it('does not report incomplete invitations as fully successful',async()=>{
 const {deps,run}=setup();deps.create.mockResolvedValue({receipt:{eventId:'e',status:'partial',reason:'邀请未确认',url:'https://applink.feishu.cn/calendar/e'},plan:{summary:'全员例会'}});
 expect(await run({...event,actionId:'calendar'},new AbortController().signal)).toMatchObject({title:'日程已创建，邀请待核实',text:expect.stringContaining('邀请未确认')});
});
it('rejects cancelled or undeclared requests before invoking any business operation',async()=>{
 const {deps,run}=setup();const controller=new AbortController();controller.abort();
 await expect(run(event,controller.signal)).rejects.toThrow();
 await expect(run({...event,actionId:'unknown'},new AbortController().signal)).rejects.toThrow();
 expect(deps.prepareMessage).not.toHaveBeenCalled();expect(deps.create).not.toHaveBeenCalled();
});
it('cancel during preparation never opens a stale confirmation',async()=>{
 const {deps,run}=setup();const controller=new AbortController();
 deps.prepareMessage.mockImplementation(async()=>{controller.abort();return {id:'draft'};});
 await expect(run(event,controller.signal)).rejects.toThrow();expect(deps.showMessage).not.toHaveBeenCalled();
});

it('passes retained recording images into the confirmation draft',async()=>{
 const {deps,run}=setup();const signal=new AbortController().signal;
 const attachments=[{id:'image-1',dataUrl:'data:image/png;base64,AA==',width:2,height:2}];
 await run({...event,attachments},signal);
 expect(deps.prepareMessage).toHaveBeenCalledWith(event.transcript,signal,attachments);
});
it('routes natural language mutations before creation and preserves receipt links',async()=>{
 const operation=vi.fn().mockResolvedValue({kind:'result',title:'任务已完成',text:'带电脑找我',links:[{label:'查看任务',url:'https://applink.feishu.cn/task/g'}]});
 const create=vi.fn();const run=createVoiceWorkflow({create,operation,prepareMessage:vi.fn(),showMessage:vi.fn()});
 const signal=new AbortController().signal;
 expect(await run({...event,actionId:'task',transcript:'把带电脑找我那个任务标记完成'},signal)).toMatchObject({title:'任务已完成',links:expect.any(Array)});
 expect(create).not.toHaveBeenCalled();
});
it.each(['task','calendar'] as const)('publishes %s creation progress without completing or cancelling pending notifications',async kind=>{
 const {deps}=setup();const progress=vi.fn().mockResolvedValue(undefined);const run=createVoiceWorkflow({...deps,progress});
 const signal=new AbortController().signal;let finish!:(value:unknown)=>void;let settled=false;
 const value={receipt:{guid:kind==='task'?'g':undefined,eventId:kind==='calendar'?'e':undefined,url:'https://applink.feishu.cn/task/g',notification:'分享处理中'},plan:{summary:'核对资料'}};
 deps.create.mockImplementation(async(input)=>{input.onConfirmed(value);return new Promise(resolve=>{finish=resolve;});});
 const work=run({...event,actionId:kind},signal).then(result=>{settled=true;return result;});
 await vi.waitFor(()=>expect(progress).toHaveBeenCalledWith(event.requestId,expect.objectContaining({title:kind==='task'?'任务已创建':'日程已创建',text:expect.stringContaining('分享处理中')})));
 expect(settled).toBe(false);expect(signal.aborted).toBe(false);
 finish({...value,receipt:{...value.receipt,notification:'分享结果未确认'}});
 expect(await work).toMatchObject({text:expect.stringContaining('分享结果未确认')});
 expect(deps.create).toHaveBeenCalledTimes(1);
});
it('progress rejection does not erase a confirmed remote receipt or replay creation',async()=>{
 const {deps}=setup();const progress=vi.fn().mockRejectedValue(Error('bridge unavailable'));
 const value={receipt:{guid:'g',url:''},plan:{summary:'带电脑'}};
 deps.create.mockImplementation(async(input)=>{input.onConfirmed(value);return value;});
 await expect(createVoiceWorkflow({...deps,progress})({...event,actionId:'task'},new AbortController().signal)).resolves.toMatchObject({title:'任务已创建'});
 expect(deps.create).toHaveBeenCalledTimes(1);
});
it('message confirmation does not publish creation progress',async()=>{
 const {deps}=setup();const progress=vi.fn();
 await createVoiceWorkflow({...deps,progress})(event,new AbortController().signal);
 expect(progress).not.toHaveBeenCalled();
});
it('waits for progress acknowledgement before the final result so late progress cannot replace completion',async()=>{
 const {deps}=setup();let acknowledge!:()=>void;
 const progress=vi.fn(()=>new Promise<void>(resolve=>{acknowledge=resolve;}));
 const value={receipt:{guid:'g',url:''},plan:{summary:'带电脑'}};
 deps.create.mockImplementation(async(input)=>{input.onConfirmed(value);return value;});
 let completed=false;const work=createVoiceWorkflow({...deps,progress})({...event,actionId:'task'},new AbortController().signal).then(result=>{completed=true;return result;});
 await vi.waitFor(()=>expect(progress).toHaveBeenCalled());expect(completed).toBe(false);
 acknowledge();await work;expect(completed).toBe(true);
});
it('does not present creation progress after the recording was cancelled',async()=>{
 const {deps}=setup();const progress=vi.fn();const controller=new AbortController();
 deps.create.mockImplementation(async(input)=>{controller.abort();input.onConfirmed({receipt:{guid:'g',url:''},plan:{summary:'带电脑'}});return {receipt:{guid:'g',url:''},plan:{summary:'带电脑'}};});
 await expect(createVoiceWorkflow({...deps,progress})({...event,actionId:'task'},controller.signal)).rejects.toThrow();
 expect(progress).not.toHaveBeenCalled();expect(deps.create).toHaveBeenCalledTimes(1);
});

it('waits for floating message confirmation and returns its actual receipt',async()=>{
 const {deps}=setup();let resolve!:(value:{title:string;text:string})=>void;
 const confirmMessage=vi.fn(()=>new Promise<{title:string;text:string}>(r=>{resolve=r;}));
 let finished=false;const signal=new AbortController().signal;
 const work=createVoiceWorkflow({...deps,confirmMessage})(event,signal).then(result=>{finished=true;return result;});
 await vi.waitFor(()=>expect(confirmMessage).toHaveBeenCalledWith('voice-1',{id:'draft-1'},signal));
 expect(finished).toBe(false);expect(deps.showMessage).not.toHaveBeenCalled();
 resolve({title:'消息已发送',text:'实际回执'});
 expect(await work).toEqual({title:'消息已发送',text:'实际回执'});
});
it('does not fall back to a success notice when floating confirmation fails',async()=>{
 const {deps}=setup();const confirmMessage=vi.fn().mockRejectedValue(Error('VOICE_CANCELLED'));
 await expect(createVoiceWorkflow({...deps,confirmMessage})(event,new AbortController().signal)).rejects.toThrow('VOICE_CANCELLED');
 expect(deps.showMessage).not.toHaveBeenCalled();
});
