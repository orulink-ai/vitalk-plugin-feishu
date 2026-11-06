import { useEffect, useRef, useState } from "react";
import {createPortal} from "react-dom";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  experimentsRequest,
  type ExperimentsSnapshot,
  type FeishuCatalog,
} from "../experiments/client";
import {
  FeishuMessagePanel,
  type FeishuMessageDraft,
  type FeishuRecipient,
} from "./FeishuMessagePanel";
import "./feishu-messages-workspace.css";
import {VoiceShortcutHint} from "./VoiceShortcutHint";

const statuses = new Set([
  "composing",
  "preparing",
  "ready",
  "sending",
  "sent",
  "failed",
  "unknown",
]);
function readDraft(value: unknown): FeishuMessageDraft | null {
  if (value === null) return null;
  if (!value || typeof value !== "object")
    throw new Error("宿主未返回有效消息草稿，请检查飞书连接。");
  const draft = value as Record<string, unknown>;
  if (
    typeof draft.id !== "string" ||
    !draft.id ||
    typeof draft.content !== "string" ||
    typeof draft.status !== "string" ||
    !statuses.has(draft.status)
  )
    throw new Error("消息草稿字段不完整，请重新读取状态。");
  const result = {
    ...draft,
    prompt: typeof draft.prompt === "string" ? draft.prompt : "",
    error: typeof draft.error === "string" ? draft.error : undefined,
    receipt: typeof draft.receipt === "string" ? draft.receipt : undefined,
  } as unknown as FeishuMessageDraft;
  if (
    result.recipient &&
    (!result.recipient.id ||
      !result.recipient.name ||
      !["person", "group", "bot"].includes(result.recipient.kind))
  )
    throw new Error("草稿发送对象无效，请重新选择真实对象。");
  if (
    result.attachments !== undefined &&
    (!Array.isArray(result.attachments) ||
      result.attachments.some(
        (image) =>
          !image ||
          typeof image.id !== "string" ||
          typeof image.dataUrl !== "string" ||
          typeof image.width !== "number" ||
          typeof image.height !== "number",
      ))
  ) {
    throw new Error("草稿图片信息不完整，请重新读取消息草稿。");
  }
  if (result.status === "sent" && !result.receipt) {
    result.status = "unknown";
    result.error = "未取得消息回执，请先在飞书核实。";
  }
  return result;
}
type Props = {
  snapshot: ExperimentsSnapshot;
  onDraftUpdate?: (draft: FeishuMessageDraft | null) => void;
  onOpenShortcuts?: () => void;
  voiceContainer?: HTMLElement | null;
  voiceInHeader?: boolean;
  voiceVisible?: boolean;
};
type Job = "prepare" | "send" | "dismiss" | "voice" | null;
export function FeishuMessagesWorkspace({ snapshot, onDraftUpdate, onOpenShortcuts, voiceContainer, voiceInHeader=false, voiceVisible=true }: Props) {
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<FeishuMessageDraft | null>(() => {
    try {
      return readDraft(snapshot.feishuDraft ?? null);
    } catch {
      return null;
    }
  });
  const [job, setJob] = useState<Job>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{
    query: string;
    recipients: FeishuRecipient[];
  }>();
  const active = useRef(true);
  const sequence = useRef(0);
  const locked = useRef(false);
  const draftRef = useRef(draft);
  const dirty = useRef(false);
  const seenNative = useRef(snapshot.feishuDraft?.id);
  const attempted = useRef(new Set<string>());
  const dismissed = useRef(new Set<string>());
  const changed = useRef(onDraftUpdate);
  changed.current = onDraftUpdate;
  function commit(next: FeishuMessageDraft | null, notify = false) {
    draftRef.current = next;
    setDraft(next);
    if (notify) changed.current?.(next);
  }
  function accept(next: FeishuMessageDraft) {
    const previous = draftRef.current;
    if (dismissed.current.has(next.id)) return;
    // A popup or another workspace can submit this ID too. Every observed
    // submission/outcome prevents older ready snapshots from restoring send.
    if (["sending", "sent", "unknown", "failed"].includes(next.status)) {
      attempted.current.add(next.id);
    }
    if (previous?.id === next.id) {
      if (previous.status === "sent" && next.status !== "sent") return;
      if (
        attempted.current.has(next.id) &&
        ["ready", "preparing", "composing"].includes(next.status)
      )
        return;
      if (
        dirty.current &&
        previous.status === "ready" &&
        next.status === "ready"
      )
        return;
    } else {
      if (previous) dismissed.current.add(previous.id);
      dirty.current = false;
      setQuery("");
      setSearch(undefined);
    }
    if (next.status !== "ready") dirty.current = false;
    commit(next);
  }
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    try {
      if (snapshot.feishuDraft === undefined) return;
      const incoming = readDraft(snapshot.feishuDraft);
      if (incoming) {
        // An obsolete nonempty record is not an explicit native dismissal.
        if (dismissed.current.has(incoming.id)) return;
        seenNative.current = incoming.id;
        accept(incoming);
      } else if (
        seenNative.current &&
        seenNative.current === draftRef.current?.id &&
        !locked.current &&
        draftRef.current &&
        // A popup can clear its native draft after submission. Keep the local
        // receipt (or pending/uncertain submission) until an explicit close.
        ["composing", "preparing", "ready"].includes(draftRef.current.status)
      ) {
        commit(null);
        dirty.current = false;
        seenNative.current = undefined;
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [snapshot.feishuDraft]);
  useEffect(() => {
    if (!query.trim()) {
      setSearch(undefined);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      void experimentsRequest<FeishuCatalog>({
        action: "feishuSearch",
        query: query.trim(),
      })
        .then((result) => {
          if (current && active.current && Array.isArray(result.recipients))
            setSearch({ query: query.trim(), recipients: result.recipients });
        })
        .catch((failure) => {
          if (current && active.current)
            setError(
              String(failure instanceof Error ? failure.message : failure),
            );
        });
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query]);
  async function prepare(
    source?: FeishuMessageDraft,
    recipient?: FeishuRecipient,
  ) {
    if (locked.current) return;
    const text = source?.prompt ?? prompt.trim();
    if (!text) return;
    const previousId = draftRef.current?.id;
    const version = ++sequence.current;
    locked.current = true;
    setJob("prepare");
    setError("");
    try {
      const request: Record<string, unknown> = {
        action: "feishuPrepare",
        prompt: text,
      };
      if (source && recipient) {
        request.recipientSourceDraftId = source.id;
        request.recipientId = recipient.id;
      } else if (source) {
        request.sourceDraftId = source.id;
        request.attachmentIds = (source.attachments ?? []).map(
          (image) => image.id,
        );
      }
      const result = readDraft(
        await experimentsRequest<unknown>(request as { action: string }),
      );
      if (!active.current || sequence.current !== version) return;
      if (!result)
        throw new Error("未能生成消息草稿，请说明发送对象和消息内容。");
      const live = draftRef.current;
      if (live && live.id !== previousId && live.id !== result.id) return;
      accept(result);
      changed.current?.(draftRef.current);
    } catch (failure) {
      if (active.current && sequence.current === version)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (active.current && sequence.current === version) {
        locked.current = false;
        setJob(null);
      }
    }
  }
  async function send() {
    const source = draftRef.current;
    if (
      locked.current ||
      !source ||
      source.status !== "ready" ||
      !source.recipient ||
      !source.content.trim() ||
      attempted.current.has(source.id)
    )
      return;
    const frozen = { ...source, attachments: source.attachments?.slice() };
    attempted.current.add(source.id);
    locked.current = true;
    setJob("send");
    setError("");
    commit({ ...frozen, status: "sending" });
    try {
      const result = readDraft(
        await experimentsRequest<unknown>({
          action: "feishuSend",
          id: frozen.id,
          recipientId: frozen.recipient!.id,
          content: frozen.content,
          attachmentIds: (frozen.attachments ?? []).map((image) => image.id),
        }),
      );
      if (!active.current) return;
      if (
        !result ||
        result.id !== frozen.id ||
        !["sent", "failed", "unknown", "sending"].includes(result.status)
      )
        throw new Error("发送回执未能核验，请先到飞书确认结果。");
      if (draftRef.current?.id === frozen.id) {
        accept(result);
        changed.current?.(draftRef.current);
      }
    } catch (failure) {
      if (
        active.current &&
        draftRef.current?.id === frozen.id &&
        draftRef.current.status !== "sent"
      )
        commit(
          {
            ...frozen,
            status: "unknown",
            error: failure instanceof Error ? failure.message : String(failure),
          },
          true,
        );
    } finally {
      if (active.current) {
        locked.current = false;
        setJob(null);
      }
    }
  }
  async function dismiss() {
    const source = draftRef.current;
    if (locked.current || !source || source.status === "sending") return;
    locked.current = true;
    setJob("dismiss");
    setError("");
    try {
      const result = await experimentsRequest<{ ok?: boolean }>({
        action: "feishuDismiss",
        id: source.id,
      });
      if (!result || result.ok !== true)
        throw new Error("草稿关闭结果未确认，请重新读取状态。");
      if (active.current && draftRef.current?.id === source.id) {
        dismissed.current.add(source.id);
        dirty.current = false;
        commit(null, true);
      }
    } catch (failure) {
      if (active.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (active.current) {
        locked.current = false;
        setJob(null);
      }
    }
  }
  async function voice() {
    if (locked.current) return;
    locked.current = true;
    setJob("voice");
    setError("");
    try {
      await experimentsRequest({ action: "messageVoiceToggle" });
    } catch (failure) {
      if (active.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (active.current) {
        locked.current = false;
        setJob(null);
      }
    }
  }
  function edit(change: {
    recipient?: FeishuRecipient;
    content: string;
    attachments?: FeishuMessageDraft["attachments"];
  }) {
    const source = draftRef.current;
    if (!source || locked.current || source.status !== "ready") return;
    dirty.current = true;
    commit({ ...source, ...change });
  }
  const recording =
    snapshot.recording?.mode === "message" &&
    snapshot.recording.status === "recording";
  const openDraft = !!draft && draft.status !== "sent";
  const busy =
    job !== null ||
    draft?.status === "sending" ||
    draft?.status === "preparing";
  const panelDraft =
    draft &&
    (job === "prepare" ? { ...draft, status: "preparing" as const } : draft);
  const voiceEntry=<div className="feishu-voice-entry"><Button
    disabled={busy || (openDraft && !recording)} onClick={()=>void voice()}>
    {recording?<Square data-icon="inline-start"/>:<Mic data-icon="inline-start"/>}
    {recording?"结束语音输入":"语音输入"}
  </Button><VoiceShortcutHint purpose="message" config={snapshot.config} onOpenSettings={onOpenShortcuts}/></div>;
  return (
    <section className="feishu-messages-workspace" aria-label="飞书消息工作区">
      {voiceInHeader&&voiceContainer&&voiceVisible&&createPortal(voiceEntry,voiceContainer)}
      <header>
        <div>
          <h2>消息</h2>
          <p>先整理草稿，确认对象和正文后发送。</p>
        </div>
        {!voiceInHeader&&voiceVisible&&voiceEntry}
      </header>
      {!openDraft && (
        <div className="feishu-message-request">
          <label htmlFor="feishu-message-request">要发送的消息</label>
          <Textarea
            id="feishu-message-request"
            aria-label="要发送的消息"
            placeholder="例如：给小琼发消息，说项目资料已经整理好了"
            value={prompt}
            disabled={busy || openDraft}
            maxLength={16000}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div>
            <span>
              {openDraft
                ? "请先完成或关闭当前草稿。"
                : "文字或语音都会生成待确认草稿。"}
            </span>
            <Button
              type="button"
              onClick={() => void prepare()}
              disabled={busy || openDraft || !prompt.trim()}
            >
              {job === "prepare" ? "正在整理…" : "生成消息草稿"}
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {panelDraft && (
        <section
          className="feishu-message-inline-draft"
          aria-label="当前消息草稿"
        >
          <div className="feishu-message-inline-heading">
            <h3>发送预览</h3>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void dismiss()}
            >
              关闭草稿
            </Button>
          </div>
          <FeishuMessagePanel
            draft={panelDraft}
            recipients={
              search?.recipients ?? snapshot.feishuCatalog?.recipients ?? []
            }
            resolvedSearchQuery={search?.query}
            onSearch={setQuery}
            onPickerChange={(open) => {
              if (!open) setQuery("");
            }}
            onChange={edit}
            onSend={send}
            sendLabel="确认发送"
            onRegenerate={
              draft?.status === "failed" ? () => void prepare(draft) : undefined
            }
            onRecipientSelected={(recipient) => {
              const source = draftRef.current;
              if (source?.awaitingRecipient) return prepare(source, recipient);
            }}
          />
          <p className="feishu-message-inline-note">
            与原生确认浮窗使用同一草稿；任一处发送后，会同步实际回执。
          </p>
        </section>
      )}
    </section>
  );
}
