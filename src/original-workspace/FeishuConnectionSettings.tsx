import { Info, MessageSquare, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { openFeishuUrl } from "../client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SettingsSection,
  TranscriptionSettingsCard,
  TranscriptionSettingsRow,
} from "@/settings/components";
import {
  experimentsRequest,
  type FeishuAuthStatus,
  type FeishuAuthorizationFlow,
  type FeishuCatalog,
  type FeishuComparisonReport,
} from "../experiments/client";
import { FEISHU_EXTERNAL_SEND_NOTICE } from "./sending-capability";
import "./feishu-connection.css";

type Operation =
  "check" | "authorize" | "complete" | "sync" | "compare" | "installCli";
type CliStatus = {installed:boolean;version?:string};
const models = [
  { value: "llm", label: "文字模型" },
  { value: "jev", label: "JEV 决策模型" },
];
const syncTime = (catalog?: FeishuCatalog) => {
  const time = catalog?.lastSync ?? 0;
  return time > 1e12 ? time : time * 1000;
};

export function FeishuConnectionSettings({
  model,
  catalog,
  onModelChange,
  onStatusChange,
  initialAuth,
}: {
  model: "llm" | "jev";
  catalog?: FeishuCatalog;
  onModelChange: (model: "llm" | "jev") => void;
  initialAuth?: FeishuAuthStatus;
  onStatusChange?: (status: FeishuAuthStatus | undefined) => void;
}) {
  const [comparison, setComparison] = useState<FeishuComparisonReport>();
  const [cli, setCli] = useState<CliStatus>();
  const [auth, setAuth] = useState<FeishuAuthStatus | undefined>(initialAuth);
  const statusCallback = useRef(onStatusChange);
  useEffect(() => {
    statusCallback.current = onStatusChange;
  }, [onStatusChange]);
  // Incoming controlled snapshots must not be echoed back to the parent.
  const publishStatus = useCallback((value: FeishuAuthStatus) => {
    setAuth(value);
    setFlow(value.pendingAuthorization);
    statusCallback.current?.(value);
  }, []);
  const [checking, setChecking] = useState(!initialAuth);
  const [localCatalog, setCatalog] = useState<FeishuCatalog>();
  const [flow, setFlow] = useState<FeishuAuthorizationFlow | undefined>(initialAuth?.pendingAuthorization);
  const [error, setError] = useState("");
  const [browserError, setBrowserError] = useState("");
  const [pending, setPending] = useState<Operation | null>(null);
  const locked = useRef(false);
  const busy = pending !== null;
  useEffect(() => {
    let active = true;
    void experimentsRequest<CliStatus>({action:"feishuPluginCliStatus"})
      .then(value => {if(active) setCli(value);})
      .catch(error => {if(active) setError(String(error));});
    return () => {active = false;};
  }, []);
  useEffect(() => {
    if (initialAuth) {
      setAuth(initialAuth);
      // A passive snapshot must not replace a device flow being confirmed.
      // When idle, keep the restored QR in sync with the native snapshot.
      if (!locked.current) setFlow(initialAuth.pendingAuthorization);
      setChecking(false);
    }
  }, [initialAuth]);
  const operationVersion = useRef(0);
  useEffect(() => {
    let disposed = false;
    const version = operationVersion.current;
    void experimentsRequest<FeishuAuthStatus>({ action: "feishuAuthStatus" })
      .then((status) => {
        if (!disposed && version === operationVersion.current) {
          publishStatus(status);
        }
      })
      .catch((error) => {
        if (!disposed && version === operationVersion.current)
          setError(String(error instanceof Error ? error.message : error));
      })
      .finally(() => {
        if (!disposed) setChecking(false);
      });
    return () => {
      disposed = true;
    };
  }, [publishStatus]);
  const perform = async (name: Operation, operation: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    operationVersion.current += 1;
    setPending(name);
    setError("");
    setBrowserError("");
    try {
      await operation();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      locked.current = false;
      setPending(null);
    }
  };
  const sync = async () => {
    setCatalog(
      await experimentsRequest<FeishuCatalog>({ action: "feishuSync" }),
    );
  };
  // Parent catalog events remain visible after a manual sync.
  const current =
    !localCatalog || (catalog && syncTime(catalog) > syncTime(localCatalog))
      ? catalog
      : localCatalog;
  const safeUrl = flow?.verificationUrl.startsWith("https://")
    ? flow.verificationUrl
    : undefined;
  const status =
    checking || pending === "check"
      ? "检查中"
      : flow
        ? "等待本次授权"
      : auth
        ? auth.connected
          ? auth.allPermissionsGranted === false
            ? "需补充授权"
            : "已连接"
          : "未连接"
        : "检查失败";
  return (
    <SettingsSection
      className="feishu-connection-settings"
      icon={<MessageSquare size={20} />}
      title="飞书连接"
      description="连接或重新授权一次申请联系人、消息、任务和日历权限。语音指令可直接发送明确消息、创建任务并通知、预约会议并邀请参与人。"
    >
      <TranscriptionSettingsCard>
        <TranscriptionSettingsRow
          label="飞书 CLI"
          description={cli ? (cli.installed ? "已安装飞书 CLI " + (cli.version ?? "") : "尚未安装飞书 CLI") : "正在检查飞书 CLI…"}
          control={<Button variant="outline" disabled={busy || !cli || cli.installed} onClick={() => void perform("installCli", async () => {
            setCli(await experimentsRequest<CliStatus>({action:"feishuPluginCliInstall"}));
            publishStatus(await experimentsRequest<FeishuAuthStatus>({action:"feishuAuthStatus"}));
          })}>下载并安装</Button>}
        />
        <TranscriptionSettingsRow
          label="账号连接"
          description={
            (flow && auth?.connected
              ? "已有飞书连接；本次重新授权尚未完成，请完成下方官方页面确认。"
              : auth?.message) ||
            (checking || pending === "check"
              ? "正在检查飞书连接…"
              : "连接状态检查失败，请重试。")
          }
          status={
            <Badge variant="secondary" role="status">
              {status}
            </Badge>
          }
          control={
            <div className="feishu-connection-actions">
              {!checking && (
                <Button
                  variant="outline"
                  size="lg"
                  disabled={busy}
                  onClick={() =>
                    void perform("check", async () => {
                      publishStatus(
                        await experimentsRequest<FeishuAuthStatus>({
                          action: "feishuAuthStatus",
                        }),
                      );
                    })
                  }
                >
                  {pending === "check" ? "正在检查…" : "重新检查"}
                </Button>
              )}
              <Button
                variant={auth?.connected ? "outline" : "default"}
                size="lg"
                disabled={busy || checking}
                onClick={() =>
                  void perform("authorize", async () => {
                    setFlow(
                      await experimentsRequest({ action: "feishuAuthStart" }),
                    );
                  })
                }
              >
                {pending === "authorize"
                  ? "正在获取授权…"
                  : auth?.connected
                    ? "重新授权"
                    : "连接飞书"}
              </Button>
            </div>
          }
        />
        {flow && (
          <div className="feishu-authorization" aria-label="飞书授权">
            {flow.qrDataUrl?.startsWith("data:image/") && (
              <img
                src={flow.qrDataUrl}
                alt="飞书授权二维码"
                width={144}
                height={144}
              />
            )}
            <div>
              <h3>完成飞书授权</h3>
              <p>在浏览器或扫码完成登录确认后，回到这里确认。若只看到“权限已添加”，请返回原授权页面继续完成设备授权。</p>
              {pending === "complete" && <p role="status">正在等待飞书完成设备确认，请保留授权页面；有效期内会自动接收回执。</p>}
              <div className="feishu-connection-actions">
                {safeUrl ? (
                  <a
                    href={safeUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                      event.preventDefault();
                      // Opening the verification page must remain possible while
                      // the native device-login command waits for user consent.
                      setBrowserError("");
                      void openFeishuUrl(safeUrl)
                        .catch(error => setBrowserError(error instanceof Error ? error.message : String(error)));
                    }}
                  >
                    在浏览器中授权飞书
                  </a>
                ) : (
                  <p role="alert">授权链接无效，请重新连接。</p>
                )}
                <Button
                  size="lg"
                  disabled={busy || !safeUrl}
                  onClick={() =>
                    void perform("complete", async () => {
                      const result = await experimentsRequest<FeishuAuthStatus>(
                        { action: "feishuAuthComplete", flowId: flow.flowId },
                      );
                      publishStatus(result);
                      if (result.connected && !result.pendingAuthorization) {
                        setFlow(undefined);
                        await sync();
                      }
                    })
                  }
                >
                  {pending === "complete" ? "正在等待授权回执…" : "我已完成授权"}
                </Button>
              </div>
            </div>
          </div>
        )}
        <TranscriptionSettingsRow
          label="通讯录"
          description={
            current
              ? `已缓存 ${current.recipients.length} 个对象 · ${current.lastSync ? `上次更新：${new Date(syncTime(current)).toLocaleString()}` : "尚未同步"}`
              : "尚未同步联系人、群聊和机器人。"
          }
          status={
            <p className="feishu-catalog-hint">
              {current?.partial
                ? "仅同步了部分可见对象，找不到时可搜索或重新更新。"
                : "同步当前账号可见的联系人、群聊和机器人。"}
            </p>
          }
          control={
            <Button
              variant="outline"
              size="lg"
              disabled={busy || checking || !auth?.connected}
              onClick={() => void perform("sync", sync)}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {pending === "sync" ? "正在更新…" : "更新通讯录"}
            </Button>
          }
        />
        <TranscriptionSettingsRow
          label="对象匹配方式"
          description={
            model === "llm"
              ? "使用已配置的文字模型匹配对象，并生成消息正文。"
              : "对象热词先辅助转写，已保存的称呼优先匹配；不确定时 JEV 排序候选，文字模型理解意图并整理内容。"
          }
          status={
            <p className="feishu-catalog-hint">
              消息可在发送浮窗中改人；任务或日程有多个候选时，请确认全名或绑定称呼后再执行。
            </p>
          }
          control={
            <Select
              items={models}
              value={model}
              disabled={busy}
              onValueChange={(value) => {
                if (value === "llm" || value === "jev") onModelChange(value);
              }}
            >
              <SelectTrigger
                className="feishu-connection-model"
                aria-label="对象匹配方式"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="llm">文字模型</SelectItem>
                <SelectItem value="jev">JEV 决策模型</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <div className="feishu-connection-notice" role="note">
          <Info size={16} aria-hidden="true" />
          <p>{FEISHU_EXTERNAL_SEND_NOTICE}</p>
        </div>
      </TranscriptionSettingsCard>
      {(error || browserError) && (
        <p role="alert" className="feishu-connection-error">
          {error || browserError}
        </p>
      )}
      <details className="feishu-strategy-comparison">
        <summary>高级 · 匹配策略测试</summary>
        <div className="feishu-comparison-content">
          <p>
            使用当前文字模型与已配置 JEV
            运行合成样例，不发送消息。可能产生正常模型用量。
          </p>
          <Button
            variant="outline"
            size="lg"
            disabled={busy}
            onClick={() =>
              void perform("compare", async () => {
                setComparison(undefined);
                setComparison(
                  await experimentsRequest<FeishuComparisonReport>({
                    action: "feishuCompare",
                  }),
                );
              })
            }
          >
            {pending === "compare" ? "正在比较…" : "比较解析策略"}
          </Button>
          {comparison && (
            <div aria-label="解析策略对比报告">
              <p role="status">
                {!comparison.executed
                  ? "对比尚未执行"
                  : !comparison.complete
                    ? "对比未完整，不能据此判断优劣"
                    : "合成样例对比完成，结果仅适用于这些样例"}
                ；合成样例：{comparison.caseCount}
              </p>
              {(["llm", "jev"] as const).map((name) => {
                const result = comparison.summary[name];
                return (
                  <p key={name}>
                    {name === "llm" ? "文字模型" : "JEV"}：正确 {result.correct}{" "}
                    / {result.cases}，误选 {result.falseSelections}，拒绝{" "}
                    {result.rejections}，失败 {result.failures}；平均耗时{" "}
                    {result.meanLatencyMs === null
                      ? "未测得"
                      : `${Math.round(result.meanLatencyMs)} ms`}
                    ；样例正确率{" "}
                    {result.sampleAccuracy === null
                      ? "未测得"
                      : `${Math.round(result.sampleAccuracy * 100)}%`}
                  </p>
                );
              })}
              {comparison.limitations.map((limitation, index) => (
                <p key={index}>{limitation}</p>
              ))}
            </div>
          )}
        </div>
      </details>
    </SettingsSection>
  );
}
