// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FeishuConnectionSettings } from "./FeishuConnectionSettings";
const experimentsRequest = vi.hoisted(() => vi.fn<typeof import("../experiments/client").experimentsRequest>());

const openExternalUrl = vi.hoisted(() => vi.fn<(url: string) => Promise<void>>(async () => undefined));
vi.mock("../client", () => ({ openFeishuUrl: openExternalUrl }));
vi.mock("../experiments/client", () => ({ experimentsRequest: (request: import("../experiments/client").ExperimentsRequest) => request.action === "feishuCliStatus" ? Promise.resolve({ installed: true, version: "1.0.98" }) : experimentsRequest(request) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("starts browser authorization and waits for explicit completion before syncing", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) => {
    if (request.action === "feishuAuthStatus")
      return { connected: false, message: "尚未连接" } as never;
    if (request.action === "feishuAuthStart")
      return {
        verificationUrl: "https://accounts.feishu.cn/oauth/verify",
        flowId: "flow",
        qrDataUrl: "data:image/png;base64,dGVzdA==",
      } as never;
    if (request.action === "feishuAuthComplete")
      return { connected: true, message: "已连接" } as never;
    return { recipients: [], lastSync: 12, partial: false } as never;
  });
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />);
  await screen.findByText("尚未连接");
  fireEvent.click(screen.getByRole("button", { name: "连接飞书" }));
  const link = await screen.findByRole("link", { name: "在浏览器中授权飞书" });
  expect(screen.getByRole("img", { name: "飞书授权二维码" })).toBeTruthy();
  expect(link.getAttribute("href")).toBe(
    "https://accounts.feishu.cn/oauth/verify",
  );
  fireEvent.click(link);
  await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith(
    "https://accounts.feishu.cn/oauth/verify",
  ));
  expect(experimentsRequest).not.toHaveBeenCalledWith({
    action: "feishuAuthComplete",
    flowId: "flow",
  });
  fireEvent.click(screen.getByRole("button", { name: "我已完成授权" }));
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({ action: "feishuSync" }),
  );
});
it("shows browser launch failure and permits retry without completing authorization", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) =>
    (request.action === "feishuAuthStatus"
      ? { connected: false, message: "尚未连接" }
      : { verificationUrl: "https://accounts.feishu.cn/oauth/verify", flowId: "flow" }) as never,
  );
  openExternalUrl.mockRejectedValueOnce(new Error("默认浏览器无法启动"));
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />);
  await screen.findByText("尚未连接");
  fireEvent.click(screen.getByRole("button", { name: "连接飞书" }));
  const link = await screen.findByRole("link", { name: "在浏览器中授权飞书" });
  fireEvent.click(link);
  expect((await screen.findByRole("alert")).textContent).toContain("默认浏览器无法启动");
  fireEvent.click(link);
  await waitFor(() => expect(openExternalUrl).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(experimentsRequest).not.toHaveBeenCalledWith({ action: "feishuAuthComplete", flowId: "flow" });
});
it("shows partial catalog, manually updates and saves the chosen parsing model", async () => {
  vi.mocked(experimentsRequest).mockImplementation(
    async (request) =>
      (request.action === "feishuSync"
        ? { recipients: [], lastSync: 12, partial: false }
        : { connected: true, message: "已连接" }) as never,
  );
  const onModelChange = vi.fn();
  render(
    <FeishuConnectionSettings
      model="llm"
      catalog={{ recipients: [], lastSync: 12, partial: true }}
      onModelChange={onModelChange}
    />,
  );
  expect(screen.getByText(/仅同步了部分/)).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "对象匹配方式" }));
  await user.click(await screen.findByRole("option", { name: "JEV 决策模型" }));
  expect(onModelChange).toHaveBeenCalledWith("jev");
  await screen.findByText("已连接", { selector: "p" });
  fireEvent.click(screen.getByRole("button", { name: "更新通讯录" }));
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({ action: "feishuSync" }),
  );
});
it("preserves local catalog and shows an update error without claiming synchronization succeeded", async () => {
  vi.mocked(experimentsRequest)
    .mockResolvedValueOnce({ connected: true, message: "已连接" } as never)
    .mockRejectedValue(new Error("权限不足"));
  render(
    <FeishuConnectionSettings
      model="llm"
      onModelChange={vi.fn()}
      catalog={{ recipients: [], lastSync: null, partial: false }}
    />,
  );
  await screen.findByText("已连接", { selector: "p" });
  fireEvent.click(screen.getByRole("button", { name: "更新通讯录" }));
  expect((await screen.findByRole("alert")).textContent).toContain("权限不足");
});
it("runs a synthetic comparison without connection and displays incomplete results honestly", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) => {
    if (request.action === "feishuAuthStatus")
      return { connected: false, message: "尚未连接" } as never;
    return {
      executed: true,
      complete: false,
      caseCount: 3,
      summary: {
        llm: {
          cases: 3,
          correct: 2,
          falseSelections: 1,
          rejections: 0,
          failures: 0,
          sampleAccuracy: 0.67,
          meanLatencyMs: 320,
        },
        jev: {
          cases: 3,
          correct: 0,
          falseSelections: 0,
          rejections: 0,
          failures: 3,
          sampleAccuracy: null,
          meanLatencyMs: null,
        },
      },
      limitations: ["JEV尚未配置，不能得出比较结论"],
    } as never;
  });
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />);
  await screen.findByText("尚未连接");
  fireEvent.click(screen.getByRole("button", { name: "比较解析策略" }));
  await screen.findByText(/对比未完整/);
  expect(screen.getByText(/合成样例：3/)).toBeTruthy();
  expect(screen.getByText(/文字模型：正确 2.*误选 1.*320/)).toBeTruthy();
  expect(screen.getByText(/JEV：正确 0.*误选 0.*未测得/)).toBeTruthy();
  expect(screen.getByText("JEV尚未配置，不能得出比较结论")).toBeTruthy();
  expect(experimentsRequest).toHaveBeenCalledWith({ action: "feishuCompare" });
  expect(experimentsRequest).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: "feishuSend" }),
  );
});
it("does not label an unexecuted model comparison as successful", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) =>
    request.action === "feishuAuthStatus"
      ? ({ connected: false, message: "未连接" } as never)
      : ({
          executed: false,
          complete: false,
          caseCount: 0,
          summary: {
            llm: {
              cases: 0,
              correct: 0,
              falseSelections: 0,
              rejections: 0,
              failures: 0,
              sampleAccuracy: null,
              meanLatencyMs: null,
            },
            jev: {
              cases: 0,
              correct: 0,
              falseSelections: 0,
              rejections: 0,
              failures: 0,
              sampleAccuracy: null,
              meanLatencyMs: null,
            },
          },
          limitations: ["文字模型未配置"],
        } as never),
  );
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "比较解析策略" }));
  await screen.findByText(/对比尚未执行/);
  expect(screen.queryByText(/对比完成/)).toBeNull();
});
it("shows a comparison request failure without claiming completed results", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) => {
    if (request.action === "feishuAuthStatus")
      return { connected: false, message: "未连接" } as never;
    throw new Error("模型连接失败");
  });
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />);
  expect(screen.getByText(/可能产生正常模型用量/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "比较解析策略" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "模型连接失败",
  );
  expect(screen.queryByLabelText("解析策略对比报告")).toBeNull();
});

