import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bot, Users, ChevronDown, Search, ArrowUp, Check } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import "./feishu-message-panel.css";

export interface FeishuRecipient {
  id: string;
  name: string;
  kind: "person" | "group" | "bot";
  detail?: string;
  avatarUrl?: string;
}
export interface FeishuMessageAttachment {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
}
export interface FeishuMessageDraft {
  id: string;
  prompt: string;
  recipient?: FeishuRecipient;
  content: string;
  status:
    | "composing"
    | "preparing"
    | "ready"
    | "sending"
    | "sent"
    | "failed"
    | "unknown";
  error?: string;
  receipt?: string;
  awaitingRecipient?: boolean;
  recipientQuery?: string;
  originalRecipientQuery?: string;
  recipientGuess?: boolean;
  recipientLearning?: string;
  recipientMatch?: "unique" | "ambiguous" | "suggested" | "missing";
  recipientCandidates?: FeishuRecipient[];
  attachments?: FeishuMessageAttachment[];
}
export interface FeishuMessagePanelProps {
  draft: FeishuMessageDraft;
  recipients: FeishuRecipient[];
  onChange: (change: {
    recipient?: FeishuRecipient;
    content: string;
    attachments?: FeishuMessageAttachment[];
  }) => void;
  onSend: () => Promise<void> | void;
  /** Inline workspaces can expose an explicit confirmation label. */
  sendLabel?: string;
  onClose?: () => void;
  onRegenerate?: () => void;
  onRecipientSelected?: (recipient: FeishuRecipient) => void | Promise<void>;
  onSearch?: (query: string) => void;
  /** Query associated with an authoritative, possibly phonetic, server result. */
  resolvedSearchQuery?: string;
  onVoice?: () => void;
  onPickerChange?: (open: boolean) => void;
}
const recipientLabel = (kind: FeishuRecipient["kind"]) =>
  kind === "bot" ? "机器人" : kind === "group" ? "群聊" : "联系人";
const statusLabels: Record<FeishuMessageDraft["status"], string> = {
  composing: "说出或输入发送对象和消息内容",
  preparing: "正在生成消息…",
  ready: "待确认",
  sending: "正在发送，请稍候…",
  sent: "消息已发送",
  failed: "发送未完成，请检查提示",
  unknown: "发送结果待核实",
};

function RecipientAvatar({ recipient }: { recipient: FeishuRecipient }) {
  let avatarUrl: string | undefined;
  try {
    const raw = recipient.avatarUrl ?? "";
    const url = new URL(raw, window.location.href);
    const localAsset =
      raw.startsWith("/") &&
      !raw.startsWith("//") &&
      url.origin === window.location.origin;
    if (
      (url.protocol === "https:" || localAsset) &&
      !url.username &&
      !url.password
    )
      avatarUrl = url.href;
  } catch {
    /* Missing images use a readable fallback. */
  }
  return (
    <Avatar
      className="feishu-recipient-avatar"
      role="img"
      aria-label={`${recipient.name}的头像`}
    >
      {avatarUrl && (
        <AvatarImage src={avatarUrl} alt="" referrerPolicy="no-referrer" />
      )}
      <AvatarFallback>
        {recipient.kind === "bot" ? (
          <Bot size={18} aria-hidden="true" />
        ) : recipient.kind === "group" ? (
          <Users size={18} aria-hidden="true" />
        ) : (
          Array.from(recipient.name.trim())[0] || "人"
        )}
      </AvatarFallback>
    </Avatar>
  );
}

