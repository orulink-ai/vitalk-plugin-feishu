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
import { AgentVoiceShortcut } from "./AgentVoiceShortcut";
import { experimentsRequest } from "./client";

vi.mock("./client", () => ({ experimentsRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const config = {
  pluginShortcuts: [
    {
      pluginId: "vitalk-plugin-feishu",
      purpose: "message",
      hotkey: "Ctrl+Alt+F6",
      trigger: "toggle",
    },
    {
      pluginId: "vitalk-plugin-feishu",
      purpose: "task",
      hotkey: "Shift+A",
      trigger: "toggle",
    },
    {
      pluginId: "vitalk-plugin-feishu",
      purpose: "calendar",
      hotkey: "Ctrl+Alt+F8",
      trigger: "toggle",
    },
  ],
};

it("captures each purpose through SDK and releases native capture after saving", async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({} as never);
  const saved = vi.fn();
  render(
    <AgentVoiceShortcut
      config={config}
      enabled
      onToggleEnabled={vi.fn()}
      onSaved={saved}
    />,
  );
  expect(
    screen.getByRole("button", { name: "任务 唤醒快捷键" }).textContent,
  ).toBe("Shift+A");
  fireEvent.click(screen.getByRole("button", { name: "日程 唤醒快捷键" }));
  await screen.findByText("按下组合键 · Esc 取消");
  fireEvent.keyDown(window, {
    key: "F8",
    code: "F8",
    ctrlKey: true,
    altKey: true,
  });
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(experimentsRequest).toHaveBeenNthCalledWith(1, {
    action: "feishuShortcutCapture",
    active: true,
  });
  expect(experimentsRequest).toHaveBeenNthCalledWith(2, {
    action: "feishuShortcutSet",
    purpose: "calendar",
    hotkey: "Ctrl+Alt+F8",
  });
  expect(experimentsRequest).toHaveBeenNthCalledWith(3, {
    action: "feishuShortcutCapture",
    active: false,
  });
});

it("shows conflict errors, retains the prior shortcut and resumes native capture", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) => {
    if (request.action === "feishuShortcutSet")
      throw new Error("快捷键与听写冲突");
    return {} as never;
  });
  const saved = vi.fn();
  render(
    <AgentVoiceShortcut
      config={config}
      enabled
      onToggleEnabled={vi.fn()}
      onSaved={saved}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "任务 唤醒快捷键" }));
  await screen.findByText("按下组合键 · Esc 取消");
  fireEvent.keyDown(window, { key: "a", code: "KeyA", ctrlKey: true });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "快捷键与听写冲突",
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "任务 唤醒快捷键" }).textContent,
    ).toBe("Shift+A"),
  );
  expect(experimentsRequest).toHaveBeenCalledWith({
    action: "feishuShortcutCapture",
    active: false,
  });
  expect(saved).not.toHaveBeenCalled();
});

it("cancels keyboard capture without overwriting the saved shortcut", async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({} as never);
  render(
    <AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "消息 唤醒快捷键" }));
  await screen.findByText("按下组合键 · Esc 取消");
  fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "消息 唤醒快捷键" }).textContent,
    ).toBe("Ctrl+Alt+F6"),
  );
  expect(experimentsRequest).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: "feishuShortcutSet" }),
  );
  expect(experimentsRequest).toHaveBeenCalledWith({
    action: "feishuShortcutCapture",
    active: false,
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("releases global capture when the component unmounts before acquisition finishes", async () => {
  const start = deferred<never>();
  vi.mocked(experimentsRequest).mockImplementation((request) =>
    request.action === "feishuShortcutCapture" && request.active
      ? start.promise
      : Promise.resolve({} as never),
  );
  const view = render(
    <AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "消息 唤醒快捷键" }));
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({
      action: "feishuShortcutCapture",
      active: true,
    }),
  );
  view.unmount();
  await act(async () => start.resolve({} as never));
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({
      action: "feishuShortcutCapture",
      active: false,
    }),
  );
});
it("can cancel pending capture and keeps the saved binding without saving", async () => {
  const start = deferred<never>();
  vi.mocked(experimentsRequest).mockImplementation((request) =>
    request.action === "feishuShortcutCapture" && request.active
      ? start.promise
      : Promise.resolve({} as never),
  );
  render(
    <AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "消息 唤醒快捷键" }));
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({
      action: "feishuShortcutCapture",
      active: true,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "取消设置快捷键" }));
  await act(async () => start.resolve({} as never));
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({
      action: "feishuShortcutCapture",
      active: false,
    }),
  );
  expect(experimentsRequest).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: "feishuShortcutSet" }),
  );
  expect(
    screen.getByRole("button", { name: "消息 唤醒快捷键" }).textContent,
  ).toContain("Ctrl+Alt+F6");
});
it("does not release a newer capture owned by a replacement component", async () => {
  const start = deferred<never>();
  let captures = 0;
  vi.mocked(experimentsRequest).mockImplementation((request) =>
    request.action === "feishuShortcutCapture" &&
    request.active &&
    ++captures === 1
      ? start.promise
      : Promise.resolve({} as never),
  );
  const first = render(
    <AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "消息 唤醒快捷键" }));
  first.unmount();
  render(
    <AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "任务 唤醒快捷键" }));
  await act(async () => start.resolve({} as never));
  await screen.findByText("按下组合键 · Esc 取消");
  fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenLastCalledWith({
      action: "feishuShortcutCapture",
      active: false,
    }),
  );
  expect(experimentsRequest).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: "feishuShortcutSet" }),
  );
});

