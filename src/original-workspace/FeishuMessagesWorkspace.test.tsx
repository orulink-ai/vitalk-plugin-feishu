// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FeishuMessagesWorkspace } from "./FeishuMessagesWorkspace";
import {
  experimentsRequest,
  type ExperimentsSnapshot,
} from "../experiments/client";
vi.mock("../experiments/client", () => ({ experimentsRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const person = { id: "ou_qiong", name: "小琼", kind: "person" as const };
const other = { id: "ou_ice", name: "小冰", kind: "person" as const };
const ready = {
  id: "draft-real",
  prompt: "给小琼发消息说资料好了",
  content: "资料好了",
  recipient: person,
  status: "ready" as const,
};
const snapshot = (
  draft: ExperimentsSnapshot["feishuDraft"] = null,
): ExperimentsSnapshot => ({
  config: { feishuTools: true },
  feishuCatalog: { recipients: [person, other], lastSync: 1, partial: false },
  feishuDraft: draft,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("prepares a native draft, lets the user edit it, then explicitly sends that same id", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) =>
    request.action === "feishuPrepare"
      ? ready
      : ({
          ...ready,
          content: request.content,
          status: "sent",
          receipt: "om_actual",
        } as never),
  );
  render(<FeishuMessagesWorkspace snapshot={snapshot()} />);
  fireEvent.change(screen.getByLabelText("要发送的消息"), {
    target: { value: ready.prompt },
  });
  const prepareButton = screen.getByRole("button", { name: "生成消息草稿" });
  expect(prepareButton.getAttribute("type")).toBe("button");
  fireEvent.click(prepareButton);
  await screen.findByDisplayValue("资料好了");
  expect(experimentsRequest).toHaveBeenCalledWith({
    action: "feishuPrepare",
    prompt: ready.prompt,
  });
  expect(experimentsRequest).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: "feishuSend" }),
  );
  fireEvent.change(screen.getByLabelText("发送内容"), {
    target: { value: "资料好了，请查收" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
  await screen.findByText("消息回执：om_actual");
  expect(experimentsRequest).toHaveBeenCalledWith({
    action: "feishuSend",
    id: "draft-real",
    recipientId: "ou_qiong",
    content: "资料好了，请查收",
    attachmentIds: [],
  });
});
it("preserves unsaved edits across ready snapshots and adopts a native-window receipt", async () => {
  const view = render(<FeishuMessagesWorkspace snapshot={snapshot(ready)} />);
  fireEvent.change(screen.getByLabelText("发送内容"), {
    target: { value: "本地编辑" },
  });
  view.rerender(<FeishuMessagesWorkspace snapshot={snapshot({ ...ready })} />);
  expect(screen.getByLabelText("发送内容")).toHaveProperty("value", "本地编辑");
  view.rerender(
    <FeishuMessagesWorkspace
      snapshot={snapshot({ ...ready, status: "sent", receipt: "om_native" })}
    />,
  );
  await screen.findByText("消息回执：om_native");
  expect(screen.getByRole("button", { name: "已发送" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(experimentsRequest).not.toHaveBeenCalled();
});
it("blocks repeat sends and stale ready polls after an uncertain transport failure", async () => {
  vi.mocked(experimentsRequest).mockRejectedValue(new Error("连接中断"));
  const view = render(<FeishuMessagesWorkspace snapshot={snapshot(ready)} />);
  fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
  await screen.findByText(/发送结果不确定/);
  view.rerender(<FeishuMessagesWorkspace snapshot={snapshot({ ...ready })} />);
  expect(
    screen.getByRole("button", { name: "请先核实发送结果" }),
  ).toHaveProperty("disabled", true);
  expect(experimentsRequest).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "重新生成草稿" })).toBeNull();
});
it("does not replace a newer native draft with a late prepare response", async () => {
  const response = deferred<never>();
  vi.mocked(experimentsRequest).mockReturnValue(response.promise);
  const view = render(<FeishuMessagesWorkspace snapshot={snapshot()} />);
  fireEvent.change(screen.getByLabelText("要发送的消息"), {
    target: { value: ready.prompt },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成消息草稿" }));
  view.rerender(
    <FeishuMessagesWorkspace
      snapshot={snapshot({
        ...ready,
        id: "new-native",
        content: "新的原生草稿",
      })}
    />,
  );
  await act(async () => response.resolve(ready as never));
  expect(screen.getByLabelText("发送内容")).toHaveProperty(
    "value",
    "新的原生草稿",
  );
});
it("chooses a real searched recipient and sends only selected attachment ids", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) =>
    request.action === "feishuSearch"
      ? {
          recipients: [other],
          searchQuery: request.query,
          lastSync: 1,
          partial: false,
        }
      : ({ ...ready, status: "sent", receipt: "om_changed" } as never),
  );
  render(
    <FeishuMessagesWorkspace
      snapshot={snapshot({
        ...ready,
        attachments: [
          {
            id: "image-real",
            dataUrl: "data:image/png;base64,dGVzdA==",
            width: 1,
            height: 1,
          },
        ],
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "更换发送对象" }));
  fireEvent.change(screen.getByLabelText("搜索联系人、群聊或机器人"), {
    target: { value: "小兵" },
  });
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({
      action: "feishuSearch",
      query: "小兵",
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /小冰/ }));
  fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({
      action: "feishuSend",
      id: ready.id,
      recipientId: other.id,
      content: ready.content,
      attachmentIds: ["image-real"],
    }),
  );
});
it("uses the published voice path without preparing or sending automatically", async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({} as never);
  render(<FeishuMessagesWorkspace snapshot={snapshot()} />);
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledExactlyOnceWith({
      action: "messageVoiceToggle",
    }),
  );
});