it("declares the external recipient limitation while checking, disconnected and connected", async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({
    connected: false,
    message: "尚未连接",
  } as never);
  const { rerender } = render(
    <FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />,
  );
  expect(
    screen.getByText(/暂不支持向外部联系人（跨组织）发送消息/),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "更新通讯录" })).toHaveProperty(
    "disabled",
    true,
  );
  await screen.findByText("尚未连接");
  expect(screen.getByRole("button", { name: "更新通讯录" })).toHaveProperty(
    "disabled",
    true,
  );
  rerender(<FeishuConnectionSettings model="jev" onModelChange={vi.fn()} />);
  expect(
    screen.getByText(/暂不支持向外部联系人（跨组织）发送消息/),
  ).toBeTruthy();
});
it("ends an unsuccessful connection check and offers an explicit retry", async () => {
  vi.mocked(experimentsRequest)
    .mockRejectedValueOnce(new Error("连接检查失败"))
    .mockResolvedValueOnce({ connected: true, message: "已连接" } as never);
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />);
  await screen.findByRole("alert");
  expect(screen.queryByText("正在检查飞书连接…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
  await screen.findByText("已连接", { selector: "p" });
  expect(screen.getByRole("button", { name: "更新通讯录" })).toHaveProperty(
    "disabled",
    false,
  );
});
it("shows synchronization progress, locks repeated requests and uses a newer parent catalog", async () => {
  let finish!: (value: never) => void;
  vi.mocked(experimentsRequest).mockImplementation(async (request) => {
    if (request.action === "feishuAuthStatus")
      return { connected: true, message: "已连接" } as never;
    return new Promise<never>((resolve) => {
      finish = resolve;
    });
  });
  const { rerender } = render(
    <FeishuConnectionSettings
      model="llm"
      onModelChange={vi.fn()}
      catalog={{ recipients: [], lastSync: 12, partial: false }}
    />,
  );
  await screen.findByText("已连接", { selector: "p" });
  fireEvent.click(screen.getByRole("button", { name: "更新通讯录" }));
  const progress = screen.getByRole("button", { name: "正在更新…" });
  fireEvent.click(progress);
  expect(experimentsRequest).toHaveBeenCalledTimes(2);
  finish({ recipients: [], lastSync: 20, partial: false } as never);
  await screen.findByRole("button", { name: "更新通讯录" });
  rerender(
    <FeishuConnectionSettings
      model="llm"
      onModelChange={vi.fn()}
      catalog={{
        recipients: [{ id: "new", name: "新对象", kind: "person" }],
        lastSync: 30,
        partial: false,
      }}
    />,
  );
  expect(screen.getByText(/已缓存 1 个对象/)).toBeTruthy();
});
it("does not allow unsafe authorization links or complete the associated flow", async () => {
  vi.mocked(experimentsRequest).mockImplementation(
    async (request) =>
      (request.action === "feishuAuthStatus"
        ? { connected: false, message: "尚未连接" }
        : {
            verificationUrl: "javascript:alert(1)",
            flowId: "invalid",
          }) as never,
  );
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />);
  await screen.findByText("尚未连接");
  fireEvent.click(screen.getByRole("button", { name: "连接飞书" }));
  await screen.findByText("授权链接无效，请重新连接。");
  expect(screen.queryByRole("link", { name: "在浏览器中授权飞书" })).toBeNull();
  expect(screen.getByRole("button", { name: "我已完成授权" })).toHaveProperty(
    "disabled",
    true,
  );
});

