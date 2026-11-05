// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FeishuOverview } from "./FeishuOverview";
import type { ExperimentsConfig } from "../experiments/client";
afterEach(cleanup);
it("keeps the main actions concise and reveals speech examples on demand", async () => {
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(
    <FeishuOverview
      auth={{
        connected: true,
        allPermissionsGranted: true,
        message: "冗长的后台连接诊断",
      }}
      authPending={false}
      config={{ feishuTools: true } as ExperimentsConfig}
      replies={[]}
      onNavigate={navigate}
    />,
  );
  await user.click(screen.getByRole("button", { name: /管理任务/ }));
  expect(navigate).toHaveBeenCalledWith("tasks");
  expect(screen.queryByText("冗长的后台连接诊断")).toBeNull();
  const examples = screen.getByText("试试这样说").closest("details")!;
  expect(examples.open).toBe(false);
  await user.click(screen.getByText("试试这样说"));
  expect(examples.open).toBe(true);
  expect(screen.getByText(/给小琼创建任务，内容是整理项目资料/)).toBeTruthy();
});
it("keeps missing permissions visible with a direct repair action", async () => {
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(
    <FeishuOverview
      auth={{
        connected: true,
        allPermissionsGranted: false,
        message: "请补充任务与日历权限",
      }}
      authPending={false}
      config={{ feishuTools: true } as ExperimentsConfig}
      replies={[]}
      onNavigate={navigate}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "请补充任务与日历权限",
  );
  await user.click(screen.getByRole("button", { name: "补充授权" }));
  expect(navigate).toHaveBeenCalledWith("settings");
});