it("never revives a replaced draft from an older polled snapshot", async () => {
  const sent = { ...ready, status: "sent" as const, receipt: "om_previous" };
  vi.mocked(experimentsRequest).mockResolvedValue({
    ...ready,
    id: "new-draft",
    content: "新的待发消息",
  } as never);
  const view = render(<FeishuMessagesWorkspace snapshot={snapshot(sent)} />);
  fireEvent.change(screen.getByLabelText("要发送的消息"), {
    target: { value: "给小琼发一条新消息" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成消息草稿" }));
  await screen.findByDisplayValue("新的待发消息");
  view.rerender(<FeishuMessagesWorkspace snapshot={snapshot({ ...sent })} />);
  expect(screen.getByLabelText("发送内容")).toHaveProperty(
    "value",
    "新的待发消息",
  );
});
it("treats missing or mismatched send receipts as uncertain rather than sent", async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({
    ...ready,
    id: "wrong-id",
    status: "sent",
    receipt: "om_wrong",
  } as never);
  render(<FeishuMessagesWorkspace snapshot={snapshot(ready)} />);
  fireEvent.click(screen.getByRole("button", { name: "确认发送" }));
  await screen.findByText(/发送结果不确定/);
  expect(screen.queryByText("消息回执：om_wrong")).toBeNull();
  expect(
    screen.getByRole("button", { name: "请先核实发送结果" }),
  ).toHaveProperty("disabled", true);
});
it("dismisses the exact reviewed draft and keeps it if dismissal fails", async () => {
  vi.mocked(experimentsRequest)
    .mockRejectedValueOnce(new Error("关闭失败"))
    .mockResolvedValue({ ok: true } as never);
  render(<FeishuMessagesWorkspace snapshot={snapshot(ready)} />);
  fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("发送内容")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));
  await waitFor(() => expect(screen.queryByLabelText("发送内容")).toBeNull());
  expect(experimentsRequest).toHaveBeenLastCalledWith({
    action: "feishuDismiss",
    id: ready.id,
  });
});

it("resumes recipient-dependent generation from the original native draft without sending", async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({
    ...ready,
    id: "resolved-draft",
  } as never);
  render(
    <FeishuMessagesWorkspace
      snapshot={snapshot({
        ...ready,
        content: "",
        recipient: undefined,
        awaitingRecipient: true,
        recipientQuery: "小琼",
        recipientCandidates: [person],
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择小琼" }));
  await screen.findByDisplayValue(ready.content);
  expect(experimentsRequest).toHaveBeenCalledWith({
    action: "feishuPrepare",
    prompt: ready.prompt,
    recipientSourceDraftId: ready.id,
    recipientId: person.id,
  });
  expect(experimentsRequest).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: "feishuSend" }),
  );
});

it("ignores retired nonempty snapshots after the replacement draft was observed and edited", () => {
  const old = { ...ready, id: "old-A" };
  const replacement = { ...ready, id: "new-B", content: "草稿B" };
  const view = render(<FeishuMessagesWorkspace snapshot={snapshot(old)} />);
  view.rerender(<FeishuMessagesWorkspace snapshot={snapshot(replacement)} />);
  fireEvent.change(screen.getByLabelText("发送内容"), {
    target: { value: "草稿B本地修改" },
  });
  view.rerender(
    <FeishuMessagesWorkspace snapshot={snapshot({ ...replacement })} />,
  );
  view.rerender(<FeishuMessagesWorkspace snapshot={snapshot({ ...old })} />);
  expect(screen.getByLabelText("发送内容")).toHaveProperty(
    "value",
    "草稿B本地修改",
  );
  view.rerender(
    <FeishuMessagesWorkspace snapshot={{ config: { feishuTools: true } }} />,
  );
  expect(screen.getByLabelText("发送内容")).toHaveProperty(
    "value",
    "草稿B本地修改",
  );
  view.rerender(<FeishuMessagesWorkspace snapshot={snapshot(null)} />);
  expect(screen.queryByLabelText("发送内容")).toBeNull();
});
it.each(["sending", "unknown"] as const)(
  "never regresses a native %s draft to sendable ready from an old poll",
  (status) => {
    const view = render(
      <FeishuMessagesWorkspace snapshot={snapshot({ ...ready, status })} />,
    );
    view.rerender(
      <FeishuMessagesWorkspace snapshot={snapshot({ ...ready })} />,
    );
    expect(screen.queryByRole("button", { name: "确认发送" })).toBeNull();
    expect(screen.getByLabelText("发送内容")).toHaveProperty("disabled", true);
    expect(experimentsRequest).not.toHaveBeenCalled();
  },
);