it("blocks authorization until the initial check ends and keeps the limitation when connected", async () => {
  let finish!: (value: never) => void;
  vi.mocked(experimentsRequest).mockImplementation(
    () =>
      new Promise<never>((resolve) => {
        finish = resolve;
      }),
  );
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />);
  const connect = screen.getByRole("button", { name: "连接飞书" });
  expect(connect).toHaveProperty("disabled", true);
  fireEvent.click(connect);
  expect(vi.mocked(experimentsRequest).mock.calls.filter(([request]) => request.action === "feishuAuthStatus")).toHaveLength(1);
  finish({ connected: true, message: "已连接" } as never);
  await screen.findByRole("button", { name: "重新授权" });
  expect(
    screen.getByText(/暂不支持向外部联系人（跨组织）发送消息/),
  ).toBeTruthy();
});

it("keeps a completed authorization when its subsequent directory sync fails", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) => {
    if (request.action === "feishuAuthStatus")
      return { connected: false, message: "尚未连接" } as never;
    if (request.action === "feishuAuthStart")
      return {
        verificationUrl: "https://accounts.feishu.cn/verify",
        flowId: "flow",
      } as never;
    if (request.action === "feishuAuthComplete")
      return { connected: true, message: "已连接" } as never;
    throw new Error("通讯录同步失败");
  });
  render(
    <FeishuConnectionSettings
      model="llm"
      onModelChange={vi.fn()}
      catalog={{
        recipients: [{ id: "old", name: "旧对象", kind: "person" }],
        lastSync: 12,
        partial: true,
      }}
    />,
  );
  await screen.findByText("尚未连接");
  fireEvent.click(screen.getByRole("button", { name: "连接飞书" }));
  fireEvent.click(await screen.findByRole("button", { name: "我已完成授权" }));
  await screen.findByText("通讯录同步失败");
  expect(screen.getByRole("button", { name: "更新通讯录" })).toHaveProperty(
    "disabled",
    false,
  );
  expect(screen.getByText(/已缓存 1 个对象/)).toBeTruthy();
  expect(screen.queryByLabelText("飞书授权")).toBeNull();
});

