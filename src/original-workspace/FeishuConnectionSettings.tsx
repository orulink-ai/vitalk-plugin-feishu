import { CheckCircle2, Info, MessageSquare, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { openFeishuUrl, registerFeishuApplication, cancelFeishuAuthorization } from "../client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "../experiments/client";
import { FEISHU_EXTERNAL_SEND_NOTICE } from "./sending-capability";
import "./feishu-connection.css";

type Operation =
  "register" | "check" | "authorize" | "complete" | "sync" | "installCli";
type CliStatus = { installed: boolean; version?: string };
const syncTime = (catalog?: FeishuCatalog) => {
  const time = catalog?.lastSync ?? 0;
  return time > 1e12 ? time : time * 1000;
};

export function FeishuConnectionSettings({
  catalog,
  onStatusChange,
  initialAuth,
}: {
  model: "llm" | "jev";
  catalog?: FeishuCatalog;
  onModelChange: (model: "llm" | "jev") => void;
  initialAuth?: FeishuAuthStatus;
  onStatusChange?: (status: FeishuAuthStatus | undefined) => void;
}) {
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
  const [flow, setFlow] = useState<FeishuAuthorizationFlow | undefined>(
    initialAuth?.pendingAuthorization,
  );
  const [error, setError] = useState("");
  const [browserError, setBrowserError] = useState("");
  const [pending, setPending] = useState<Operation | null>(null);
  const locked = useRef(false);
  const busy = pending !== null;
  useEffect(() => {
    let active = true;
    void experimentsRequest<CliStatus>({ action: "feishuPluginCliStatus" })
      .then((value) => {
        if (active) setCli(value);
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
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
      description="管理账号授权与通讯录。"
    >
      <TranscriptionSettingsCard>
        {cli?.installed ? (
          <div className="feishu-cli-ready">
            <CheckCircle2 size={14} aria-hidden="true" />
            <span>{"已安装飞书 CLI " + (cli.version ?? "")}</span>
          </div>
        ) : (
          <TranscriptionSettingsRow
            label="飞书 CLI"
            description={
              cli
                ? cli.installed
                  ? "已安装飞书 CLI " + (cli.version ?? "")
                  : "尚未安装飞书 CLI"
                : "正在检查飞书 CLI…"
            }
            control={
              cli?.installed ? (
                <Badge variant="secondary">已安装</Badge>
              ) : !cli ? null : (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void perform("installCli", async () => {
                      setCli(
                        await experimentsRequest<CliStatus>({
                          action: "feishuPluginCliInstall",
                        }),
                      );
                      publishStatus(
                        await experimentsRequest<FeishuAuthStatus>({
                          action: "feishuAuthStatus",
                        }),
                      );
                    })
                  }
                >
                  下载并安装
                </Button>
              )
            }
          />
        )}
        <TranscriptionSettingsRow
          label="账号连接"
          description={
            (flow && auth?.connected
              ? "已有飞书连接；本次重新授权尚未完成，请完成下方官方页面确认。"
              : auth?.connected && auth.allPermissionsGranted !== false
                ? "账号已连接。"
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
                  size="sm"
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
                className="feishu-authorize-button"
                data-primary={
                  !auth?.connected ||
                  auth.allPermissionsGranted === false ||
                  undefined
                }
                size="sm"
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
        {!auth?.connected && !flow && (
          <details><summary>首次使用飞书</summary>
            <p>仅在尚未配置飞书应用时使用。已有应用请点击“连接飞书”，保留当前配置。</p>
            <Button size="sm" disabled={busy || checking} onClick={()=>void perform("register",async()=>{
              try { setFlow(await registerFeishuApplication(value=>setFlow(value))); }
              catch(error){setFlow(undefined);throw error;}
            })}>首次配置飞书应用</Button>
          </details>
        )}
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
              <h3>{flow.stage === "registration" ? "连接飞书应用" : "完成飞书授权"}</h3>
              <p>
                {flow.stage === "registration" ? "在飞书官方页面完成应用配置，收到回执后会进入账号授权。" : "在浏览器或扫码完成登录确认后，回到这里确认。若只看到“权限已添加”，请返回原授权页面继续完成设备授权。"}
              </p>
              {pending === "complete" && (
                <p role="status">
                  正在等待飞书完成设备确认，请保留授权页面；有效期内会自动接收回执。
                </p>
              )}
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
                      void openFeishuUrl(safeUrl).catch((error) =>
                        setBrowserError(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        ),
                      );
                    }}
                  >
                    在浏览器中授权飞书
                  </a>
                ) : (
                  <p role="alert">授权链接无效，请重新连接。</p>
                )}
                {flow.stage !== "registration" && <Button
                  size="sm"
                  disabled={busy || !safeUrl}
                  onClick={() =>
                    void perform("complete", async () => {
                      let result: FeishuAuthStatus;
                      try {
                        result = await experimentsRequest<FeishuAuthStatus>({
                          action: "feishuAuthComplete",
                          flowId: flow.flowId,
                        });
                      } catch (failure) {
                        // A timed-out device code can no longer be confirmed.
                        // Reconcile with native state instead of leaving its QR
                        // visible indefinitely or treating an old login as success.
                        const latest =
                          await experimentsRequest<FeishuAuthStatus>({
                            action: "feishuAuthStatus",
                          }).catch(() => undefined);
                        if (latest) publishStatus(latest);
                        if (
                          latest &&
                          !latest.pendingAuthorization &&
                          failure instanceof Error &&
                          (failure.message.includes("超时") ||
                            ("code" in failure && failure.code === "timeout"))
                        ) {
                          throw new Error(
                            "本次授权请求未能确认，待确认流程已结束。已重新读取当前连接状态；如需继续，请重新发起授权。",
                          );
                        }
                        throw failure;
                      }
                      publishStatus(result);
                      if (result.connected && !result.pendingAuthorization) {
                        setFlow(undefined);
                        await sync();
                      }
                    })
                  }
                >
                  {pending === "complete"
                    ? "正在等待授权回执…"
                    : "我已完成授权"}
                </Button>}
                <Button size="sm" variant="outline" onClick={()=>{cancelFeishuAuthorization();setFlow(undefined);}}>取消授权</Button>
              </div>
            </div>
          </div>
        )}
        <TranscriptionSettingsRow
          label="通讯录"
          description={
            current
              ? `已缓存 ${current.recipients.length} 个对象${current.lastSync ? ` · ${new Date(syncTime(current)).toLocaleDateString()} 更新` : " · 尚未同步"}`
              : "尚未同步联系人、群聊和机器人。"
          }
          status={
            <p className="feishu-catalog-hint">
              {current?.partial
                ? "仅同步了部分可见对象，找不到时可搜索或重新更新。"
                : null}
            </p>
          }
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={busy || checking || !auth?.connected}
              onClick={() => void perform("sync", sync)}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {pending === "sync" ? "正在更新…" : "更新通讯录"}
            </Button>
          }
        />
      </TranscriptionSettingsCard>
      {(error || browserError) && (
        <p role="alert" className="feishu-connection-error">
          {error || browserError}
        </p>
      )}
      <details className="feishu-advanced-settings">
        <summary>高级设置</summary>
        <div className="feishu-advanced-content">
          <TranscriptionSettingsRow
            label="对象匹配方式"
            description="使用已配置的文字模型，结合称呼、通讯录与上下文理解对象。"
            status={<p className="feishu-catalog-hint">对象不明确时需先确认。</p>}
            control={<span>文字模型</span>}
          />
          <div className="feishu-connection-notice" role="note">
            <Info size={16} aria-hidden="true" />
            <p>{FEISHU_EXTERNAL_SEND_NOTICE}</p>
          </div>
          {auth?.connected && auth.allPermissionsGranted !== false && (
            <p className="feishu-diagnostic-status">{auth.message}</p>
          )}
        </div>
      </details>

    </SettingsSection>
  );
}
