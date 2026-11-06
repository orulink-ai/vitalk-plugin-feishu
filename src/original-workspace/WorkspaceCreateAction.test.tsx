// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {WorkspaceCreateAction} from "./WorkspaceCreateAction";
const {request,openUrl}=vi.hoisted(()=>({request:vi.fn(),openUrl:vi.fn()}));
vi.mock("../experiments/client",()=>({experimentsRequest:request}));
vi.mock("../client",()=>({openFeishuUrl:openUrl}));
afterEach(()=>{cleanup();request.mockReset();openUrl.mockReset();vi.restoreAllMocks();});
it("opens a named nonmodal composer and preserves its draft after Escape",async()=>{
  render(<WorkspaceCreateAction kind="task"/>);
  await draft("task","周五前核对资料");
  const panel=screen.getByRole("dialog",{name:"创建任务"});
  expect(panel.getAttribute("aria-modal")).toBe("false");
  fireEvent.keyDown(panel,{key:"Escape"});
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"创建任务"}));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("周五前核对资料");
  expect(request).not.toHaveBeenCalled();
});
it("keeps an in-flight composer open on Escape and disables its close action",async()=>{
  const pending=deferred<typeof taskReply>();request.mockReturnValue(pending.promise);
  render(<WorkspaceCreateAction kind="task"/>);await draft("task","核对资料");
  fireEvent.click(screen.getByRole("button",{name:"创建任务"}));
  const panel=screen.getByRole("dialog",{name:"创建任务"});
  fireEvent.keyDown(panel,{key:"Escape"});
  expect(screen.getByRole("dialog")).toBe(panel);
  expect((screen.getByRole("button",{name:"关闭创建面板"}) as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>pending.resolve(taskReply));
  expect(await screen.findByText("任务已创建")).toBeTruthy();
});
const taskReply={receipt:{guid:"00000000-0000-4000-8000-000000000001",url:"https://applink.feishu.cn/client/todo/detail?guid=task"},plan:{summary:"核对方案",description:"保留完整数字",recipientQuery:"小琼",due:"2026-11-13"}};
function deferred<T>() {let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return {resolve,reject,promise};}
async function draft(kind:"task"|"calendar",value:string) {
  fireEvent.click(screen.getByRole("button",{name:kind==="task"?"创建任务":"创建日程"}));
  fireEvent.change(screen.getByRole("textbox",{name:kind==="task"?"任务要求":"日程要求"}),{target:{value}});
}
it("submits natural speech unchanged with one UUID, blocks duplicate clicks and keeps the real task result",async()=>{
  const pending=deferred<typeof taskReply>();request.mockReturnValue(pending.promise);
  const onCreated=vi.fn();render(<WorkspaceCreateAction kind="task" onCreated={onCreated}/>);
  await draft("task","  小琼周五前把方案核对一下，保留完整数字  ");
  const submit=screen.getByRole("button",{name:"创建任务"});
  // Published plugin frames allow scripts, not native form submissions.
  expect(submit.getAttribute("type")).toBe("button");
  fireEvent.click(submit);fireEvent.click(submit);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith({action:"feishuTaskCreate",prompt:"小琼周五前把方案核对一下，保留完整数字",requestId:expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)});
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  await act(async()=>pending.resolve(taskReply));
  expect(await screen.findByText("任务已创建")).toBeTruthy();
  expect(screen.getByText("核对方案")).toBeTruthy();
  expect(screen.getByText("2026-11-13")).toBeTruthy();
  expect(screen.queryByText(/已通知|已发送任务通知/)).toBeNull();
  expect(onCreated).toHaveBeenCalledOnce();
  openUrl.mockResolvedValue(undefined);fireEvent.click(screen.getByRole("button",{name:"在飞书中查看"}));
  await waitFor(()=>expect(openUrl).toHaveBeenCalledWith(taskReply.receipt.url));
});
it("shows the actual partial calendar invitation receipt without assuming all guests were notified",async()=>{
  request.mockResolvedValue({receipt:{calendarId:"calendar",eventId:"event",url:"https://applink.feishu.cn/calendar/event",status:"partial",invitationStatus:"unconfirmed",reason:"日程已创建，参会邀请未完整确认，请在飞书核对；不会重邀"},plan:{summary:"方案讨论",description:"",start:"2026-11-13T15:00:00+08:00",end:"2026-11-13T15:30:00+08:00",participantQueries:["小琼"]}});
  render(<WorkspaceCreateAction kind="calendar"/>);await draft("calendar","下周五下午和小琼讨论方案");
  fireEvent.click(screen.getByRole("button",{name:"创建日程"}));
  expect(await screen.findByText("日程已创建")).toBeTruthy();
  expect(screen.getByText(/参会邀请未完整确认/)).toBeTruthy();
  expect(screen.getByText(/北京时间/)).toBeTruthy();
  expect(request.mock.calls[0][0].action).toBe("feishuCalendarCreate");
});
it("keeps LLM errors local and never retries unknown results or generates another request automatically",async()=>{
  request.mockRejectedValue(Error("会议日期未识别完整，尚未预约"));
  render(<WorkspaceCreateAction kind="calendar"/>);await draft("calendar","找个时间讨论方案");
  fireEvent.click(screen.getByRole("button",{name:"创建日程"}));
  expect((await screen.findByRole("alert")).textContent).toContain("会议日期未识别完整，尚未预约");
  expect(screen.getByText(/请先在飞书核对/)).toBeTruthy();
  expect(screen.queryByRole("button",{name:/重试/})).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"重新填写"}));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  expect(request).toHaveBeenCalledTimes(1);
});
it("does not report creation when the host returns no matching receipt",async()=>{
  request.mockResolvedValue({plan:{summary:"只有模型参数"}});
  render(<WorkspaceCreateAction kind="task"/>);await draft("task","给小琼一个任务");
  fireEvent.click(screen.getByRole("button",{name:"创建任务"}));
  await screen.findByRole("alert");expect(screen.queryByText("任务已创建")).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});
