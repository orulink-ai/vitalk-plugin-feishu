import {beforeEach,expect,it,vi} from 'vitest';
import {experimentsRequest} from './client';
const bridge=vi.hoisted(()=>({feishu:vi.fn(),toggle:vi.fn(),get:vi.fn(),set:vi.fn(),capture:vi.fn(),status:vi.fn()}));
vi.mock('../client',()=>({feishu:bridge.feishu,getClient:()=>({voice:{status:bridge.status,toggle:bridge.toggle,shortcuts:{get:bridge.get,set:bridge.set,capture:bridge.capture}}})}));
vi.mock('../workspace-record-service',()=>({completeWorkspaceTask:vi.fn(),listWorkspaceCalendar:vi.fn(),listWorkspaceTasks:vi.fn()}));
beforeEach(()=>{vi.resetAllMocks();bridge.get.mockResolvedValue({shortcuts:[]});bridge.feishu.mockResolvedValue({config:{}});});
it('routes the three UI modes and message toggle through generic voice actions',async()=>{
 for(const purpose of ['message','task','calendar'])await experimentsRequest({action:'voiceCommandToggle',purpose});
 await experimentsRequest({action:'messageVoiceToggle'});
 expect(bridge.toggle.mock.calls).toEqual([[{actionId:'message'}],[{actionId:'task'}],[{actionId:'calendar'}],[{actionId:'message'}]]);
 expect(bridge.feishu).not.toHaveBeenCalled();
 await expect(experimentsRequest({action:'voiceCommandToggle',purpose:'unknown'})).rejects.toThrow();
});
it('reads current host shortcuts over stale migrated workspace shortcuts',async()=>{
 bridge.feishu.mockResolvedValue({config:{feishuTools:true,pluginShortcuts:[{pluginId:'vitalk-plugin-feishu',purpose:'task',hotkey:'old',trigger:'toggle'}]}});
 bridge.get.mockResolvedValue({shortcuts:[{actionId:'task',hotkey:'Ctrl+Alt+T',trigger:'toggle'}]});
 const result=await experimentsRequest({action:'read'});
 expect(result.config.pluginShortcuts).toEqual([{pluginId:'vitalk-plugin-feishu',purpose:'task',hotkey:'Ctrl+Alt+T',trigger:'toggle'}]);
 expect(bridge.set).not.toHaveBeenCalled();
});
it('preserves host empty shortcuts and never resurrects stale migration values',async()=>{
 bridge.feishu.mockResolvedValue({config:{pluginShortcuts:[{pluginId:'vitalk-plugin-feishu',hotkey:'Ctrl+Alt+M'}]}});
 const result=await experimentsRequest({action:'read'});expect(result.config.pluginShortcuts).toEqual([]);
 expect(bridge.set).not.toHaveBeenCalled();
});
it('preserves an existing purpose-less message shortcut during initial migration',async()=>{
 bridge.get.mockResolvedValue({shortcuts:[{hotkey:'Ctrl+Shift+M',trigger:'toggle'}]});
 const result=await experimentsRequest({action:'read'});
 expect(result.config.pluginShortcuts).toEqual([{pluginId:'vitalk-plugin-feishu',purpose:'message',hotkey:'Ctrl+Shift+M',trigger:'toggle'}]);expect(bridge.set).not.toHaveBeenCalled();
});
it('saves and captures shortcuts without legacy Feishu permission',async()=>{
 bridge.get.mockResolvedValue({shortcuts:[{actionId:'calendar',hotkey:'Ctrl+Alt+C',trigger:'toggle'}]});
 const result=await experimentsRequest({action:'feishuShortcutSet',purpose:'calendar',hotkey:'Ctrl+Alt+C'});
 expect(bridge.set).toHaveBeenCalledWith({actionId:'calendar',hotkey:'Ctrl+Alt+C'});
 expect(result.config.pluginShortcuts?.[0].purpose).toBe('calendar');
 await experimentsRequest({action:'feishuShortcutCapture',active:true});await experimentsRequest({action:'feishuShortcutCapture',active:false});
 expect(bridge.capture.mock.calls).toEqual([[{active:true}],[{active:false}]]);expect(bridge.feishu).not.toHaveBeenCalled();
});
it('coalesces overlapping workspace polls but never caches settled reads',async()=>{
 let finish!:(value:unknown)=>void;
 bridge.feishu.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const reads=Array.from({length:12},()=>experimentsRequest({action:'read'}));
 expect(bridge.feishu).toHaveBeenCalledTimes(1);expect(bridge.get).toHaveBeenCalledTimes(1);
 finish({config:{}});await Promise.all(reads);
 await experimentsRequest({action:'read'});expect(bridge.feishu).toHaveBeenCalledTimes(2);
});
it('releases the shared poll after failure so the next read can recover',async()=>{
 bridge.feishu.mockRejectedValueOnce(Error('temporary failure'));
 const reads=[experimentsRequest({action:'read'}),experimentsRequest({action:'read'})];
 const results=await Promise.allSettled(reads);expect(results.every(r=>r.status==='rejected')).toBe(true);
 expect(bridge.feishu).toHaveBeenCalledTimes(1);
 await expect(experimentsRequest({action:'read'})).resolves.toEqual({config:{pluginShortcuts:[]}});
 expect(bridge.feishu).toHaveBeenCalledTimes(2);
});

it('reads recording state without a workspace or CLI refresh',async()=>{
 bridge.status.mockResolvedValue({actionId:'task',status:'recording'});
 await expect(experimentsRequest({action:'voiceStatus'})).resolves.toEqual({actionId:'task',status:'recording'});
 expect(bridge.status).toHaveBeenCalledTimes(1);
 expect(bridge.feishu).not.toHaveBeenCalled();expect(bridge.get).not.toHaveBeenCalled();
});

it('recovers a cancelled display read once after voice has become idle',async()=>{
 bridge.feishu.mockRejectedValueOnce(Object.assign(Error('cancelled read'),{code:'cancelled'}));
 bridge.status.mockResolvedValue({actionId:null,status:'idle'});
 await expect(experimentsRequest({action:'read'})).resolves.toEqual({config:{pluginShortcuts:[]}});
 expect(bridge.feishu).toHaveBeenCalledTimes(2);
});
it('does not retry a cancelled read while another voice operation is active',async()=>{
 const error=Object.assign(Error('cancelled read'),{code:'cancelled'});
 bridge.feishu.mockRejectedValueOnce(error);
 bridge.status.mockResolvedValue({actionId:'task',status:'recording'});
 await expect(experimentsRequest({action:'read'})).rejects.toBe(error);
 expect(bridge.feishu).toHaveBeenCalledTimes(1);
});
it('never retries a cancelled mutation or loops on persistent read cancellation',async()=>{
 const error=Object.assign(Error('cancelled'),{code:'cancelled'});
 bridge.feishu.mockRejectedValue(error);
 bridge.status.mockResolvedValue({actionId:null,status:'idle'});
 await expect(experimentsRequest({action:'read'})).rejects.toBe(error);
 expect(bridge.feishu).toHaveBeenCalledTimes(2);
 await expect(experimentsRequest({action:'feishuMessageSend',id:'draft'})).rejects.toBe(error);
 expect(bridge.feishu).toHaveBeenCalledTimes(3);
});
