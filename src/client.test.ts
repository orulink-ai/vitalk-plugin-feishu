// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { dispose, feishu } from './client';

afterEach(() => { dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['feishuCliInstall', 'feishuAuthComplete'])('keeps %s pending past the default SDK timeout', async (action) => {
  vi.useFakeTimers();
  (window as Window & { __VITALK_PLUGIN_TOKEN__?: string }).__VITALK_PLUGIN_TOKEN__ = 'test-token';
  const send = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  let settled = false;
  const result = feishu(action).then(() => { settled = true; }, () => { settled = true; });
  await vi.advanceTimersByTimeAsync(61_000);
  expect(settled).toBe(false);
  const request = send.mock.calls[0][0];
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: {
    channel: 'vitalk-plugin/v1', token: 'test-token', id: request.id, result: { ok: true },
  } }));
  await result;
  expect(settled).toBe(true);
});
