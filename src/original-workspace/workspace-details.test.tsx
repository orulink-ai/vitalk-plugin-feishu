// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FeishuTaskWorkspace } from "./FeishuTaskWorkspace";
import { FeishuCalendarWorkspace } from "./FeishuCalendarWorkspace";
import type { CalendarItem } from "./workspace-calendar";
const request=vi.hoisted(()=>vi.fn());
const mutations=vi.hoisted(()=>({editWorkspaceTask:vi.fn(),deleteWorkspaceTask:vi.fn(),deleteWorkspaceEvent:vi.fn(),editWorkspaceEvent:vi.fn(),readWorkspaceEventForEdit:vi.fn()}));
vi.mock("../workspace-record-service",()=>mutations);
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
  fireEvent.click(await screen.findByRole("button",{name:"查看任务：任务甲"}));
  expect(await screen.findByRole("heading",{name:"任务详情"})).toBeTruthy();
  expect(screen.getAllByText(task.description).length).toBeGreaterThan(0);
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


it("edits the selected task from its details and uses the readback title",async()=>{
  request.mockResolvedValue({items:[task],hasMore:false,nextPageToken:"",accountId:"ou_edit"});
  mutations.editWorkspaceTask.mockResolvedValue({status:"updated",message:"修改已确认",task:{...task,title:"更新后"}});
  render(<FeishuTaskWorkspace recipients={[]} replies={[]}/>);
  fireEvent.click(await screen.findByRole("button",{name:"查看任务：任务甲"}));
  const dialog=screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button",{name:"编辑任务"}));
  fireEvent.change(within(dialog).getByLabelText("任务标题"),{target:{value:"更新后"}});
  fireEvent.click(within(dialog).getByRole("button",{name:"保存修改"}));
  expect(await within(dialog).findByText("修改已确认")).toBeTruthy();
  expect(mutations.editWorkspaceTask).toHaveBeenCalledWith({id:task.id,accountId:"ou_edit",title:"更新后",description:task.description});
  expect(within(dialog).getByRole("heading",{name:"更新后"})).toBeTruthy();
});

it("confirms calendar deletion against the selected result account and calendar",async()=>{
  request.mockResolvedValue({items:[event],accountId:"ou_delete",calendarId:"cal_1"});
  mutations.deleteWorkspaceEvent.mockResolvedValue({status:"deleted",message:"删除已确认"});
  render(<FeishuCalendarWorkspace replies={[]}/>);
  fireEvent.click(await screen.findByRole("button",{name:"会议甲"}));
  const dialog=screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button",{name:"删除日程"}));
  expect(mutations.deleteWorkspaceEvent).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button",{name:"确认删除日程"}));
  expect(await screen.findByText("删除已确认")).toBeTruthy();
  expect(mutations.deleteWorkspaceEvent).toHaveBeenCalledWith({id:event.id,accountId:"ou_delete",calendarId:"cal_1"});
  expect(screen.queryByRole("button",{name:"会议甲"})).toBeNull();
});

it("reads event edit fields and displays the independently confirmed calendar update",async()=>{
  const details={...event,description:"原说明",editable:true};
  request.mockResolvedValue({items:[event],accountId:"ou_event_edit",calendarId:"cal_1"});
  mutations.readWorkspaceEventForEdit.mockResolvedValue(details);
  mutations.editWorkspaceEvent.mockResolvedValue({
    status:"eventUpdated",message:"日程修改已确认",event:{...details,title:"修改后的会议"},
  });
  render(<FeishuCalendarWorkspace replies={[]}/>);
  fireEvent.click(await screen.findByRole("button",{name:"会议甲"}));
  const dialog=screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button",{name:"编辑日程"}));
  const title=await within(dialog).findByLabelText("日程标题");
  expect(within(dialog).getByLabelText("日程说明")).toHaveProperty("value","原说明");
  fireEvent.change(title,{target:{value:"修改后的会议"}});
  fireEvent.change(within(dialog).getByLabelText("开始时间（北京时间）"),{target:{value:"2027-01-15T15:58"}});
  fireEvent.click(within(dialog).getByRole("button",{name:"保存修改"}));
  expect(await within(dialog).findByText("日程修改已确认")).toBeTruthy();
  expect(mutations.editWorkspaceEvent).toHaveBeenCalledWith(expect.objectContaining({
    id:event.id,accountId:"ou_event_edit",calendarId:"cal_1",title:"修改后的会议",description:"原说明",
    start:{timestamp:"1799999880"},end:event.end,
  }));
  expect(within(dialog).getByRole("heading",{name:"修改后的会议"})).toBeTruthy();
});
