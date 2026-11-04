import type { AiReply, ExperimentsSnapshot } from "../experiments/client";
export function workspaceReplies(snapshot?: ExperimentsSnapshot): AiReply[] {
  const map = new Map<string, AiReply>();
  for (const reply of [
    ...(snapshot?.aiReplies ?? []),
    ...(snapshot?.aiReply ? [snapshot.aiReply] : []),
  ]) {
    const old = map.get(reply.id);
    if (!old || (reply.revision ?? 0) >= (old.revision ?? 0))
      map.set(reply.id, reply);
  }
  return [...map.values()];
}
export function mergeWorkspaceReply(
  snapshot: ExperimentsSnapshot,
  reply: AiReply,
): ExperimentsSnapshot {
  const replies = workspaceReplies(snapshot);
  const old = replies.find((r) => r.id === reply.id);
  if (old && (old.revision ?? 0) > (reply.revision ?? 0)) return snapshot;
  return {
    ...snapshot,
    aiReplies: [...replies.filter((r) => r.id !== reply.id), reply],
    aiReply: reply,
  };
}
export function feishuDetailUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (u.hostname === "feishu.cn" || u.hostname.endsWith(".feishu.cn"))
    )
      return u.href;
  } catch {
    /* No unsafe external link is opened. */
  }
  return undefined;
}