it("releases capture on unmount while a save is pending without a late callback", async () => {
  const written = deferred<never>();
  const saved = vi.fn();
  vi.mocked(experimentsRequest).mockImplementation((request) =>
    request.action === "feishuShortcutSet"
      ? written.promise
      : Promise.resolve({} as never),
  );
  const view = render(
    <AgentVoiceShortcut
      config={config}
      enabled
      onToggleEnabled={vi.fn()}
      onSaved={saved}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "任务 唤醒快捷键" }));
  await screen.findByText("按下组合键 · Esc 取消");
  fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({
      action: "feishuShortcutSet",
      purpose: "task",
      hotkey: "Ctrl+B",
    }),
  );
  view.unmount();
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({
      action: "feishuShortcutCapture",
      active: false,
    }),
  );
  await act(async () => written.resolve({} as never));
  expect(saved).not.toHaveBeenCalled();
});
it("restores shortcuts even when acquiring capture returns an error", async () => {
  vi.mocked(experimentsRequest).mockImplementation(async (request) => {
    if (request.action === "feishuShortcutCapture" && request.active)
      throw new Error("监听启动失败");
    return {} as never;
  });
  render(
    <AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "消息 唤醒快捷键" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "监听启动失败",
  );
  await waitFor(() =>
    expect(experimentsRequest).toHaveBeenCalledWith({
      action: "feishuShortcutCapture",
      active: false,
    }),
  );
  expect(
    screen.getByRole("button", { name: "消息 唤醒快捷键" }).textContent,
  ).toContain("Ctrl+Alt+F6");
});
it("keeps a confirmed save and offers recovery if resuming shortcuts fails", async () => {
  let releases = 0;
  const saved = vi.fn();
  vi.mocked(experimentsRequest).mockImplementation(async (request) => {
    if (
      request.action === "feishuShortcutCapture" &&
      !request.active &&
      ++releases === 1
    )
      throw new Error("恢复暂不可用");
    return {} as never;
  });
  render(
    <AgentVoiceShortcut
      config={config}
      enabled
      onToggleEnabled={vi.fn()}
      onSaved={saved}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "任务 唤醒快捷键" }));
  await screen.findByText("按下组合键 · Esc 取消");
  fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
  const retry = await screen.findByRole("button", { name: "重试恢复快捷键" });
  expect(
    screen.getByRole("button", { name: "任务 唤醒快捷键" }).textContent,
  ).toContain("Ctrl+B");
  fireEvent.click(retry);
  await screen.findByText("快捷键监听已恢复。");
  expect(saved).toHaveBeenCalledOnce();
  expect(releases).toBe(2);
});

it("dispatches release before unmount returns so SDK disposal cannot drop an idle cleanup", async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({} as never);
  const view = render(
    <AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "消息 唤醒快捷键" }));
  await screen.findByText("按下组合键 · Esc 取消");
  view.unmount();
  expect(experimentsRequest).toHaveBeenLastCalledWith({
    action: "feishuShortcutCapture",
    active: false,
  });
});

it("does not announce restored shortcuts when recovery fails repeatedly", async () => {
  let releases = 0;
  vi.mocked(experimentsRequest).mockImplementation(async (request) => {
    if (
      request.action === "feishuShortcutCapture" &&
      !request.active &&
      ++releases < 3
    )
      throw new Error("恢复仍失败");
    return {} as never;
  });
  render(
    <AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "消息 唤醒快捷键" }));
  await screen.findByText("按下组合键 · Esc 取消");
  fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
  fireEvent.click(
    await screen.findByRole("button", { name: "重试恢复快捷键" }),
  );
  await waitFor(() => expect(releases).toBe(2));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "重试恢复快捷键" }),
    ).toHaveProperty("disabled", false),
  );
  expect(screen.queryByText("快捷键监听已恢复。")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("恢复仍失败");
  expect(
    screen.getByRole("button", { name: "消息 唤醒快捷键" }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "重试恢复快捷键" }));
  await screen.findByText("快捷键监听已恢复。");
  expect(screen.queryByRole("alert")).toBeNull();
});
