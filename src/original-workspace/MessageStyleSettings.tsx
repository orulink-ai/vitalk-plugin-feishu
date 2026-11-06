import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const presets = [
  {
    name: "亲切自然",
    text: "像我平时说话，亲切、自然、直接。同事间少用敬语，不要冷冰冰的公文腔，不强行加表情；对客户礼貌得体。",
  },
  {
    name: "简洁直接",
    text: "简洁直接，先说重点，保留必要背景和问题。不加客套话，不堆形容词；提问自然、不生硬。",
  },
  {
    name: "礼貌专业",
    text: "礼貌专业，表达清晰，有适度温度。请求用商量的语气，通知直接说明事项；避免夸张、过度客套和无依据的承诺。",
  },
];

export function MessageStyleSettings({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"" | "saved" | "failed">("");
  const locked = useRef(false);
  function edit(next: string) {
    setText(next);
    setStatus("");
  }
  async function save() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setStatus("");
    try {
      if (await onSave(text)) {
        setSavedValue(text);
        setStatus("saved");
      } else setStatus("failed");
    } catch {
      setStatus("failed");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="quick-message-personality"
      aria-labelledby="message-style-title"
    >
      <header>
        <div>
          <h3 id="message-style-title">表达习惯</h3>
          <p>写下你的表达习惯，生成时结合对象和场景调整语气。</p>
        </div>
      </header>
      <div className="message-style-presets" aria-label="表达偏好示例">
        {presets.map((preset) => (
          <Button
            key={preset.name}
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => edit(preset.text)}
          >
            {preset.name}
          </Button>
        ))}
      </div>
      <label htmlFor="message-style-prompt">自定义表达偏好</label>
      <Textarea
        id="message-style-prompt"
        value={text}
        maxLength={2000}
        rows={4}
        disabled={busy}
        aria-describedby="message-style-help"
        placeholder="例如：像我平时说话，亲切直接。同事间不用‘请问您’，不强行加表情；给客户时礼貌一点。"
        onChange={(event) => edit(event.target.value)}
      />
      <p id="message-style-help">
        留空使用自然友好的默认表达。本次请求指定的语气优先；保存后用于下次文字和语音草稿，已有草稿保持原样。
      </p>
      <div className="quick-message-actions">
        <Button
          disabled={busy || text === savedValue}
          onClick={() => void save()}
        >
          {busy ? "正在保存…" : "保存表达偏好"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !text}
          onClick={() => edit("")}
        >
          恢复默认
        </Button>
        <span className="message-style-count">
          {Array.from(text).length} / 2000
        </span>
      </div>
      {status === "saved" && <p role="status">已保存，下次生成草稿时生效</p>}
      {status === "failed" && (
        <p role="alert">保存失败，修改已保留，请重试。</p>
      )}
    </section>
  );
}