it("keeps a newly synced catalog when the parent has the same second timestamp", async () => {
  vi.mocked(experimentsRequest).mockImplementation(
    async (request) =>
      (request.action === "feishuAuthStatus"
        ? { connected: true, message: "已连接" }
        : {
            recipients: [{ id: "new", name: "新对象", kind: "person" }],
            lastSync: 12,
            partial: false,
          }) as never,
  );
  render(
    <FeishuConnectionSettings
      model="llm"
      onModelChange={vi.fn()}
      catalog={{ recipients: [], lastSync: 12, partial: false }}
    />,
  );
  await screen.findByRole("button", { name: "重新授权" });
  fireEvent.click(screen.getByRole("button", { name: "更新通讯录" }));
  await screen.findByText(/已缓存 1 个对象/);
});

it("allows authorization after the status check fails without requiring a successful retry", async () => {
  vi.mocked(experimentsRequest)
    .mockRejectedValueOnce(new Error("连接检查失败"))
    .mockResolvedValueOnce({
      verificationUrl: "https://accounts.feishu.cn/oauth/verify",
      flowId: "recovery",
    } as never);
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />);
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "重新检查" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "连接飞书" }));
  await screen.findByRole("link", { name: "在浏览器中授权飞书" });
  expect(experimentsRequest).toHaveBeenLastCalledWith({
    action: "feishuAuthStart",
  });
});

it("uses one reauthorization entry for all permissions and shows partial grants", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async request => {
    if (request.action === "feishuAuthStatus") return {connected:true,calendarConnected:false,allPermissionsGranted:false,message:"消息已连接，请重新授权补齐任务与日历权限"} as never;
    if (request.action === "feishuAuthStart") return {verificationUrl:"https://accounts.feishu.cn/oauth/unified",flowId:"unified-flow"} as never;
    return {} as never;
  });
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} />);
  const reconnect = await screen.findByRole("button", {name:"重新授权"});
  expect(screen.getByText("需补充授权")).toBeTruthy();
  expect(screen.queryByRole("button",{name:/授权日历/})).toBeNull();
  fireEvent.click(reconnect);
  await screen.findByRole("link",{name:"在浏览器中授权飞书"});
  expect(experimentsRequest).toHaveBeenCalledWith({action:"feishuAuthStart"});
  expect(experimentsRequest).not.toHaveBeenCalledWith({action:"feishuCalendarAuthStart"});
});

it("refreshes a disconnected parent snapshot from native status", async () => {
  const notify = vi.fn();
  vi.mocked(experimentsRequest).mockImplementation(async (request) => (request.action === "feishuAuthStatus" ? { connected: true, message: "最新已连接" } : { installed: true }) as never);
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} initialAuth={{connected:false,message:"旧未连接"}} onStatusChange={notify} />);
  await screen.findByText("最新已连接");
  expect(screen.getByRole("button", {name:"更新通讯录"})).toHaveProperty("disabled", false);
  expect(notify).toHaveBeenCalledExactlyOnceWith({connected:true,message:"最新已连接"});
});

