// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuickMessagePage } from "./QuickMessagePage";
const request = vi.hoisted(() => vi.fn(async (r:{action:string}) => r.action === "feishuAuthStatus"
  ? {connected:true,message:"已连接"}
  : r.action === "feishuTaskList" ? {items:[],accountId:"ou_test",hasMore:false,nextPageToken:""}
  : r.action === "feishuCalendarList" ? {items:[]}
  : {config:{feishuTools:true},feishuCatalog:{recipients:[],partial:true,lastSync:null}}));
vi.mock("../experiments/client",()=>({experimentsRequest:request}));
afterEach(()=>{cleanup();request.mockClear();});
it("keeps all voice actions in the same workspace header and preserves the message recording API",async()=>{
  render(<QuickMessagePage/>);
  await screen.findByRole("button",{name:"语音输入"});
  const header=screen.getByRole("region",{name:"飞书工作台"}).querySelector(".feishu-workspace-header") as HTMLElement;
  expect(within(header).queryByRole("button",{name:/^快捷键$/})).toBeNull();
  fireEvent.click(within(header).getByRole("button",{name:"语音输入"}));
  await waitFor(()=>expect(request.mock.calls.some(([r])=>r.action==="messageVoiceToggle")).toBe(true));
  fireEvent.click(screen.getByRole("tab",{name:"任务"}));
  expect(await within(header).findByRole("button",{name:"语音创建任务"})).toBeTruthy();
  fireEvent.click(screen.getByRole("tab",{name:"日程"}));
  expect(await within(header).findByRole("button",{name:"语音预约日程"})).toBeTruthy();
  expect(screen.queryByRole("button",{name:"语音输入"})).toBeNull();
});
it("opens and expands shortcut settings from the voice hint without starting recording",async()=>{
  render(<QuickMessagePage/>);
  fireEvent.click(await screen.findByRole("button",{name:"设置消息语音快捷键"}));
  expect(screen.getByRole("tab",{name:"设置"}).getAttribute("aria-selected")).toBe("true");
  await waitFor(()=>expect(screen.getByText("语音快捷键与功能开关").closest("details")?.open).toBe(true));
  expect(request.mock.calls.some(([r])=>/Toggle|ShortcutSet|ShortcutCapture/.test(r.action))).toBe(false);
});
it("opens the message workflow directly and separates work from account tools",async()=>{
  render(<QuickMessagePage/>);
  const message=await screen.findByRole("tab",{name:"消息"});
  await waitFor(()=>expect(message.getAttribute("aria-selected")).toBe("true"));
  const primary=screen.getByRole("tablist",{name:"飞书工作"});
  expect(primary.textContent).toBe("消息任务日程");
  expect(screen.getByRole("tablist",{name:"飞书管理"}).textContent).toContain("操作记录");
});
it("keeps an unfinished task request when moving between task and calendar work",async()=>{
  render(<QuickMessagePage/>);
  fireEvent.click(await screen.findByRole("tab",{name:"任务"}));
  expect(await screen.findByRole("button",{name:"语音创建任务"})).toBeTruthy();
  fireEvent.click(await screen.findByRole("button",{name:"创建任务"}));
  fireEvent.change(screen.getByLabelText("任务要求"),{target:{value:"为我整理明天的方案"}});
  fireEvent.click(screen.getByRole("tab",{name:"日程"}));
  await screen.findByRole("button",{name:"创建日程"});
  expect(screen.getByRole("button",{name:"语音预约日程"})).toBeTruthy();
  fireEvent.click(screen.getByRole("tab",{name:"任务"}));
  expect(screen.getByLabelText("任务要求")).toHaveProperty("value","为我整理明天的方案");
  expect(request.mock.calls.some(([r])=>r.action==="feishuTaskCreate")).toBe(false);
});
it('does not overlap slow page refreshes and clears recovered read failures',async()=>{
 const {act}=await import('@testing-library/react');
 vi.useFakeTimers();
 try{
  let finish!:(value:any)=>void;
  request.mockImplementationOnce(async()=>({connected:true,message:'已连接'}));
  request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<QuickMessagePage/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(12000);});
  expect(request.mock.calls.filter(([r])=>r.action==='read')).toHaveLength(1);
  await act(async()=>{finish({config:{},feishuCatalog:{recipients:[],partial:true,lastSync:null}});});
 }finally{cleanup();vi.useRealTimers();}
});
it('removes a stale read error when the next refresh succeeds',async()=>{
 request.mockImplementationOnce(async()=>({connected:true,message:'已连接'}));
 request.mockRejectedValueOnce(Error('插件仍有请求正在处理'));
 render(<QuickMessagePage/>);
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','插件仍有请求正在处理');
 fireEvent(window,new Event('feishu-message-draft-ready'));
 await waitFor(()=>expect(screen.queryByText('插件仍有请求正在处理')).toBeNull());
});

it('does not label partial authorization as fully connected in the header',async()=>{
 request.mockImplementationOnce(async()=>({connected:true,allPermissionsGranted:false,message:'需补充授权'}));
 render(<QuickMessagePage/>);
 const header=screen.getByRole('region',{name:'飞书工作台'}).querySelector('.feishu-workspace-header') as HTMLElement;
 expect(await within(header).findByText('需补充授权')).toBeTruthy();
 expect(within(header).queryByText('飞书已连接')).toBeNull();
});
it('labels a fully granted account as connected in the header',async()=>{
 request.mockImplementationOnce(async()=>({connected:true,allPermissionsGranted:true,message:'已连接'}));
 render(<QuickMessagePage/>);
 const header=screen.getByRole('region',{name:'飞书工作台'}).querySelector('.feishu-workspace-header') as HTMLElement;
 expect(await within(header).findByText('飞书已连接')).toBeTruthy();
});
