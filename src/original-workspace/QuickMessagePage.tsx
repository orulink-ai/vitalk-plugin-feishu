import { MessageStyleSettings } from "./MessageStyleSettings";
import {openPluginHistory} from '../plugin-history-notice';
import { RecipientMemoryPanel } from "./RecipientMemoryPanel";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimentsRequest,
  type AiReply,
  type ExperimentsSnapshot,
  type FeishuAuthStatus,
} from "../experiments/client";
import type { FeishuTab } from "./FeishuOverview";
import { FeishuActivityPanel } from "./FeishuActivityPanel";
import { FeishuMessagesWorkspace } from "./FeishuMessagesWorkspace";
import { FeishuVoiceControls } from "./FeishuVoiceControls";
import { VoiceShortcutHint } from "./VoiceShortcutHint";
import { FeishuTaskWorkspace } from "./FeishuTaskWorkspace";
import { FeishuCalendarWorkspace } from "./FeishuCalendarWorkspace";
import { workspaceReplies, mergeWorkspaceReply } from "./workspace-receipts";
import { FeishuConnectionSettings } from "./FeishuConnectionSettings";
import { AgentVoiceShortcut } from "../experiments/AgentVoiceShortcut";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FEISHU_EXTERNAL_SEND_NOTICE } from "./sending-capability";
import "./quick-message.css";
import "./feishu-workspace.css";
import "./workspace-data-views.css";
import "./feishu-workspace-simplified.css";
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
  const [readError, setReadError] = useState("");
  const [tab, setTab] = useState<FeishuTab>("messages");
  const [shortcutsOpen,setShortcutsOpen]=useState(false);
  const [voiceContainer,setVoiceContainer]=useState<HTMLDivElement|null>(null);
  const shortcutsRegion=useRef<HTMLDetailsElement>(null);
  function openShortcuts(){setShortcutsOpen(true);setTab("settings");}
  useEffect(()=>{
    if(tab!=="settings"||!shortcutsOpen)return;
    shortcutsRegion.current?.scrollIntoView?.({block:"center",behavior:"smooth"});
    shortcutsRegion.current?.querySelector("summary")?.focus();
  },[tab,shortcutsOpen]);
  const [visited, setVisited] = useState(()=>new Set<FeishuTab>(["messages"]));
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

    let inflight: Promise<void> | undefined;
    const refresh = () => {
      if (inflight) return inflight;

      inflight = experimentsRequest<ExperimentsSnapshot>({ action: "read" })
        .then((s) => {
          if (active) {
            setSnapshot(retainLiveReplies(s, liveReplies.current));
            setReadError("");
          }
        })
        .catch((e) => {
          if (active)
            setReadError(
              e instanceof TypeError
                ? "无法读取语音发送设置，请在 ViTalk 桌面端打开后重试。"
                : String(e instanceof Error ? e.message : e),
            );
        }).finally(() => {
          inflight = undefined;

        });
      return inflight;
    };
    const onWorkspaceChanged=()=>{void refresh();};
    const onDraft=()=>{setTab("messages");void refresh();};
    const onVoiceError=(event:Event)=>setError((event as CustomEvent<string>).detail);
    window.addEventListener("focus",onWorkspaceChanged);
    window.addEventListener("feishu-workspace-changed",onWorkspaceChanged);
    window.addEventListener("feishu-message-draft-ready",onDraft);
    window.addEventListener("feishu-voice-error",onVoiceError);
    void refresh();
    return () => {
      active = false;

      window.removeEventListener("focus",onWorkspaceChanged);
      window.removeEventListener("feishu-workspace-changed",onWorkspaceChanged);
      window.removeEventListener("feishu-message-draft-ready",onDraft);
      window.removeEventListener("feishu-voice-error",onVoiceError);
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
      data-workspace={tab}
      aria-label="飞书工作台"
    >
      <header className="feishu-workspace-header">
        <div>
          <h1>飞书</h1>

          <p>消息、任务和日程，在这里处理。</p>
        </div>
        <div className="feishu-header-actions">
          <button type="button" className="feishu-connection-shortcut" onClick={()=>setTab("settings")}>
            {authPending ? "检查连接…" : auth?.allPermissionsGranted ? "飞书已连接" : auth?.connected || auth?.taskConnected || auth?.calendarConnected ? "需补充授权" : "连接飞书"}
          </button>
          <div className="feishu-header-voice-slot" ref={setVoiceContainer}>
          {snapshot && (tab === "tasks" || tab === "meetings") && (
            <div className="feishu-voice-entry"><FeishuVoiceControls
              purpose={
                tab === "tasks"
                  ? "task"
                  : tab === "meetings"
                    ? "calendar"
                    : "message"
              }
              startLabel={
                tab === "tasks"
                  ? "语音创建任务"
                  : tab === "meetings"
                    ? "语音预约日程"
                    : "开始语音指令"
              }
            />
            <VoiceShortcutHint purpose={tab==="tasks"?"task":"calendar"} config={snapshot.config} onOpenSettings={openShortcuts}/></div>
          )}
          </div>
        </div>
      </header>
      {(error || readError) && <p role="alert">{error || readError}</p>}
      {!snapshot ? (
        error || readError ? null : (
          <p role="status">正在加载消息设置…</p>
        )
      ) : (
        <>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              if(value==='overview'){void openPluginHistory().catch(error=>setError(String(error instanceof Error?error.message:error)));return;}
              setTab(String(value) as FeishuTab);
              setVisited(current=>new Set([...current,String(value) as FeishuTab]));
              pageRegion.current?.scrollTo?.({ top: 0 });
            }}
          >
            <div className="feishu-workspace-navigation">
            <TabsList variant="line" aria-label="飞书工作">
              <TabsTrigger value="messages">消息</TabsTrigger>
              <TabsTrigger value="tasks">任务</TabsTrigger>
              <TabsTrigger value="meetings">日程</TabsTrigger>
            </TabsList>
            <TabsList variant="line" aria-label="飞书管理">
              <TabsTrigger value="hotwords">联系人</TabsTrigger>
              <TabsTrigger value="overview">操作记录</TabsTrigger>
              <TabsTrigger value="settings">设置</TabsTrigger>
            </TabsList>
            </div>
            <TabsContent value="overview">
              <FeishuActivityPanel replies={workspaceReplies(snapshot)} />
            </TabsContent>
            <TabsContent value="tasks" keepMounted>
              {visited.has("tasks") && <FeishuTaskWorkspace
                recipients={snapshot.feishuCatalog?.recipients ?? []}
                replies={workspaceReplies(snapshot)}
              />}
            </TabsContent>
            <TabsContent value="meetings" keepMounted>
              {visited.has("meetings") && <FeishuCalendarWorkspace replies={workspaceReplies(snapshot)} />}
            </TabsContent>
            <TabsContent value="messages" keepMounted>
              <FeishuMessagesWorkspace snapshot={snapshot} onOpenShortcuts={openShortcuts} voiceInHeader voiceContainer={voiceContainer} voiceVisible={tab==="messages"}/>
              <p className="quick-message-capability">{FEISHU_EXTERNAL_SEND_NOTICE}</p>
            </TabsContent>
            <TabsContent value="hotwords" keepMounted>
              <RecipientMemoryPanel
                recipients={snapshot.feishuCatalog?.recipients ?? []}
              />
            </TabsContent>
            <TabsContent value="settings" keepMounted>
              <FeishuConnectionSettings
                initialAuth={auth}
                onStatusChange={acceptAuth}
                model={snapshot.config.feishuRecipientModel ?? "llm"}
                catalog={snapshot.feishuCatalog}
                onModelChange={(model) =>
                  void save({ feishuRecipientModel: model })
                }
              />
              <details className="feishu-settings-disclosure">
                <summary>消息表达偏好</summary>
                <MessageStyleSettings value={snapshot.config.feishuMessageStyle ?? ""} onSave={(style) => save({feishuMessageStyle:style})}/>
              </details>
              <details className="feishu-settings-disclosure" ref={shortcutsRegion} open={shortcutsOpen} onToggle={event=>setShortcutsOpen(event.currentTarget.open)}>
                <summary>语音快捷键与功能开关</summary>
                <div className="quick-message-shortcut">
                  <AgentVoiceShortcut
                    config={snapshot.config}
                    enabled={!!snapshot.config.feishuTools}
                    onToggleEnabled={() => {
                      void save({ feishuTools: !snapshot.config.feishuTools });
                    }}
                    onSaved={() => {
                      void experimentsRequest<ExperimentsSnapshot>({
                        action: "read",
                      })
                        .then(setSnapshot)
                        .catch((e) => setError(String(e)));
                    }}
                  />
                </div>
              </details>
            </TabsContent>
          </Tabs>
        </>
      )}
    </section>
  );
}
