// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentVoiceShortcut } from './AgentVoiceShortcut';
import { experimentsRequest } from './client';

vi.mock('./client', () => ({ experimentsRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const config = { pluginShortcuts: [
  {pluginId:'vitalk-plugin-feishu',purpose:'message',hotkey:'Ctrl+Alt+F6',trigger:'toggle'},
  {pluginId:'vitalk-plugin-feishu',purpose:'task',hotkey:'Shift+A',trigger:'toggle'},
  {pluginId:'vitalk-plugin-feishu',purpose:'calendar',hotkey:'Ctrl+Alt+F8',trigger:'toggle'},
] };

it('captures each purpose through SDK and releases native capture after saving', async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({} as never);
  const saved = vi.fn();
  render(<AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} onSaved={saved} />);
  expect(screen.getByRole('button',{name:'创建任务 唤醒快捷键'}).textContent).toBe('Shift+A');
  fireEvent.click(screen.getByRole('button',{name:'预约日程 唤醒快捷键'}));
  await screen.findByText('按下组合键 · Esc 取消');
  fireEvent.keyDown(window,{key:'F8',code:'F8',ctrlKey:true,altKey:true});
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(experimentsRequest).toHaveBeenNthCalledWith(1,{action:'feishuShortcutCapture',active:true});
  expect(experimentsRequest).toHaveBeenNthCalledWith(2,{action:'feishuShortcutSet',purpose:'calendar',hotkey:'Ctrl+Alt+F8'});
  expect(experimentsRequest).toHaveBeenNthCalledWith(3,{action:'feishuShortcutCapture',active:false});
});

it('shows conflict errors, retains the prior shortcut and resumes native capture', async () => {
  vi.mocked(experimentsRequest).mockImplementation(async request => {
    if(request.action==='feishuShortcutSet') throw new Error('快捷键与听写冲突');
    return {} as never;
  });
  const saved = vi.fn();
  render(<AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} onSaved={saved} />);
  fireEvent.click(screen.getByRole('button',{name:'创建任务 唤醒快捷键'}));
  await screen.findByText('按下组合键 · Esc 取消');
  fireEvent.keyDown(window,{key:'a',code:'KeyA',ctrlKey:true});
  expect((await screen.findByRole('alert')).textContent).toContain('快捷键与听写冲突');
  await waitFor(() => expect(screen.getByRole('button',{name:'创建任务 唤醒快捷键'}).textContent).toBe('Shift+A'));
  expect(experimentsRequest).toHaveBeenCalledWith({action:'feishuShortcutCapture',active:false});
  expect(saved).not.toHaveBeenCalled();
});

it('cancels keyboard capture without overwriting the saved shortcut', async () => {
  vi.mocked(experimentsRequest).mockResolvedValue({} as never);
  render(<AgentVoiceShortcut config={config} enabled onToggleEnabled={vi.fn()} />);
  fireEvent.click(screen.getByRole('button',{name:'发消息 唤醒快捷键'}));
  await screen.findByText('按下组合键 · Esc 取消');
  fireEvent.keyDown(window,{key:'Escape',code:'Escape'});
  await waitFor(() => expect(screen.getByRole('button',{name:'发消息 唤醒快捷键'}).textContent).toBe('Ctrl+Alt+F6'));
  expect(experimentsRequest).not.toHaveBeenCalledWith(expect.objectContaining({action:'feishuShortcutSet'}));
  expect(experimentsRequest).toHaveBeenCalledWith({action:'feishuShortcutCapture',active:false});
});
