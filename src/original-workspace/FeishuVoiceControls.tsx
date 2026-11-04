import { useEffect, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { experimentsRequest, type ExperimentsSnapshot } from "../experiments/client";
export function FeishuVoiceControls({
  startLabel = "开始语音指令",
  purpose = "message",
}: {
  startLabel?: string;
  purpose?: "message" | "task" | "calendar";
}) {
  const [active,setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const snapshot = await experimentsRequest<ExperimentsSnapshot>({ action: "read" });
        if (mounted) setActive(snapshot.recording?.mode === "plugin:vitalk-plugin-feishu:" + purpose && snapshot.recording.status === "recording");
      } catch { /* The action error is shown when the user clicks. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [purpose]);
  async function toggle() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await experimentsRequest({ action: "voiceCommandToggle", purpose });
      const snapshot = await experimentsRequest<ExperimentsSnapshot>({ action: "read" });
      setActive(snapshot.recording?.mode === "plugin:vitalk-plugin-feishu:" + purpose && snapshot.recording.status === "recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="feishu-voice-controls">
      <div className="feishu-voice-actions">
        <Button
          disabled={pending}
          onClick={() => void toggle()}
        >
          {active ? (
            <Square data-icon="inline-start" />
          ) : (
            <Mic data-icon="inline-start" />
          )}
          {active ? "结束语音指令" : startLabel}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