it.each(["sent", "unknown", "failed", "sending"] as const)(
  "keeps a local %s receipt or submission when the native popup clears its draft",
  (status) => {
    const local = {
      ...ready,
      status,
      receipt: status === "sent" ? "om_confirmed" : undefined,
      error: status === "failed" ? "飞书拒绝发送" : undefined,
    };
    const view = render(<FeishuMessagesWorkspace snapshot={snapshot(local)} />);
    view.rerender(<FeishuMessagesWorkspace snapshot={snapshot(null)} />);
    expect(screen.getByLabelText("发送内容")).toHaveProperty(
      "value",
      ready.content,
    );
    expect(screen.getByLabelText("发送内容")).toHaveProperty("disabled", true);
    const sendButton = screen.queryByRole("button", { name: "确认发送" });
    if (sendButton) expect(sendButton).toHaveProperty("disabled", true);
    if (status === "sent")
      expect(screen.getByText("消息回执：om_confirmed")).toBeTruthy();
    expect(experimentsRequest).not.toHaveBeenCalled();
  },
);
it("retains a cleared native sent receipt until the user explicitly closes it", async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({ ok: true } as never);
  const view = render(
    <FeishuMessagesWorkspace
      snapshot={snapshot({ ...ready, status: "sent", receipt: "om_kept" })}
    />,
  );
  view.rerender(<FeishuMessagesWorkspace snapshot={snapshot(null)} />);
  expect(screen.getByText("消息回执：om_kept")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));
  await waitFor(() =>
    expect(screen.queryByText("消息回执：om_kept")).toBeNull(),
  );
  expect(experimentsRequest).toHaveBeenCalledExactlyOnceWith({
    action: "feishuDismiss",
    id: ready.id,
  });
});

it('recalls a confirmed plugin message and exposes terminal status without retry',async()=>{
 vi.mocked(experimentsRequest).mockResolvedValue({...ready,status:'recall_unknown',receipt:'om_actual'} as never);
 render(<FeishuMessagesWorkspace snapshot={snapshot({...ready,status:'sent',receipt:'om_actual'})} />);
 fireEvent.click(screen.getByRole('button',{name:'撤回消息'}));
 await waitFor(()=>expect(experimentsRequest).toHaveBeenCalledWith({action:'feishuRecall',id:ready.id,confirmed:true}));
 await screen.findByText('撤回结果待核实');
 expect(screen.queryByRole('button',{name:'撤回消息'})).toBeNull();
});

it('does not restore a recalled message from a stale sent snapshot',async()=>{
 vi.mocked(experimentsRequest).mockResolvedValue({...ready,status:'recalled',receipt:'om_actual'} as never);
 const view=render(<FeishuMessagesWorkspace snapshot={snapshot({...ready,status:'sent',receipt:'om_actual'})} />);
 fireEvent.click(screen.getByRole('button',{name:'撤回消息'}));await screen.findByText('消息已撤回');
 view.rerender(<FeishuMessagesWorkspace snapshot={snapshot({...ready,status:'sent',receipt:'om_actual'})} />);
 expect(screen.queryByRole('button',{name:'撤回消息'})).toBeNull();
});
it('keeps a proven pre-submit permission failure editable and allows another confirmation',async()=>{
 vi.mocked(experimentsRequest).mockRejectedValueOnce(Object.assign(Error('图片权限不足，请重新授权'),{code:'message_not_submitted'})).mockResolvedValueOnce({...ready,status:'sent',receipt:'om_retry'} as never);
 render(<FeishuMessagesWorkspace snapshot={snapshot(ready)} />);
 fireEvent.click(screen.getByRole('button',{name:'确认发送'}));
 await waitFor(()=>expect(screen.getByLabelText('发送内容')).toHaveProperty('disabled',false));
 fireEvent.click(screen.getByRole('button',{name:'确认发送'}));
 await screen.findByText('消息回执：om_retry');
 expect(experimentsRequest).toHaveBeenCalledTimes(2);
});