it("keeps recheck available for a disconnected snapshot", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) => (request.action === "feishuAuthStatus" ? { connected: false, message: "未授权" } : { installed: true }) as never);
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()} initialAuth={{connected:false,message:"旧未连接"}} />);
  await waitFor(() => expect(screen.getByRole("button", {name:"重新检查"})).toHaveProperty("disabled", false));
  vi.mocked(experimentsRequest).mockResolvedValue({connected:true,message:"重查已连接"} as never);
  fireEvent.click(screen.getByRole("button", {name:"重新检查"}));
  await screen.findByText("重查已连接");
});

it("does not echo the controlled authorization snapshot back into its parent", async () => {
  // A prop update must not echo; a completed native check is a new observation.
  vi.mocked(experimentsRequest).mockImplementation(() => new Promise(() => {}));
  const notify = vi.fn();
  const initialAuth = { connected: true, message: "父页面授权快照" };
  const view = render(
    <FeishuConnectionSettings
      model="llm"
      initialAuth={initialAuth}
      onStatusChange={notify}
      onModelChange={vi.fn()}
    />,
  );
  await screen.findByText("父页面授权快照");
  expect(notify).not.toHaveBeenCalled();
  view.rerender(
    <FeishuConnectionSettings
      model="llm"
      initialAuth={{ ...initialAuth, message: "更新后的授权快照" }}
      onStatusChange={(value) => notify(value)}
      onModelChange={vi.fn()}
    />,
  );
  await screen.findByText("更新后的授权快照");
  expect(notify).not.toHaveBeenCalled();
});

it("restores a pending device flow from native status after returning to settings", async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({
    connected: true,
    allPermissionsGranted: false,
    message: "仍需确认",
    pendingAuthorization: {
      verificationUrl: "https://accounts.feishu.cn/oauth/resume",
      flowId: "original-flow",
    },
  } as never);
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()}
    initialAuth={{ connected: true, message: "旧状态" }} />);
  const link = await screen.findByRole("link", { name: "在浏览器中授权飞书" });
  expect(link.getAttribute("href")).toBe("https://accounts.feishu.cn/oauth/resume");
  expect(experimentsRequest).not.toHaveBeenCalledWith({ action: "feishuAuthStart" });
});

it("keeps native checks bounded when the parent accepts fresh status objects", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async () => ({ connected: true, message: "最新快照" }) as never);
  function Parent() {
    const [snapshot, setSnapshot] = useState<import("../experiments/client").FeishuAuthStatus>();
    return <FeishuConnectionSettings model="llm" onModelChange={vi.fn()} initialAuth={snapshot} onStatusChange={setSnapshot} />;
  }
  render(<Parent />);
  await screen.findByText("最新快照", { selector: "p" });
  await waitFor(() => expect(vi.mocked(experimentsRequest).mock.calls.filter(([request]) => request.action === "feishuAuthStatus")).toHaveLength(1));
});

it("ignores a stale mount check after the user starts a newer authorization", async () => {
  let resolveCheck!: (value: unknown) => void;
  const check = new Promise((resolve) => { resolveCheck = resolve; });
  vi.mocked(experimentsRequest).mockImplementation(async (request) => {
    if (request.action === "feishuAuthStatus") return await check as never;
    return { verificationUrl: "https://accounts.feishu.cn/oauth/new", flowId: "new-flow" } as never;
  });
  render(<FeishuConnectionSettings model="llm" onModelChange={vi.fn()}
    initialAuth={{ connected: true, message: "旧快照" }} />);
  fireEvent.click(screen.getByRole("button", { name: "重新授权" }));
  await screen.findByRole("link", { name: "在浏览器中授权飞书" });
  await act(async () => { resolveCheck({ connected: true, message: "过时检查结果" }); });
  await waitFor(() => expect(screen.getByRole("link", { name: "在浏览器中授权飞书" }).getAttribute("href"))
    .toBe("https://accounts.feishu.cn/oauth/new"));
});
