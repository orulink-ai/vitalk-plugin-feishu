import { expect, it, vi } from "vitest";
import { completeTask, dismissTaskCompletion, taskCompletionFor, completionPreventsRetry } from "./task-completion";
const request=vi.hoisted(()=>vi.fn());
vi.mock("../experiments/client",()=>({experimentsRequest:request}));

it("retains an uncertain task submission across another task receipt and dismissal, scoped to its account",async()=>{
  request.mockResolvedValueOnce({status:"uncertain",message:"核对任务 A"}).mockResolvedValueOnce({status:"completed",message:"任务 B 完成"}).mockResolvedValueOnce({status:"completed",message:"另一账号"});
  await completeTask("ou_receipt_owner","task-a","A");
  await completeTask("ou_receipt_owner","task-b","B");
  dismissTaskCompletion("ou_receipt_owner");
  expect((await completeTask("ou_receipt_owner","task-a","A")).status).toBe("uncertain");
  expect(request).toHaveBeenCalledTimes(2);
  expect(completionPreventsRetry(taskCompletionFor("ou_receipt_owner","task-a"))).toBe(true);
  await completeTask("ou_other_receipt_owner","task-a","A");
  expect(request).toHaveBeenCalledTimes(3);
});

it("treats a missing completion receipt as terminal uncertainty",async()=>{
  request.mockReset();request.mockResolvedValue({});
  expect((await completeTask("ou_missing_ack","task-missing","Missing")).status).toBe("uncertain");
  await completeTask("ou_missing_ack","task-missing","Missing");
  expect(request).toHaveBeenCalledTimes(1);
});
