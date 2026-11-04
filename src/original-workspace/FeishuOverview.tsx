import {
  CalendarDays,
  MessageSquare,
  ListTodo,
  ShieldCheck,
  ArrowRight,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  AiReply,
  ExperimentsConfig,
  FeishuAuthStatus,
} from "../experiments/client";
import { FeishuActivityPanel } from "./FeishuActivityPanel";
export type FeishuTab =
  "overview" | "messages" | "tasks" | "meetings" | "hotwords" | "settings";
const capabilities = [
  {
    tab: "messages",
    icon: MessageSquare,
    title: "发送消息",
    description: "说出联系人或群聊和内容，匹配真实对象，按你的表达习惯发送。",
    example: "给小冰发消息，告诉她项目资料整理好了。",
  },
  {
    tab: "tasks",
    icon: ListTodo,
    title: "创建任务",
    description:
      "指定真实负责人，创建任务后发送任务分享卡片；查看自己负责的任务。",
    example: "给小冰创建任务，内容是整理本周项目资料。",
  },
  {
    tab: "meetings",
    icon: CalendarDays,
    title: "预约会议",
    description: "识别参与人和时间，核对忙闲，创建日程并发送邀请。",
    example: "预约小冰明天下午三点的会议，讨论项目进度。",
  },
] as const;
export function FeishuOverview({
  auth,
  authPending,
  config,
  replies,
  onNavigate,
}: {
  auth?: FeishuAuthStatus;
  authPending: boolean;
  config: ExperimentsConfig;
  replies: AiReply[];
  onNavigate: (tab: FeishuTab) => void;
}) {
  return (
    <div className="feishu-overview">
      <div className="feishu-connection-summary">
        <ShieldCheck />
        <div>
          <strong>
            {auth
              ? auth.connected
                ? auth.allPermissionsGranted === false
                  ? "需要补充授权"
                  : "已连接飞书"
                : "尚未连接飞书"
              : authPending
                ? "正在核对飞书连接"
                : "连接状态未确认"}
          </strong>
          <p>{auth?.message ?? "连接与授权在原飞书设置中统一管理。"}</p>
        </div>
        <Badge variant="secondary">
          {config.feishuTools ? "语音功能已开启" : "语音功能已关闭"}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigate("settings")}
        >
          管理连接
        </Button>
      </div>
      <div className="feishu-capability-grid">
        {capabilities.map((c) => (
          <Card key={c.tab}>
            <CardHeader>
              <c.icon className="feishu-capability-icon" />
              <CardTitle role="heading" aria-level={2}>
                {c.title}
              </CardTitle>
              <CardDescription>{c.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <blockquote>“{c.example}”</blockquote>
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate(c.tab)}
              >
                查看
                {c.tab === "messages"
                  ? "消息"
                  : c.tab === "tasks"
                    ? "任务"
                    : "会议"}
                用法
                <ArrowRight data-icon="inline-end" />
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      <div className="feishu-overview-links">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigate("hotwords")}
        >
          <Users data-icon="inline-start" />
          管理联系人与群聊称呼
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigate("messages")}
        >
          调整消息表达偏好
        </Button>
      </div>
      <FeishuActivityPanel replies={replies} />
    </div>
  );
}
