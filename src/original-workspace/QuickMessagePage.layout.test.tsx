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
