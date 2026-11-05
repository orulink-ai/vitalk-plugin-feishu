import { useCallback, useSyncExternalStore } from "react";
import { experimentsRequest } from "../experiments/client";
export type TaskCompletion = {
  accountId: string;
  taskId: string;
  title: string;
  pending: boolean;
  status: string;
  message: string;
};
// Keep submitted operations alive when a tab unmounts. Receipts never cross accounts.
const receipts = new Map<string, TaskCompletion>();
const taskReceipts = new Map<string, TaskCompletion>();
const pending = new Map<string, Promise<TaskCompletion>>();
const listeners = new Set<() => void>();
function publish(receipt: TaskCompletion) {
  receipts.set(receipt.accountId, receipt);
  taskReceipts.set(JSON.stringify([receipt.accountId, receipt.taskId]), receipt);
  for (const listener of listeners) listener();
}
export function dismissTaskCompletion(accountId: string) {
  if (receipts.get(accountId)?.pending) return;
  receipts.delete(accountId);
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function taskCompletionFor(accountId?: string, taskId?: string) {
  return accountId && taskId
    ? taskReceipts.get(JSON.stringify([accountId, taskId]))
    : undefined;
}
export function completionPreventsRetry(receipt?: TaskCompletion) {
  return !!receipt && !receipt.pending && ["uncertain", "unknown", "failed", "completed"].includes(receipt.status);
}
export function useTaskCompletion(accountId?: string, taskId?: string) {
  const snapshot = useCallback(
    () => taskId ? taskCompletionFor(accountId, taskId) : (accountId ? receipts.get(accountId) : undefined),
    [accountId, taskId],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
export function completeTask(
  accountId: string,
  taskId: string,
  title: string,
): Promise<TaskCompletion> {
  const existing = pending.get(accountId);
  if (existing) return existing;
  const previous = taskCompletionFor(accountId, taskId);
  if (completionPreventsRetry(previous)) {
    publish(previous!);
    return Promise.resolve(previous!);
  }
  const initial = {
    accountId,
    taskId,
    title,
    pending: true,
    status: "pending",
    message: "正在提交任务完成操作…",
  };
  publish(initial);
  const operation = experimentsRequest<{ status: string; message: string }>({
    action: "feishuTaskComplete",
    accountId,
    id: taskId,
  })
    .then((result) => {
      const known = result && ["completed", "uncertain", "unknown", "rejected", "failed", "cancelled"].includes(result.status);
      return {
        ...initial,
        pending: false,
        status: known ? result.status : "uncertain",
        message: known && typeof result.message === "string" ? result.message : "未取得明确任务回执，请在飞书核对；不会重复提交。",
      };
    })
    .catch((error: unknown) => ({
      ...initial,
      pending: false,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    }))
    .then((result) => {
      publish(result);
      return result;
    })
    .finally(() => {
      pending.delete(accountId);
    });
  pending.set(accountId, operation);
  return operation;
}
