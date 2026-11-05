// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FeishuTaskWorkspace } from "./FeishuTaskWorkspace";
import { FeishuCalendarWorkspace } from "./FeishuCalendarWorkspace";
import type { CalendarItem } from "./workspace-calendar";
const request=vi.hoisted(()=>vi.fn());
const openUrl=vi.hoisted(()=>vi.fn(async()=>{}));
vi.mock("../experiments/client",()=>({experimentsRequest:request}));
vi.mock("../client",()=>({openFeishuUrl:openUrl}));
vi.mock("./workspace-controls",async importOriginal=>({...await importOriginal<typeof import("./workspace-controls")>(),WorkspaceHistory:()=>null}));
vi.mock("./FeishuCalendarViews",()=>({CalendarMonth:()=>null,CalendarTimeGrid:({items,onSelect}:{items:CalendarItem[];onSelect:(item:CalendarItem)=>void})=><>{items.map(item=><button key={item.id} onClick={()=>onSelect(item)}>{item.title}</button>)}</>}));
afterEach(()=>{cleanup();request.mockReset();openUrl.mockClear();});
const task={id:"00000000-0000-4000-8000-000000000001",title:"任务甲",description:"任务的完整说明",ownerId:"ou_self",dueTimestamp:"",completed:false,url:"https://applink.feishu.cn/client/todo/detail?guid=task"};
const event={id:"evt_a_0",title:"会议甲",start:{timestamp:"1800000000"},end:{timestamp:"1800003600"},url:"https://applink.feishu.cn/calendar/event"};

it.each(["completed","uncertain"])("keeps task details/source and existing completion with a %s receipt",async status=>{
  let lists=0;
  request.mockImplementation(async p=>{
    if(p.action==="feishuTaskList")return{items:++lists===1?[task]:[],hasMore:false,nextPageToken:"",accountId:`ou_${status}`};
    if(p.action==="feishuTaskComplete")return{status,message:`完成结果：${status}`};
    throw Error(`Unsupported request ${p.action}`);
  });
  render(<FeishuTaskWorkspace recipients={[]} replies={[]}/>);
  expect(screen.getByRole("button",{name:/筛选/}).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(await screen.findByRole("button",{name:"详情"}));
  expect(await screen.findByRole("heading",{name:"任务详情"})).toBeTruthy();
  expect(screen.getAllByText(task.description).length).toBeGreaterThan(0);
  expect(screen.getByText("插件暂不提供任务编辑和删除，请在飞书中操作。")).toBeTruthy();
  expect(screen.queryByRole("button",{name:/删除/})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"来源：飞书任务"}));expect(openUrl).toHaveBeenCalledWith(task.url);
  fireEvent.click(screen.getByRole("button",{name:"完成任务"}));
  await screen.findByText(`完成结果：${status}`);
  await waitFor(()=>expect(lists).toBe(status==="completed"?2:1));
  expect(request.mock.calls.every(([p])=>["feishuTaskList","feishuTaskComplete"].includes(p.action))).toBe(true);
});

it("opens calendar details/source without calendar identity fields or unsupported delete controls",async()=>{
  request.mockResolvedValue({items:[event]});
  render(<FeishuCalendarWorkspace replies={[]}/>);
  fireEvent.click(await screen.findByRole("button",{name:"会议甲"}));
  expect(await screen.findByRole("heading",{name:"日程详情"})).toBeTruthy();
  expect(screen.getByText("插件暂不提供日程删除，请在飞书中操作。")).toBeTruthy();
  expect(screen.queryByRole("button",{name:/删除/})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"来源：飞书日程"}));expect(openUrl).toHaveBeenCalledWith(event.url);
  expect(request.mock.calls.every(([p])=>p.action==="feishuCalendarList")).toBe(true);
});

it.each(["uncertain","failed"])("shows %s completion inside the dialog and prevents resubmission after close/dismiss",async outcome=>{
  const accountId=`ou_dialog_terminal_${outcome}`;
  request.mockImplementation(async p=>{
    if(p.action==="feishuTaskList")return{items:[task],hasMore:false,nextPageToken:"",accountId};
    if(p.action==="feishuTaskComplete"){
      if(outcome==="failed")throw Error("完成请求断开，请在飞书核对");
      return{status:"uncertain",message:"结果未确认，请在飞书核对"};
    }
    throw Error(`Unsupported request ${p.action}`);
  });
  render(<FeishuTaskWorkspace recipients={[]} replies={[]}/>);
  fireEvent.click(await screen.findByRole("button",{name:"详情"}));
  let dialog=await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button",{name:"完成任务"}));
  expect(await within(dialog).findByRole("alert")).toBeTruthy();
  expect(within(dialog).getByRole("button",{name:"完成任务"}).hasAttribute("disabled")).toBe(true);
  fireEvent.click(within(dialog).getByRole("button",{name:"完成任务"}));
  fireEvent.click(within(dialog).getByRole("button",{name:"Close"}));
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"关闭完成回执"}));
  fireEvent.click(screen.getByRole("button",{name:"详情"}));
  dialog=await screen.findByRole("dialog");
  expect(within(dialog).getByRole("alert")).toBeTruthy();
  expect(within(dialog).getByRole("button",{name:"完成任务"}).hasAttribute("disabled")).toBe(true);
  expect(request.mock.calls.filter(([p])=>p.action==="feishuTaskComplete")).toHaveLength(1);
});

it("shows a source-link error inside the selected task dialog",async()=>{
  request.mockResolvedValue({items:[task],hasMore:false,nextPageToken:"",accountId:"ou_source_failure"});
  openUrl.mockRejectedValueOnce(Error("source unavailable"));
  render(<FeishuTaskWorkspace recipients={[]} replies={[]}/>);
  fireEvent.click(await screen.findByRole("button",{name:"详情"}));
  const dialog=await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button",{name:"来源：飞书任务"}));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("无法打开飞书任务");
  fireEvent.click(within(dialog).getByRole("button",{name:"来源：飞书任务"}));
  await waitFor(()=>expect(within(dialog).queryByRole("alert")).toBeNull());
});

it("keeps common status next to search while folding the advanced task filters",async()=>{
  request.mockResolvedValue({items:[task],hasMore:false,nextPageToken:"",accountId:"ou_status_toolbar"});
  render(<FeishuTaskWorkspace recipients={[]} replies={[]}/>);
  await screen.findByRole("button",{name:"详情"});
  const group=screen.getByRole("group",{name:"任务完成状态"});
  expect(within(group).getByRole("button",{name:"未完成"})).toBeTruthy();
  expect(screen.queryByRole("combobox",{name:"创建人筛选"})).toBeNull();
  fireEvent.click(within(group).getByRole("button",{name:"已完成"}));
  await waitFor(()=>expect(request).toHaveBeenCalledWith({action:"feishuTaskList",completed:true}));
  fireEvent.click(screen.getByRole("button",{name:/筛选/}));
  expect(screen.getByRole("combobox",{name:"创建人筛选"})).toBeTruthy();
  expect(screen.getByRole("combobox",{name:"负责人筛选"})).toBeTruthy();
  expect(screen.getByRole("combobox",{name:"截止时间筛选"})).toBeTruthy();
  expect(screen.getByRole("combobox",{name:"开始时间筛选"})).toBeTruthy();
  expect(screen.getByRole("combobox",{name:"任务排序"})).toBeTruthy();
});
