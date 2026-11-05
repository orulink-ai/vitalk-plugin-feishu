import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { experimentsRequest, type ExperimentsConfig } from "./client";
import "./agent-voice-shortcut.css";

type Purpose = "message" | "task" | "calendar";
type Phase = "idle" | "starting" | "listening" | "saving" | "restoring";
const actions: [Purpose, string][] = [
  ["message", "消息"],
  ["task", "任务"],
  ["calendar", "日程"],
];
const suggestedHotkeys: Record<Purpose, string> = {
  message: "Ctrl+Alt+F6",
  task: "Ctrl+Alt+F7",
  calendar: "Ctrl+Alt+F8",
};

// The native protocol pauses capture with a boolean. Serialize transitions and
// track the owner so a late cleanup cannot resume shortcuts in a newer capture.
let nativeTransition: Promise<unknown> = Promise.resolve();
let queuedTransitions = 0;
let captureOwner: symbol | undefined;
function transition<T>(work: () => Promise<T>): Promise<T> {
  // Start an idle release synchronously: pagehide disposes the SDK immediately
  // after React cleanup, so deferring the send to a microtask can drop it.
  const idle = queuedTransitions === 0;
  queuedTransitions++;
  let result: Promise<T>;
  try {
    result = idle ? work() : nativeTransition.then(work, work);
  } catch (error) {
    result = Promise.reject(error);
  }
  nativeTransition = result.then(
    (value) => {
      queuedTransitions--;
      return value;
    },
    () => {
      queuedTransitions--;
    },
  );
  return result;
}
function acquireCapture() {
  const owner = Symbol("shortcut capture");
  let cancelled = false;
  let releasing: Promise<void> | undefined;
  const ready = transition(async () => {
    if (cancelled) return;
    captureOwner = owner;
    await experimentsRequest({ action: "feishuShortcutCapture", active: true });
  });
  return {
    ready,
    release() {
      cancelled = true;
      if (releasing) return releasing;
      releasing = transition(async () => {
        if (captureOwner !== owner) return;
        await experimentsRequest({
          action: "feishuShortcutCapture",
          active: false,
        });
        captureOwner = undefined;
      }).catch((error) => {
        releasing = undefined;
        throw error;
      });
      return releasing;
    },
  };
}
type Capture = ReturnType<typeof acquireCapture>;
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function shortcutFromKey(
  event: Pick<
    KeyboardEvent,
    "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "code"
  >,
) {
  const keys: string[] = [];
  if (event.ctrlKey) keys.push("Ctrl");
  if (event.metaKey) keys.push("Super");
  if (event.altKey) keys.push("Alt");
  if (event.shiftKey) keys.push("Shift");
  const key =
    event.code === "Space"
      ? "Space"
      : event.code.startsWith("Key")
        ? event.code.slice(3)
        : event.code.startsWith("Digit")
          ? event.code.slice(5)
          : /^F([1-9]|1[0-2])$/.test(event.code)
            ? event.code
            : "";
  return key && keys.length ? [...keys, key].join("+") : "";
}
export function AgentVoiceShortcut({
  config,
  enabled,
  onToggleEnabled,
  onSaved,
}: {
  config: ExperimentsConfig;
  enabled: boolean;
  onToggleEnabled: () => void;
  onSaved?: () => void;
}) {
  const [listening, setListening] = useState<Purpose | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [confirmed, setConfirmed] = useState<Partial<Record<Purpose, string>>>(
    {},
  );
  const mounted = useRef(true);
  const version = useRef(0);
  const pending = useRef(false);
  const lease = useRef<Capture | null>(null);
  const buttons = useRef<Partial<Record<Purpose, HTMLButtonElement | null>>>(
    {},
  );
  const current = (value: number) =>
    mounted.current && version.current === value;
  const savedKey = (purpose: Purpose) =>
    config.pluginShortcuts?.find(
      (item) =>
        item.pluginId === "vitalk-plugin-feishu" &&
        (item.purpose || "message") === purpose,
    )?.hotkey ?? "";
  useEffect(() => {
    setConfirmed((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const [purpose] of actions)
        if (
          next[purpose] !== undefined &&
          next[purpose] === savedKey(purpose)
        ) {
          delete next[purpose];
          changed = true;
        }
      return changed ? next : previous;
    });
  }, [config.pluginShortcuts]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      version.current++;
      // release queues behind an in-flight acquisition, including a late ACK.
      void lease.current?.release().catch(() => undefined);
    };
  }, []);
  async function restore(capture: Capture | null, operation: number) {
    if (!capture) return true;
    try {
      await capture.release();
      if (lease.current === capture) lease.current = null;
      if (current(operation)) setRecovery(false);
      return true;
    } catch (failure) {
      if (current(operation)) {
        setRecovery(true);
        setError(
          (previous) =>
            `${previous ? previous + "；" : ""}快捷键监听恢复失败：${messageOf(failure)}`,
        );
      }
      return false;
    }
  }
  async function begin(purpose: Purpose) {
    if (pending.current || listening || recovery) return;
    const operation = ++version.current;
    pending.current = true;
    setPhase("starting");
    setListening(purpose);
    setError("");
    setFeedback("");
    const capture = acquireCapture();
    lease.current = capture;
    try {
      await capture.ready;
      if (!current(operation)) {
        await capture.release();
        return;
      }
      pending.current = false;
      setPhase("listening");
      buttons.current[purpose]?.focus();
    } catch (failure) {
      if (current(operation)) setError(messageOf(failure));
      await restore(capture, operation);
      if (current(operation)) {
        pending.current = false;
        setPhase("idle");
        setListening(null);
      }
    }
  }
  async function cancel() {
    if (phase === "saving" || phase === "restoring") return;
    const purpose = listening;
    const recovering = recovery;
    const operation = ++version.current;
    pending.current = true;
    setPhase("restoring");
    setListening(null);
    setFeedback("");
    const restored = await restore(lease.current, operation);
    if (current(operation)) {
      pending.current = false;
      setPhase("idle");
      if (restored) {
        if (recovering) setError("");
        setFeedback(
          recovering ? "快捷键监听已恢复。" : "已取消，原快捷键保持不变。",
        );
      }
      if (purpose) buttons.current[purpose]?.focus();
    }
  }
  async function save(purpose: Purpose, hotkey: string) {
    if (pending.current || recovery) return;
    const operation = ++version.current;
    pending.current = true;
    setPhase("saving");
    setError("");
    setFeedback("");
    const capture = lease.current;
    let saved = false;
    try {
      await experimentsRequest({
        action: "feishuShortcutSet",
        purpose,
        hotkey,
      });
      saved = true;
      if (current(operation))
        setConfirmed((previous) => ({ ...previous, [purpose]: hotkey }));
    } catch (failure) {
      if (current(operation)) setError(messageOf(failure));
    } finally {
      await restore(capture, operation);
      if (current(operation)) {
        pending.current = false;
        setPhase("idle");
        setListening(null);
        if (saved) {
          setFeedback(hotkey ? "快捷键已保存。" : "快捷键已清除。");
          onSaved?.();
        }
        buttons.current[purpose]?.focus();
      }
    }
  }
  useEffect(() => {
    if (!listening) return;
    const handle = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (event.key === "Escape") {
        void cancel();
        return;
      }
      if (pending.current) return;
      if (event.key === "Backspace") {
        void save(listening, "");
        return;
      }
      const value = shortcutFromKey(event);
      if (value) void save(listening, value);
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [listening, phase]);
  const busy = phase !== "idle" && phase !== "listening";
  return (
    <div className="feishu-shortcut-settings">
      <div className="feishu-shortcut-settings-header">
        <div>
          <strong>语音快捷键</strong>
          <p>按一次开始录音，再按一次结束。</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={enabled}
          disabled={busy || !!listening || recovery}
          onClick={onToggleEnabled}
        >
          {enabled ? "语音已开启" : "开启语音指令"}
        </Button>
      </div>
      <div className="feishu-shortcut-settings-list">
        {actions.map(([purpose, label]) => {
          const hotkey = confirmed[purpose] ?? savedKey(purpose);
          return (
            <div className="feishu-shortcut-settings-row" key={purpose}>
              <span>{label}</span>
              <Button
                ref={(node) => {
                  buttons.current[purpose] = node;
                }}
                variant="outline"
                size="sm"
                aria-label={`${label} 唤醒快捷键`}
                aria-pressed={listening === purpose}
                disabled={
                  busy || recovery || (!!listening && listening !== purpose)
                }
                onClick={() => void begin(purpose)}
              >
                <Keyboard size={14} aria-hidden="true" />
                {listening === purpose ? (
                  phase === "saving" ? (
                    "正在保存…"
                  ) : phase === "starting" ? (
                    "正在准备…"
                  ) : (
                    "按下组合键"
                  )
                ) : hotkey ? (
                  <kbd>{hotkey}</kbd>
                ) : (
                  "设置快捷键"
                )}
              </Button>
              {hotkey && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !!listening || recovery}
                  aria-label={`清除${label}快捷键`}
                  onClick={() => void save(purpose, "")}
                >
                  清除
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {listening && (
        <div className="feishu-shortcut-capture">
          <p role="status">
            {phase === "starting"
              ? "正在准备快捷键监听…"
              : phase === "saving"
                ? "正在保存快捷键…"
                : "按下组合键 · Esc 取消"}
          </p>
          <div>
            <Button
              variant="outline"
              size="sm"
              aria-label="取消设置快捷键"
              disabled={phase === "saving"}
              onClick={() => void cancel()}
            >
              取消
            </Button>
            {phase === "listening" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void save(listening, suggestedHotkeys[listening])
                }
              >
                使用 <kbd>{suggestedHotkeys[listening]}</kbd>
              </Button>
            )}
          </div>
          <small>按 Backspace 清除当前快捷键。</small>
        </div>
      )}
      {phase === "restoring" && <p role="status">正在恢复快捷键监听…</p>}
      {error && <p role="alert">{error}</p>}
      {recovery && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void cancel()}
        >
          重试恢复快捷键
        </Button>
      )}
      {feedback && <p role="status">{feedback}</p>}
      <p className="feishu-shortcut-settings-note">
        消息发送前会显示确认；任务与日程按指令执行。
      </p>
    </div>
  );
}