/** Controlled preview. Network, contact resolution and delivery belong to the container. */
export function FeishuMessagePanel(props: FeishuMessagePanelProps) {
  return <MessagePanel key={props.draft.id} {...props} />;
}
function MessagePanel({
  draft,
  recipients,
  onChange,
  onSend,
  sendLabel,
  onClose,
  onRegenerate,
  onSearch,
  resolvedSearchQuery,
  onRecipientSelected,
  onPickerChange,
}: FeishuMessagePanelProps) {
  const panel = useRef<HTMLElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const restoreEditor = useRef(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const [choosing, setChoosing] = useState(false);
  const choose = (open: boolean) => {
    if (open) setActiveIndex(-1);
    setChoosing(open);
    onPickerChange?.(open);
  };
  useEffect(() => {
    if (!choosing && restoreEditor.current) {
      editor.current?.focus();
      restoreEditor.current = false;
    }
  }, [choosing]);
  useEffect(() => {
    if (choosing || !editor.current) return;
    editor.current.style.height = "0px";
    editor.current.style.height = `${Math.min(149, Math.max(50, editor.current.scrollHeight))}px`;
  }, [draft.content, choosing]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const sending = useRef(false);
  const busy = pending || draft.status === "sending";
  const editable = !busy && draft.status === "ready";
  const valid = editable && Boolean(draft.recipient && draft.content.trim());
  const matches =
    resolvedSearchQuery === query.trim()
      ? recipients
      : recipients.filter((person) =>
          `${person.name} ${person.detail ?? ""}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        );
  const selectRecipient = (person: FeishuRecipient) => {
    onChange({ recipient: person, content: draft.content });
    setSubmitError("");
    try {
      const result = onRecipientSelected?.(person);
      if (result)
        void result.catch((error) =>
          setSubmitError(
            `对象已选择，但映射未保存：${String(error instanceof Error ? error.message : error)}`,
          ),
        );
    } catch (error) {
      setSubmitError(`对象已选择，但映射未保存：${String(error)}`);
    }

    restoreEditor.current = true;
    choose(false);
    setQuery("");
  };
  const searchKeyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!matches.length) return;
      setActiveIndex((index) =>
        event.key === "ArrowDown"
          ? (index + 1) % matches.length
          : index <= 0
            ? matches.length - 1
            : index - 1,
      );
    } else if (event.key === "Enter" && !event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      if (editable && matches[activeIndex])
        selectRecipient(matches[activeIndex]);
    }
  };
  useEffect(() => {
    if (choosing && activeIndex >= 0) {
      const options = panel.current?.querySelectorAll<HTMLElement>(
        ".feishu-recipient-option",
      );
      options?.[activeIndex]?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeIndex, choosing]);
  const send = async () => {
    if (!valid || sending.current || choosing) return;
    sending.current = true;
    setPending(true);
    setSubmitError("");
    try {
      await onSend();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "发送未完成，请检查连接",
      );
    } finally {
      sending.current = false;
      setPending(false);
    }
  };
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.key !== "Enter" ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      event.repeat
    )
      return;
    const target = event.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || choosing) return;
    if (event.shiftKey) return;
    if (!valid) return;
    event.preventDefault();
    void send();
  };
  return (
    <section
      ref={panel}
      className={`feishu-message-panel${choosing ? " feishu-message-choosing" : ""}`}
      aria-label="飞书消息预览"
      onKeyDown={keyboard}
      tabIndex={0}
    >
      <div className="feishu-message-scroll">
        <Button
          variant="ghost"
          className="feishu-message-recipient"
          type="button"
          aria-label="更换发送对象"
          aria-expanded={choosing}
          disabled={!editable}
          onClick={() => choose(!choosing)}
        >
          {draft.recipient ? (
            <>
              <RecipientAvatar recipient={draft.recipient} />
              <span className="feishu-recipient-identity">
                <span className="feishu-recipient-heading">
                  发送给 <strong>{draft.recipient.name}</strong>
                  <ChevronDown size={16} aria-hidden="true" />
                </span>
                <span>
                  {draft.recipientGuess ? (
                    "猜测对象 · 点击姓名可修改"
                  ) : (
                    <>
                      飞书 ·{" "}
                      {draft.recipient.kind === "person" &&
                      draft.recipient.detail ? (
                        <>
                          <span className="feishu-send-label">联系人</span>
                          {draft.recipient.detail}
                        </>
                      ) : (
                        <>
                          <span>{recipientLabel(draft.recipient.kind)}</span>
                          {draft.recipient.detail &&
                            ` · ${draft.recipient.detail}`}
                        </>
                      )}
                    </>
                  )}
                </span>
              </span>
            </>
          ) : (
            <span>
              请选择发送对象 <ChevronDown size={16} aria-hidden="true" />
            </span>
          )}
        </Button>
        <div className="feishu-message-field">
          {choosing && (
            <div className="feishu-recipient-picker">
              <div className="feishu-recipient-search">
                <Search size={15} aria-hidden="true" />
                <Input
                  type="search"
                  aria-label="搜索联系人、群聊或机器人"
                  placeholder="搜索姓名、部门、群聊或机器人"
                  autoFocus
                  value={query}
                  disabled={!editable}
                  onKeyDown={searchKeyboard}
                  onChange={(event) => {
                    setActiveIndex(-1);
                    setQuery(event.target.value);
                    onSearch?.(event.target.value);
                  }}
                />
              </div>
              <div
                className="feishu-recipient-results"
                aria-label="候选发送对象"
              >
                {matches.map((person, index) => (
                  <Button
                    variant="ghost"
                    className={`feishu-recipient-option${draft.recipient?.id === person.id && draft.recipient.kind === person.kind ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
                    type="button"
                    key={`${person.kind}:${person.id}`}
                    disabled={!editable}
                    onClick={() => selectRecipient(person)}
                  >
                    <RecipientAvatar recipient={person} />
                    <span className="feishu-recipient-identity">
                      <strong>{person.name}</strong>
                      <span>
                        {recipientLabel(person.kind)}
                        {person.detail ? ` · ${person.detail}` : ""}
                      </span>
                    </span>
                    {draft.recipient?.id === person.id && (
                      <Check
                        className="feishu-recipient-selected"
                        size={15}
                        aria-hidden="true"
                      />
                    )}
                  </Button>
                ))}
                {!matches.length && (
                  <p>未找到匹配对象，请换个姓名或更新飞书联系人。</p>
                )}
              </div>
            </div>
          )}
        </div>
        <div hidden={choosing} className="feishu-message-draft">
          <label className="feishu-message-field">
            <Textarea
              ref={editor}
              aria-label="发送内容"
              rows={2}
              placeholder={
                draft.status === "preparing"
                  ? "正在整理消息…"
                  : "在这里检查和修改消息"
              }
              value={draft.content}
              disabled={!editable}
              onChange={(event) =>
                onChange({
                  recipient: draft.recipient,
                  content: event.target.value,
                })
              }
            />
          </label>
          {Boolean(draft.attachments?.length) && (
            <div className="feishu-message-attachments" aria-label="待发送图片">
              <p>以下 {draft.attachments!.length} 张截图将与正文一起发送</p>
              <div className="feishu-message-attachment-grid">
                {draft.attachments!.map((image, index) => (
                  <div className="feishu-message-attachment" key={image.id}>
                    <img
                      src={
                        image.dataUrl.startsWith("data:image/png;base64,")
                          ? image.dataUrl
                          : undefined
                      }
                      alt={`待发送截图 ${index + 1}`}
                    />
                    <button
                      type="button"
                      aria-label={`删除待发送截图 ${index + 1}`}
                      disabled={!editable}
                      onClick={() =>
                        onChange({
                          recipient: draft.recipient,
                          content: draft.content,
                          attachments: draft.attachments!.filter(
                            (item) => item.id !== image.id,
                          ),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {draft.status === "sent" && draft.receipt && (
            <small className="feishu-message-receipt">
              消息回执：{draft.receipt}
            </small>
          )}
        </div>
      </div>
      {draft.status === "ready" && !draft.recipient && draft.recipientQuery && (
        <div className="feishu-recipient-feedback" role="status">
          <p>
            {draft.recipientMatch === "suggested"
              ? `识别为“${draft.recipientQuery}”，找到相近姓名，请确认收件人。`
              : draft.recipientMatch === "ambiguous"
                ? `“${draft.recipientQuery}”对应多个对象，请选择收件人。`
                : `缓存中没有匹配到“${draft.recipientQuery}”。请搜索选择；若联系人缺失，可到语音发送更新联系人。`}
          </p>
          <div className="feishu-recipient-suggestions">
            {(draft.recipientCandidates ?? []).map((person) => (
              <Button
                key={`${person.kind}:${person.id}`}
                variant="ghost"
                aria-label={`选择${person.name}`}
                onClick={() => selectRecipient(person)}
              >
                <RecipientAvatar recipient={person} />
                <span>
                  {person.name}
                  {person.detail ? ` · ${person.detail}` : ""}
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}
      {draft.status === "unknown" ? (
        <p role="alert">
          发送结果不确定，请先到飞书核实，避免重复发送。
          {draft.error && ` ${draft.error}`}
        </p>
      ) : (
        (draft.error || submitError) && (
          <p role="alert">{draft.error || submitError}</p>
        )
      )}
      {choosing && (
        <div className="feishu-picker-footer">
          <span>选择后继续编辑消息</span>
          <Button
            variant="ghost"
            onClick={() => {
              choose(false);
              panel.current?.focus();
            }}
          >
            返回消息
          </Button>
        </div>
      )}
      <div hidden={choosing} className="feishu-message-actions">
        {(busy || draft.status !== "ready" || !draft.recipient) && (
          <span className="feishu-message-status" role="status">
            {busy
              ? "正在发送…"
              : draft.status === "ready"
                ? draft.recipient
                  ? "确认发送"
                  : "请选择收件人"
                : statusLabels[draft.status]}
          </span>
        )}
        {draft.status === "failed" && onRegenerate && (
          <button type="button" onClick={onRegenerate}>
            重新生成草稿
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose}>
            关闭
          </button>
        )}
        <Button
          className="feishu-message-send"
          type="button"
          disabled={!valid || choosing}
          onClick={() => void send()}
          aria-label={
            busy
              ? "正在发送…"
              : draft.status === "sent"
                ? "已发送"
                : draft.status === "unknown"
                  ? "请先核实发送结果"
                  : (sendLabel ?? "发送消息")
          }
          title="Enter 发送 · Shift + Enter 换行"
        >
          {draft.status === "sent" ? (
            <Check size={25} aria-hidden="true" />
          ) : (
            <ArrowUp size={20} strokeWidth={2} aria-hidden="true" />
          )}
          <span className="feishu-send-label">
            {busy
              ? "正在发送…"
              : draft.status === "sent"
                ? "已发送"
                : draft.status === "unknown"
                  ? "请先核实发送结果"
                  : (sendLabel ?? "发送消息")}
          </span>
        </Button>
      </div>
    </section>
  );
}
