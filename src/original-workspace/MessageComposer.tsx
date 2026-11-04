import { useId, useState } from "react";
import { ArrowUpRight, Mic } from "lucide-react";
import { experimentsRequest } from "../experiments/client";
import type { FeishuMessageDraft } from "./FeishuMessagePanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
export function MessageComposer({
  onPrepared,
}: {
  onPrepared: (draft: FeishuMessageDraft) => void;
}) {
  const hintId = useId();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function prepare() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const draft = await experimentsRequest<FeishuMessageDraft | null>({
        action: "feishuPrepare",
        prompt,
      });
      if (!draft) throw new Error("请说明发送对象和消息内容");
      onPrepared(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="quick-message-composer">
      <div className="quick-message-composer-heading">
        <label htmlFor="quick-message-prompt">发送给谁，想说什么？</label>
        <span>先生成草稿</span>
      </div>
      <p id={hintId} className="quick-message-composer-description">
        说清对象和意图就好，生成后还能修改，确认后才发送。
      </p>
      <Textarea
        id="quick-message-prompt"
        aria-describedby={hintId}
        autoFocus
        value={prompt}
        rows={3}
        placeholder="例如：给小林发消息，问问他六七点是到深圳北，还是到公司。语气自然一点。"
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            (e.metaKey || e.ctrlKey) &&
            !e.nativeEvent.isComposing &&
            !e.repeat
          ) {
            e.preventDefault();
            void prepare();
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
      <div className="quick-message-actions">
        <Button
          disabled={busy || !prompt.trim()}
          onClick={() => void prepare()}
        >
          <ArrowUpRight size={16} aria-hidden="true" />
          {busy ? "正在整理…" : "生成消息草稿"}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void experimentsRequest({ action: "messageVoiceToggle" }).catch(
              (e) => setError(String(e instanceof Error ? e.message : e)),
            );
          }}
        >
          <Mic size={16} aria-hidden="true" />
          开始 / 结束语音
        </Button>
      </div>
      <p className="quick-message-composer-shortcut">
        Ctrl / Cmd + Enter 生成草稿
      </p>
    </div>
  );
}
