import { useEffect, useState } from "react";
import { BookOpenCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { experimentsRequest } from "../experiments/client";
import type { FeishuRecipient } from "./FeishuMessagePanel";
import "./recipient-memory.css";
type MemoryState = {
  connected: boolean;
  enabled: boolean;
  entries: {
    query: string;
    recipientId: string;
    name?: string;
    active: boolean;
    source?: "manual" | "confirmed-send";
  }[];
};
export function RecipientMemoryPanel({
  recipients,
}: {
  recipients: FeishuRecipient[];
}) {
  const [kind, setKind] = useState<"person" | "group">("person");
  const visibleRecipients = recipients.filter((r) =>
    kind === "group" ? r.kind === "group" : r.kind !== "group",
  );
  const visibleIds = new Set(visibleRecipients.map((r) => r.id));
  const visibleEntries = (dataPlaceholder: MemoryState | undefined) =>
    (dataPlaceholder?.entries ?? []).filter(
      (entry) =>
        visibleIds.has(entry.recipientId) ||
        (kind === "person" &&
          !recipients.some((r) => r.id === entry.recipientId)),
    );
  const [data, setData] = useState<MemoryState>();
  const [query, setQuery] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Authorization/sync can finish while this tab remains mounted.
  // Recheck account-scoped readiness when its catalog changes.
  useEffect(() => {
    let active = true;
    void experimentsRequest<MemoryState>({ action: "feishuRecipientMemory" })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [recipients]);
  const perform = async (
    operation: "list" | "save" | "delete" | "configure",
    extra: { query?: string; recipientId?: string; enabled?: boolean } = {},
  ) => {
    if (busy) return;
    if (operation === "save" && !visibleIds.has(extra.recipientId ?? "")) {
      setError("请选择当前分类中的真实飞书对象。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setData(
        await experimentsRequest<MemoryState>({
          action: "feishuRecipientMemory",
          operation,
          ...extra,
        }),
      );
      if (operation === "save") {
        setQuery("");
        setRecipientId("");
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="recipient-memory" aria-label="对象热词">
      <div className="recipient-memory-heading">
        <BookOpenCheck size={24} />
        <div>
          <h2>对象热词</h2>
          <p>让姓名、群名和常用称呼更容易被识别，匹配到真实飞书对象。</p>
        </div>
      </div>
      <ToggleGroup
        aria-label="对象类型"
        value={[kind]}
        variant="outline"
        size="sm"
        onValueChange={(values) => {
          const next = values[0];
          if (next !== "person" && next !== "group") return;
          setKind(next);
          setRecipientId("");
          setQuery("");
          setError("");
        }}
      >
        <ToggleGroupItem value="person">
          联系人（{recipients.filter((r) => r.kind !== "group").length}）
        </ToggleGroupItem>
        <ToggleGroupItem value="group">
          群聊（{recipients.filter((r) => r.kind === "group").length}）
        </ToggleGroupItem>
      </ToggleGroup>
      <p>
        {kind === "group"
          ? "群聊用于发送群消息，不作为任务负责人，也不自动展开成会议参与人。"
          : "联系人可用于消息、任务负责人和会议参与人；机器人仅用于已接入的消息渠道。"}
      </p>
      <div className="recipient-hotword-source">
        <h3>来自飞书通讯录</h3>
        <p>已同步 {visibleRecipients.length} 个对象名称</p>
        <p>
          飞书启用时，当前账号的名称和对象称呼会用于语音指令与语音发送热词。不同语音模型对热词支持有差异；普通听写不使用这份联系人词表。
        </p>
        {visibleRecipients.length > 0 && (
          <details>
            <summary>查看已同步名称</summary>
            <ul className="recipient-hotword-names">
              {visibleRecipients.map((person) => (
                <li key={`${person.kind}:${person.id}`}>
                  <strong>{person.name}</strong>
                  <span>
                    {person.kind === "person"
                      ? "联系人"
                      : person.kind === "group"
                        ? "群聊"
                        : "机器人"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="recipient-memory-learning">
        <div>
          <strong>从确认反馈中学习</strong>
          <p>改人立即纠正；成功发送会积累称呼记忆，两次一致后记住。</p>
        </div>
        <button
          type="button"
          className="recipient-memory-switch"
          role="switch"
          aria-label="从确认反馈中学习"
          aria-checked={data?.enabled ?? false}
          disabled={busy || !data?.connected}
          onClick={() => void perform("configure", { enabled: !data?.enabled })}
        >
          <span />
        </button>
      </div>
      <div className="recipient-memory-footer">
        <span>用于飞书消息、任务与会议匹配 · 本地存储 · 可删除</span>
      </div>
      {error && <p role="alert">{error}</p>}
      {data?.connected === false && <p>请先连接飞书并更新联系人。</p>}
      <div>
        <div className="recipient-memory-details">
          <h3>{kind === "group" ? "补充群聊称呼" : "补充联系人称呼"}</h3>
          <p>
            把昵称、常用叫法或识别错字绑定到一个真实对象，用于后续识别和匹配。最多
            50 字。
          </p>
          <div className="recipient-memory-add">
            <Input
              aria-label="对象称呼或识别错字"
              placeholder="例如：刘维聪、小林"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={50}
            />
            <select
              aria-label="映射到飞书对象"
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
            >
              <option value="">选择真实对象</option>
              {visibleRecipients.map((r) => (
                <option key={`${r.kind}:${r.id}`} value={r.id}>
                  {r.name}
                  {r.detail ? ` · ${r.detail}` : ""}
                </option>
              ))}
            </select>
            <Button
              disabled={
                busy || !query.trim() || !recipientId || !data?.connected
              }
              onClick={() =>
                void perform("save", { query: query.trim(), recipientId })
              }
            >
              添加对象热词
            </Button>
          </div>
          {visibleEntries(data).length === 0 ? (
            <p>
              还没有补充称呼。可以手动添加，也可以开启学习后在确认浮窗中选对人。
            </p>
          ) : (
            <ul>
              {visibleEntries(data).map((entry) => (
                <li key={entry.query}>
                  <span>{entry.query}</span>
                  <span aria-hidden="true">→</span>
                  <strong>{entry.name ?? "对象不在当前通讯录"}</strong>
                  <small>
                    {entry.source === "confirmed-send"
                      ? "发送确认积累"
                      : "手动确认"}
                  </small>
                  <Button
                    variant="ghost"
                    aria-label={`删除${entry.query}的映射`}
                    disabled={busy}
                    onClick={() =>
                      void perform("delete", { query: entry.query })
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
