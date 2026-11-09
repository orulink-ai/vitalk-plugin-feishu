import { useEffect, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { experimentsRequest, type VoiceStatus } from "../experiments/client";
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
    let timer:number|undefined;
    const refresh = async () => {
      try {
        const snapshot = await experimentsRequest<VoiceStatus>({ action: "voiceStatus" });
        if (mounted) setActive(snapshot.actionId === purpose && snapshot.status === "recording");
      } catch { /* The action error is shown when the user clicks. */ }
      finally { if(mounted) timer=window.setTimeout(()=>void refresh(),1000); }
    };
    void refresh();
    return () => { mounted = false; window.clearTimeout(timer); };
  }, [purpose]);
  async function toggle() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await experimentsRequest({ action: "voiceCommandToggle", purpose });
      const snapshot = await experimentsRequest<VoiceStatus>({ action: "voiceStatus" });
      setActive(snapshot.actionId === purpose && snapshot.status === "recording");
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
