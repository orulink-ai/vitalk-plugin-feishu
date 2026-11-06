// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {VoiceShortcutHint} from "./VoiceShortcutHint";
afterEach(cleanup);
it("shows the saved key for this purpose and opens settings without starting recording",()=>{
  const open=vi.fn();render(<VoiceShortcutHint purpose="task" onOpenSettings={open} config={{feishuTools:true,pluginShortcuts:[{pluginId:"other",purpose:"task",hotkey:"X",trigger:"toggle"},{pluginId:"vitalk-plugin-feishu",purpose:"task",hotkey:"Shift+C",trigger:"toggle"}]}}/>);
  fireEvent.click(screen.getByRole("button",{name:"查看任务语音快捷键：Shift+C"}));
  expect(screen.getByText("Shift+C")).toBeTruthy();expect(open).toHaveBeenCalledOnce();
});
it("offers setup without inventing a default binding",()=>{
  render(<VoiceShortcutHint purpose="calendar" config={{feishuTools:true}} onOpenSettings={()=>{}}/>);
  expect(screen.getByRole("button",{name:"设置日程语音快捷键"}).textContent).toContain("设置快捷键");
  expect(screen.queryByText(/Shift/)).toBeNull();
});
it("marks a saved key as disabled when the feature is off and supports legacy message bindings",()=>{
  render(<VoiceShortcutHint purpose="message" config={{feishuTools:false,pluginShortcuts:[{pluginId:"vitalk-plugin-feishu",hotkey:"Shift+Z",trigger:"toggle"}]}} onOpenSettings={()=>{}}/>);
  expect(screen.getByRole("button",{name:"查看消息语音快捷键：Shift+Z，未启用"}).textContent).toContain("未启用");
});
