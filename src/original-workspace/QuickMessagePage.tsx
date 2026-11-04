import { MessageStyleSettings } from "./MessageStyleSettings";
import { RecipientMemoryPanel } from "./RecipientMemoryPanel";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimentsRequest,
  type AiReply,
  type ExperimentsSnapshot,
  type FeishuAuthStatus,
} from "../experiments/client";
import { FeishuOverview, type FeishuTab } from "./FeishuOverview";
import { FeishuVoiceControls } from "./FeishuVoiceControls";
import { FeishuTaskWorkspace } from "./FeishuTaskWorkspace";
import { FeishuCalendarWorkspace } from "./FeishuCalendarWorkspace";
import { workspaceReplies, mergeWorkspaceReply } from "./workspace-receipts";
import { FeishuConnectionSettings } from "./FeishuConnectionSettings";
import { AgentVoiceShortcut } from "../experiments/AgentVoiceShortcut";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FEISHU_EXTERNAL_SEND_NOTICE } from "./sending-capability";
import "./quick-message.css";
import "./feishu-workspace.css";
import "./workspace-data-views.css";
function retainLiveReplies(
  incoming: ExperimentsSnapshot,
  replies: Map<string, AiReply>,
) {
  let merged = incoming;
  for (const reply of replies.values())
    merged = mergeWorkspaceReply(merged, reply);
  return merged;
}
export function QuickMessagePage() {
  const [snapshot, setSnapshot] = useState<ExperimentsSnapshot>();
  const [error, setError] = useState("");
  const [tab, setTab] = useState<FeishuTab>("overview");
  const [auth, setAuth] = useState<FeishuAuthStatus>();
  const [authPending, setAuthPending] = useState(true);
  const authVersion = useRef(0);
  const acceptAuth = useCallback((value: FeishuAuthStatus | undefined) => {
    if (value) {
      authVersion.current++;
      setAuth(value);
      setAuthPending(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    const version = ++authVersion.current;
    void experimentsRequest<FeishuAuthStatus>({ action: "feishuAuthStatus" })
      .then((value) => {
        if (active && version === authVersion.current) setAuth(value);
      })
      .catch(() => {})
      .finally(() => {
        if (active && version === authVersion.current) setAuthPending(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const pageRegion = useRef<HTMLElement>(null);
  const liveReplies = useRef(new Map<string, AiReply>());
  useEffect(() => {
    let active = true;
    const refresh = () => experimentsRequest<ExperimentsSnapshot>({ action: "read" })
      .then((s) => {
        if (active) {
          setSnapshot(retainLiveReplies(s, liveReplies.current));
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof TypeError
              ? "无法读取语音发送设置，请在 ViTalk 桌面端打开后重试。"
              : String(e instanceof Error ? e.message : e),
          );
      });
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  async function save(patch: Partial<ExperimentsSnapshot["config"]>) {
    if (!snapshot) return false;
    try {
      const next = await experimentsRequest({
        action: "saveConfig",
        config: patch,
      });
      setSnapshot(retainLiveReplies(next, liveReplies.current));
      setError("");
      return true;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return false;
    }
  }
  return (
    <section
      ref={pageRegion}
      className="quick-message-page"
      aria-label="飞书工作台"
    >
      <header className="feishu-workspace-header">
        <div>
          <h1>飞书</h1>

          <p>语音发送消息、创建任务，或预约日程与会议。</p>
        </div>
        <div className="feishu-header-actions">
          {snapshot && (
            <FeishuVoiceControls
              purpose={tab === "tasks" ? "task" : tab === "meetings" ? "calendar" : "message"}
              startLabel={
                tab === "tasks"
                  ? "语音创建任务"
                  : tab === "meetings"
                    ? "语音预约日程"
                    : "开始语音指令"
              }
            />
          )}
        </div>
      </header>
      {(tab === "overview" || tab === "messages") && (
        <p className="quick-message-capability">
          {FEISHU_EXTERNAL_SEND_NOTICE}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!snapshot ? (
        error ? null : (
          <p role="status">正在加载消息设置…</p>
        )
      ) : (
        <>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(String(value) as FeishuTab);
              pageRegion.current?.scrollTo?.({ top: 0 });
            }}
          >
            <TabsList variant="line" aria-label="飞书功能">
              <TabsTrigger value="overview">概览</TabsTrigger>
              <TabsTrigger value="messages">消息</TabsTrigger>
              <TabsTrigger value="tasks">任务</TabsTrigger>
              <TabsTrigger value="meetings">日程与会议</TabsTrigger>
              <TabsTrigger value="hotwords">对象热词</TabsTrigger>
              <TabsTrigger value="settings">设置</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <FeishuOverview
                auth={auth}
                authPending={authPending}
                config={snapshot.config}
                replies={workspaceReplies(snapshot)}
                onNavigate={setTab}
              />
            </TabsContent>
            <TabsContent value="tasks">
              <FeishuTaskWorkspace
                recipients={snapshot.feishuCatalog?.recipients ?? []}
                replies={workspaceReplies(snapshot)}
              />
            </TabsContent>
            <TabsContent value="meetings">
              <FeishuCalendarWorkspace replies={workspaceReplies(snapshot)} />
            </TabsContent>
            <TabsContent value="messages" keepMounted>
              <div className="quick-message-settings-intro">
                <h2>消息</h2>
                <p>明确的语音指令可直接发送；独立消息快捷键仍保留草稿确认。</p>
              </div>
              <MessageStyleSettings
                value={snapshot.config.feishuMessageStyle ?? ""}
                onSave={(style) => save({ feishuMessageStyle: style })}
              />
            </TabsContent>
            <TabsContent value="hotwords" keepMounted>
              <RecipientMemoryPanel
                recipients={snapshot.feishuCatalog?.recipients ?? []}
              />
            </TabsContent>
            <TabsContent value="settings" keepMounted>
              <div className="quick-message-settings-intro">
                <h2>发送设置</h2>
                <p>管理功能开关、快捷键和飞书连接。</p>
              </div>
              <div className="quick-message-shortcut">
                <AgentVoiceShortcut
                  config={snapshot.config}
                  enabled={!!snapshot.config.feishuTools}
                  onToggleEnabled={() => { void save({ feishuTools: !snapshot.config.feishuTools }); }}
                  onSaved={() => { void experimentsRequest<ExperimentsSnapshot>({ action: 'read' }).then(setSnapshot).catch(e => setError(String(e))); }}
                />
              </div>
              <FeishuConnectionSettings
                initialAuth={auth}
                onStatusChange={acceptAuth}
                model={snapshot.config.feishuRecipientModel ?? "llm"}
                catalog={snapshot.feishuCatalog}
                onModelChange={(model) =>
                  void save({ feishuRecipientModel: model })
                }
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </section>
  );
}
