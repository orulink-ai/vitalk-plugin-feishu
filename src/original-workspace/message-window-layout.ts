import type { FeishuMessageDraft } from "./FeishuMessagePanel";
/** Bounded presets keep the native window inside the existing placement contract. */
export function messageWindowLayout(draft: Pick<FeishuMessageDraft, "content" | "attachments"> & {status?: FeishuMessageDraft["status"];recipientQuery?:string;recipient?:FeishuMessageDraft["recipient"]}): "message" | "message-long" | "message-attachments" {
  if (draft.attachments?.length) return "message-attachments";
  if (draft.status === "ready" && draft.recipientQuery && !draft.recipient) return "message-long";
  if (draft.status === "failed" || draft.status === "unknown") return "message-long";
  const lines = draft.content.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / 24)), 0);
  return lines > 3 ? "message-long" : "message";
}