it("keeps a confirmed result when opening Feishu or refreshing the parent fails",async()=>{
  request.mockResolvedValue(taskReply);openUrl.mockRejectedValue(Error("无法启动"));
  render(<WorkspaceCreateAction kind="task" onCreated={()=>{throw Error("刷新中断");}}/>);
  await draft("task","给小琼建个核对方案的任务");fireEvent.click(screen.getByRole("button",{name:"创建任务"}));
  await screen.findByText("任务已创建");
  expect(screen.getByText(/列表刷新未完成/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"在飞书中查看"}));
  await screen.findByText(/无法打开飞书/);
  expect(screen.getByText("任务已创建")).toBeTruthy();expect(request).toHaveBeenCalledTimes(1);
});
it("enforces the published 500-character limit without requiring a command template",async()=>{
  render(<WorkspaceCreateAction kind="task"/>);await draft("task","字".repeat(501));
  expect((screen.getByRole("button",{name:"创建任务"}) as HTMLButtonElement).disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});
it("does not publish late callbacks after the composer unmounts",async()=>{
  const pending=deferred<typeof taskReply>();request.mockReturnValue(pending.promise);const onCreated=vi.fn();
  const view=render(<WorkspaceCreateAction kind="task" onCreated={onCreated}/>);
  await draft("task","给小琼建个任务");fireEvent.click(screen.getByRole("button",{name:"创建任务"}));view.unmount();
  await act(async()=>pending.resolve(taskReply));expect(onCreated).not.toHaveBeenCalled();expect(request).toHaveBeenCalledTimes(1);
});

it("uses a fresh ID only for an explicit new creation and ignores an old refresh failure",async()=>{
  const refresh=deferred<void>();request.mockResolvedValue(taskReply);
  const onCreated=vi.fn().mockReturnValueOnce(refresh.promise).mockReturnValue(undefined);
  render(<WorkspaceCreateAction kind="task" onCreated={onCreated}/>);
  await draft("task","给小琼创建第一项任务");fireEvent.click(screen.getByRole("button",{name:"创建任务"}));
  await screen.findByText("任务已创建");
  fireEvent.click(screen.getByRole("button",{name:"再创建一项"}));
  fireEvent.change(screen.getByRole("textbox"),{target:{value:"给小琼创建第二项任务"}});
  fireEvent.click(screen.getByRole("button",{name:"创建任务"}));
  await waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls[0][0].requestId).not.toBe(request.mock.calls[1][0].requestId);
  await act(async()=>refresh.reject(Error("旧列表刷新失败")));
  expect(screen.queryByText(/列表刷新未完成/)).toBeNull();
});

it("does not expose an unsafe source URL as a clickable action",async()=>{
  request.mockResolvedValue({...taskReply,receipt:{...taskReply.receipt,url:"https://other.example/unsafe"}});
  render(<WorkspaceCreateAction kind="task"/>);await draft("task","给小琼建个任务");
  fireEvent.click(screen.getByRole("button",{name:"创建任务"}));await screen.findByText("任务已创建");
  expect(screen.queryByRole("button",{name:"在飞书中查看"})).toBeNull();expect(openUrl).not.toHaveBeenCalled();
});
it("counts Unicode characters like the native API instead of truncating emoji at UTF-16 length",async()=>{
  request.mockResolvedValue(taskReply);render(<WorkspaceCreateAction kind="task"/>);await draft("task","🙂".repeat(500));
  expect((screen.getByRole("button",{name:"创建任务"}) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"创建任务"}));await screen.findByText("任务已创建");
  expect(request.mock.calls[0][0].prompt).toBe("🙂".repeat(500));
});
