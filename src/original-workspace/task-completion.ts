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
const pending = new Map<string, Promise<TaskCompletion>>();
const listeners = new Set<() => void>();
function publish(receipt: TaskCompletion) {
  receipts.set(receipt.accountId, receipt);
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
export function useTaskCompletion(accountId?: string) {
  const snapshot = useCallback(
    () => (accountId ? receipts.get(accountId) : undefined),
    [accountId],
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
    .then((result) => ({
      ...initial,
      pending: false,
      status: result.status,
      message: result.message,
    }))
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
