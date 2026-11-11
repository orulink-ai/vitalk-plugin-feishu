import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { openFeishuUrl } from "../client";
import type { AiReply } from "../experiments/client";
import { feishuDetailUrl } from "./workspace-receipts";
export function FeishuActivityPanel({
  replies,
  kind,
  onOpenUrl = openFeishuUrl,
}: {
  replies: AiReply[];
  kind?: "feishuTask" | "feishuMeeting";
  onOpenUrl?: (url:string)=>Promise<unknown>;
}) {
  const [error, setError] = useState("");
  const rows = replies
    .filter(
      (r) =>
        r.command?.destination.startsWith("feishu") &&
        (!kind || r.command.destination === kind),
    )
    .slice()
    .reverse();
  return (
    <section className="feishu-activity">
      <div className="feishu-section-heading">
        <h2>ViTalk 执行记录</h2>
        <p>
          {kind === "feishuMeeting"
            ? "本机保存的预约回执；邀请已发送不代表对方已接受。"
            : kind === "feishuTask"
              ? "本机保存的指令回执；任务创建完成不代表任务已办完。"
              : "这里保存本机语音操作回执，完整列表请切换任务或日程页面。"}
        </p>
      </div>
      {error && <p role="alert">{error}</p>}
      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有对应的执行记录</EmptyTitle>
          </EmptyHeader>
          <p>使用语音指令发送消息、创建任务或预约会议后，会在这里显示回执。</p>
        </Empty>
      ) : (
        <div className="feishu-activity-list">
          {rows.map((r) => {
            const command = r.command!;
            const url = feishuDetailUrl(
              command.task?.url ?? command.meeting?.url ?? "",
            );
            return (
              <article key={r.id}>
                <div>
                  <strong>
                    {command.task?.summary ??
                      (command.meeting ? "会议预约" : r.prompt)}
                  </strong>
                  <Badge variant="secondary">
                    {r.status === "completed"
                      ? command.task
                        ? "任务已创建"
                        : command.meeting
                          ? "日程已创建"
                          : "指令已完成"
                      : r.status === "failed"
                        ? "执行未完成"
                        : r.status === "cancelled"
                          ? "已取消"
                          : "处理中"}
                  </Badge>
                </div>
                {command.task && <p>负责人：{command.task.assignee}</p>}
                {command.task?.notification && (
                  <p>{command.task.notification}</p>
                )}
                {command.meeting && (
                  <>
                    <p>
                      {command.meeting.start} — {command.meeting.end}
                    </p>
                    <p>参与人：{command.meeting.participants.join("、")}</p>
                    <p>{command.meeting.invitation}</p>
                  </>
                )}
                {r.error && <p role="alert">{r.error}</p>}
                {url && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void onOpenUrl(url)
                        .catch(() => setError("无法打开飞书，请检查客户端。"))
                    }
                  >
                    <ExternalLink data-icon="inline-start" />
                    在飞书查看
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
