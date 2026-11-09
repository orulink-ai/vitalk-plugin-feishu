// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FeishuVoiceControls} from './FeishuVoiceControls';
const request=vi.hoisted(()=>vi.fn());
vi.mock('../experiments/client',()=>({experimentsRequest:request}));
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks();});
it('reads lightweight host voice state and reflects keyboard recording without workspace polling',async()=>{
 vi.useFakeTimers();request.mockResolvedValue({actionId:'task',status:'recording'});
 render(<FeishuVoiceControls purpose="task" startLabel="语音创建任务"/>);
 await act(async()=>{});
 expect(screen.getByRole('button',{name:'结束语音指令'})).toBeTruthy();
 request.mockResolvedValue({actionId:null,status:'idle'});
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
 expect(screen.getByRole('button',{name:'语音创建任务'})).toBeTruthy();
 expect(request.mock.calls.every(([r])=>r.action==='voiceStatus')).toBe(true);
});
it('never overlaps slow status polls and refreshes real state after toggling',async()=>{
 vi.useFakeTimers();let finish!:(v:unknown)=>void;
 request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 render(<FeishuVoiceControls purpose="calendar"/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(request).toHaveBeenCalledTimes(1);
 await act(async()=>finish({actionId:null,status:'idle'}));
 request.mockResolvedValue({actionId:'calendar',status:'recording'});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'开始语音指令'})));
 expect(request).toHaveBeenCalledWith({action:'voiceCommandToggle',purpose:'calendar'});
 expect(screen.getByRole('button',{name:'结束语音指令'})).toBeTruthy();
});
