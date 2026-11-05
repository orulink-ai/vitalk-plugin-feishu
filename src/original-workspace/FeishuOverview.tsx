import {
  CalendarDays,
  MessageSquare,
  ListTodo,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  AiReply,
  ExperimentsConfig,
  FeishuAuthStatus,
} from "../experiments/client";
import { FeishuActivityPanel } from "./FeishuActivityPanel";
export type FeishuTab =
  "overview" | "messages" | "tasks" | "meetings" | "hotwords" | "settings";
const actions = [
  {
    tab: "messages",
    icon: MessageSquare,
    title: "发送消息",
    description: "联系人与群聊",
  },
  {
    tab: "tasks",
    icon: ListTodo,
    title: "管理任务",
    description: "查看、创建与完成",
  },
  {
    tab: "meetings",
    icon: CalendarDays,
    title: "查看日程",
    description: "个人安排与会议",
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
  const needsPermission =
    auth?.connected && auth.allPermissionsGranted === false;
  return (
    <div className="feishu-overview">
      <div
        className="feishu-connection-summary"
        data-attention={needsPermission || !auth?.connected || undefined}
      >
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>
            {auth
              ? auth.connected
                ? needsPermission
                  ? "需要补充授权"
                  : "已连接飞书"
                : "尚未连接飞书"
              : authPending
                ? "正在核对连接"
                : "连接状态未确认"}
          </strong>
          <p {...(needsPermission ? { role: "alert" } : {})}>
            {needsPermission || auth?.connected === false
              ? auth?.message
              : config.feishuTools
                ? "语音指令已开启"
                : "语音指令尚未开启，可在设置中开启。"}
          </p>
        </div>
        <Button
          variant={
            needsPermission || auth?.connected === false ? "default" : "ghost"
          }
          size="sm"
          onClick={() => onNavigate("settings")}
        >
          {needsPermission
            ? "补充授权"
            : auth?.connected
              ? "连接设置"
              : "连接飞书"}
        </Button>
      </div>
      <div className="feishu-overview-actions" aria-label="常用功能">
        {actions.map((action) => (
          <button
            key={action.tab}
            type="button"
            onClick={() => onNavigate(action.tab)}
          >
            <action.icon aria-hidden="true" />
            <span>
              <strong>{action.title}</strong>
              <small>{action.description}</small>
            </span>
            <ArrowRight aria-hidden="true" />
          </button>
        ))}
      </div>
      <details className="feishu-overview-examples">
        <summary>试试这样说</summary>
        <ul>
          <li>给小琼发消息，说资料已经整理好了</li>
          <li>给小琼创建任务，内容是整理项目资料</li>
          <li>明天下午两点和小琼聊半小时</li>
        </ul>
        <p>使用上方语音按钮，说明对象和要做的事。</p>
      </details>
      <div className="feishu-overview-links">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigate("hotwords")}
        >
          联系人称呼
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigate("messages")}
        >
          消息表达偏好
        </Button>
      </div>
      <details className="feishu-overview-history">
        <summary>
          操作记录{replies.length > 0 ? `（${replies.length}）` : ""}
        </summary>
        <FeishuActivityPanel replies={replies} />
      </details>
    </div>
  );
}
