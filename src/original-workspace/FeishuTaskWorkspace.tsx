import { useEffect, useId, useRef, useState } from "react";
import {
  RefreshCw,
  ExternalLink,
  ChevronDown,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { openFeishuUrl } from "../client";
import { experimentsRequest, type AiReply } from "../experiments/client";
import type { FeishuRecipient } from "./FeishuMessagePanel";
import { WorkspaceSelect, WorkspaceHistory } from "./workspace-controls";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import {
  selectTasks,
  isTaskOverdue,
  taskAssigneeIds,
  type DeadlineFilter,
  type TaskSort,
  type StartFilter,
} from "./task-filters";
import {
  completeTask,
  useTaskCompletion,
  dismissTaskCompletion,
  taskCompletionFor,
  completionPreventsRetry,
} from "./task-completion";
import { FeishuTaskAssignees } from "./FeishuTaskAssignees";
import { feishuDetailUrl } from "./workspace-receipts";
import { WorkspaceCreateAction } from "./WorkspaceCreateAction";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
export type FeishuTaskItem = {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  ownerIds?: string[];
  creatorId?: string;
  startTimestamp?: string;
  createdAt?: string;
  updatedAt?: string;
  dueTimestamp: string;
  dueIsAllDay?: boolean;
  completed: boolean;
  url: string;
};
type TaskList = {
  items: FeishuTaskItem[];
  hasMore: boolean;
  nextPageToken: string;
  accountId: string;
};
const deadlineOptions: { value: DeadlineFilter; label: string }[] = [
  { value: "all", label: "全部截止时间" },
  { value: "overdue", label: "已逾期" },
  { value: "today", label: "今天到期" },
  { value: "week", label: "本周到期" },
  { value: "next7", label: "未来7天" },
  { value: "undated", label: "未设置日期" },
  { value: "custom", label: "自定义日期范围" },
];
export function FeishuTaskWorkspace({
  recipients,
  replies,
}: {
  recipients: FeishuRecipient[];
  replies: AiReply[];
}) {
  const [status, setStatus] = useState("pending"),
    [query, setQuery] = useState("");
  const completed = status === "all" ? undefined : status === "completed";
  const [creator, setCreator] = useState("all"),
    [startFilter, setStartFilter] = useState<StartFilter>("all");
  const [dueFrom, setDueFrom] = useState(""),
    [dueTo, setDueTo] = useState("");
  const [result, setResult] = useState<TaskList>();
  const [deadline, setDeadline] = useState<DeadlineFilter>("all");
  const [owner, setOwner] = useState("all");
  const [sort, setSort] = useState<TaskSort>("original");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterId = useId();
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedTask,setSelectedTask]=useState<FeishuTaskItem|null>(null);
  const [detailError,setDetailError]=useState<{taskId:string;accountId:string;message:string}>();
  const completion = useTaskCompletion(result?.accountId);
  const selectedCompletion = useTaskCompletion(result?.accountId, selectedTask?.id);
  const pending = completion?.pending ? completion.taskId : "";
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const epoch = useRef(0),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    const version = ++epoch.current;
    setLoading(true);
    setError("");
    setResult(undefined);
    setSelectedTask(null);
    void experimentsRequest<TaskList>({ action: "feishuTaskList", completed })
      .then((v) => {
        if (!alive.current || version !== epoch.current) return;
        if (!Array.isArray(v.items) || !v.accountId)
          throw Error("任务列表返回格式无效，请刷新。");
        setResult(v);
      })
      .catch((e) => {
        if (alive.current && version === epoch.current)
          setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive.current && version === epoch.current) setLoading(false);
      });
    return () => {
      epoch.current++;
    };
  }, [completed, refresh]);
  async function more() {
    if (!result?.hasMore || loading) return;
    const version = ++epoch.current;
    setLoading(true);
    try {
      const v = await experimentsRequest<TaskList>({
        action: "feishuTaskList",
        completed,
        pageToken: result.nextPageToken,
      });
      if (!alive.current || version !== epoch.current) return;
      if (v.accountId !== result.accountId)
        throw Error("飞书账号已变化，请刷新任务列表。");
      if (!Array.isArray(v.items)) throw Error("任务列表返回格式无效。");
      setResult({
        ...v,
        items: [
          ...new Map(
            [...result.items, ...v.items].map((t) => [t.id, t]),
          ).values(),
        ],
      });
    } catch (e) {
      if (alive.current && version === epoch.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current && version === epoch.current) setLoading(false);
    }
  }
  async function finish(task: FeishuTaskItem) {
    if (completion?.pending || task.completed || !result?.accountId) return;
    if (completionPreventsRetry(taskCompletionFor(result.accountId, task.id))) return;
    const version = epoch.current;
    const account = result.accountId;
    setError("");
    setDetailError(undefined);
    const receipt = await completeTask(account, task.id, task.title);
    // A stale operation must not refresh or overwrite a newly selected list/account.
    if (
      alive.current &&
      epoch.current === version &&
      receipt.status === "completed"
    ) {
      setRefresh((n) => n + 1);
    }
  }
  const ownerName = (id: string) =>
    recipients.find((p) => p.id === id)?.name ??
    (id === result?.accountId ? "我" : "联系人名称未同步");
  const ownerIds = [...new Set((result?.items ?? []).flatMap(taskAssigneeIds))];
  if (
    owner !== "all" &&
    owner !== "__unassigned__" &&
    !ownerIds.includes(owner)
  )
    ownerIds.push(owner);
  const ownerOptions = [
    { value: "all", label: "全部负责人" },
    { value: "__unassigned__", label: "未分配负责人" },
    ...ownerIds.map((id, i) => ({
      value: id,
      label:
        ownerName(id) === "联系人名称未同步"
          ? `联系人名称未同步 ${i + 1}`
          : ownerName(id),
    })),
  ];
  const creatorIds = [
    ...new Set(
      (result?.items ?? [])
        .map((t) => t.creatorId)
        .filter((id): id is string => !!id),
    ),
  ];
  if (creator !== "all" && !creatorIds.includes(creator))
    creatorIds.push(creator);
  const creatorOptions = [
    { value: "all", label: "全部创建人" },
    ...creatorIds.map((id, i) => ({
      value: id,
      label:
        ownerName(id) === "联系人名称未同步"
          ? `联系人名称未同步 ${i + 1}`
          : ownerName(id),
    })),
  ];
  const rows = selectTasks(
    result?.items ?? [],
    {
      query,
      deadline,
      owner,
      sort,
      creator,
      start: startFilter,
      dueFrom,
      dueTo,
    },
    ownerName,
  );
  const filterCount =
    Number(deadline !== "all") +
    Number(owner !== "all") +
    Number(creator !== "all") +
    Number(startFilter !== "all") + Number(sort !== "original");
  const isFiltered = !!query.trim() || filterCount > 0 || status !== "all";
  const canReset = !!query.trim() || filterCount > 0;
  function resetFilters() {
    setQuery("");
    setDeadline("all");
    setOwner("all");
    setSort("original");
    setCreator("all");
    setStartFilter("all");
    setDueFrom("");
    setDueTo("");
  }
  return (
    <div className="feishu-workspace-detail feishu-task-workspace">
      <div className="feishu-detail-header">
        <div>
          <h2>
            我负责的任务{" "}
            {result && (
              <span className="feishu-task-count">
                已加载 {result.items.length} 项
              </span>
            )}
          </h2>
          <p>当前账号负责的任务 · 与飞书同步</p>
        </div>
      </div>
      <div className="feishu-task-query">
        <WorkspaceCreateAction kind="task" onCreated={()=>setRefresh(n=>n+1)} />
        <div className="feishu-list-toolbar">
          <Input
            aria-label="搜索当前已加载任务"
            placeholder="搜索已加载任务"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ToggleGroup aria-label="任务完成状态" value={[status]} onValueChange={values=>{
            if(["pending","completed","all"].includes(values[0]))setStatus(values[0]);
          }} variant="outline" size="sm">
            <ToggleGroupItem value="pending">未完成</ToggleGroupItem>
            <ToggleGroupItem value="completed">已完成</ToggleGroupItem>
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={filtersOpen}
            aria-controls={filterId}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal data-icon="inline-start" />
            筛选
            {filterCount > 0 && (
              <span className="feishu-filter-number">{filterCount}</span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            <RefreshCw data-icon="inline-start" />
            刷新
          </Button>
        </div>
        {filtersOpen && (
          <div className="feishu-task-filter-panel" id={filterId}>
            <FieldGroup>
              <WorkspaceSelect
                label="负责人"
                ariaLabel="负责人筛选"
                value={owner}
                onChange={setOwner}
                items={ownerOptions}
              />

              <WorkspaceSelect
                label="创建人"
                ariaLabel="创建人筛选"
                value={creator}
                onChange={setCreator}
                items={creatorOptions}
              />
              <WorkspaceSelect
                label="开始时间"
                ariaLabel="开始时间筛选"
                value={startFilter}
                onChange={(v) => setStartFilter(v as StartFilter)}
                items={[
                  { value: "all", label: "全部开始时间" },
                  { value: "started", label: "已到开始时间" },
                  { value: "future", label: "尚未开始" },
                  { value: "today", label: "今天开始" },
                  { value: "undated", label: "未设置开始时间" },
                ]}
              />
              <WorkspaceSelect
                label="截止时间"
                ariaLabel="截止时间筛选"
                value={deadline}
                onChange={(v) => setDeadline(v as DeadlineFilter)}
                items={deadlineOptions}
              />
              <WorkspaceSelect
                label="排序"
                ariaLabel="任务排序"
                value={sort}
                onChange={(v) => setSort(v as TaskSort)}
                items={[
                  { value: "original", label: "飞书原始顺序" },
                  { value: "dueAsc", label: "截止时间由近到远" },
                  { value: "dueDesc", label: "截止时间由远到近" },
                  { value: "title", label: "任务标题" },
                  { value: "createdDesc", label: "最近创建优先" },
                  { value: "updatedDesc", label: "最近更新优先" },
                ]}
              />
            </FieldGroup>
            {deadline === "custom" && (
              <div className="feishu-custom-date-range">
                <Field>
                  <FieldLabel htmlFor={`${filterId}-from`}>
                    截止日期起
                  </FieldLabel>
                  <Input
                    id={`${filterId}-from`}
                    type="date"
                    value={dueFrom}
                    onChange={(e) => setDueFrom(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${filterId}-to`}>
                    截止日期止（含当日）
                  </FieldLabel>
                  <Input
                    id={`${filterId}-to`}
                    type="date"
                    value={dueTo}
                    onChange={(e) => setDueTo(e.target.value)}
                  />
                </Field>
                {dueFrom && dueTo && dueFrom > dueTo ? (
                  <p role="alert">起始日期不能晚于结束日期。</p>
                ) : !dueFrom && !dueTo ? (
                  <p>请选择至少一个截止日期。</p>
                ) : null}
              </div>
            )}
          </div>
        )}
        {canReset && (
          <div className="feishu-active-filters">
            {creator !== "all" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCreator("all")}
              >
                创建人：{ownerName(creator)}
                <X data-icon="inline-end" />
              </Button>
            )}
            {startFilter !== "all" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setStartFilter("all")}
              >
                开始时间：
                {
                  {
                    started: "已到开始时间",
                    future: "尚未开始",
                    today: "今天开始",
                    undated: "未设置",
                  }[startFilter]
                }
                <X data-icon="inline-end" />
              </Button>
            )}

            {deadline !== "all" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeadline("all")}
              >
                {
                  deadlineOptions.find((option) => option.value === deadline)
                    ?.label
                }
                <X data-icon="inline-end" />
              </Button>
            )}
            {owner !== "all" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setOwner("all")}
              >
                {owner === "__unassigned__" ? "未分配负责人" : ownerName(owner)}
                <X data-icon="inline-end" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              清除筛选
            </Button>
          </div>
        )}
      </div>
      {result && (
        <p className="feishu-query-results" role="status">
          显示 {rows.length} 项 · 已加载 {result.items.length} 项
          {result.hasMore ? "，可继续加载更多" : ""}
        </p>
      )}
      {loading && <p role="status">正在读取飞书任务…</p>}
      {error && <p role="alert">{error}</p>}
      {completion && completion.taskId !== selectedTask?.id && (
        <div className="feishu-completion-receipt">
          <span>{completion.title}</span>
          <div
            role={
              completion.pending || completion.status === "completed"
                ? "status"
                : "alert"
            }
          >
            <p>{completion.message}</p>
          </div>
          {!completion.pending && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭完成回执"
              onClick={() => dismissTaskCompletion(completion.accountId)}
            >
              <X />
            </Button>
          )}
        </div>
      )}
      {result && (
        <>
          <Table>
            <caption className="sr-only">飞书任务列表</caption>
            <TableHeader>
              <TableRow>
                <TableHead>状态</TableHead>
                <TableHead>任务标题</TableHead>
                <TableHead>负责人</TableHead>
                <TableHead>截止时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const due = Number.isFinite(Number(t.dueTimestamp))
                    ? Number(t.dueTimestamp)
                    : 0;
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Checkbox
                        aria-label={`完成任务：${t.title}`}
                        checked={t.completed}
                        disabled={!!pending || t.completed || completionPreventsRetry(taskCompletionFor(result.accountId,t.id))}
                        onCheckedChange={(value) => {
                          if (value) void finish(t);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {t.title.length > 56 ? (
                        <Button
                          variant="ghost"
                          className="feishu-task-title-toggle"
                          aria-expanded={expanded.has(t.id)}
                          aria-label={`${expanded.has(t.id) ? "收起" : "展开"}任务标题：${t.title}`}
                          onClick={() =>
                            setExpanded((current) => {
                              const next = new Set(current);
                              if (next.has(t.id)) next.delete(t.id);
                              else next.add(t.id);
                              return next;
                            })
                          }
                        >
                          <strong
                            className={`${t.completed ? "feishu-completed" : ""} ${expanded.has(t.id) ? "" : "feishu-task-title-clamped"}`}
                          >
                            {t.title}
                          </strong>
                          <ChevronDown aria-hidden="true" />
                        </Button>
                      ) : (
                        <strong
                          className={t.completed ? "feishu-completed" : ""}
                        >
                          {t.title || "未命名任务"}
                        </strong>
                      )}
                      {t.description && (
                        <details>
                          <summary>任务说明</summary>
                          <p>{t.description}</p>
                        </details>
                      )}
                    </TableCell>
                    <TableCell>
                      <FeishuTaskAssignees
                        ids={taskAssigneeIds(t)}
                        name={ownerName}
                      />
                    </TableCell>
                    <TableCell
                      className={
                        isTaskOverdue(t) ? "feishu-task-overdue" : undefined
                      }
                    >
                      {isTaskOverdue(t) && (
                        <span className="feishu-deadline-label">已逾期</span>
                      )}
                      {due > 0
                        ? new Date(due).toLocaleString("zh-CN", {
                            timeZone: "Asia/Shanghai",
                            year:
                              new Date(due).getFullYear() !==
                              new Date().getFullYear()
                                ? "numeric"
                                : undefined,
                            month: "numeric",
                            day: "numeric",
                            hour: t.dueIsAllDay ? undefined : "2-digit",
                            minute: t.dueIsAllDay ? undefined : "2-digit",
                          })
                        : "未设置"}
                    </TableCell>
                    <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedTask(t)}
                        >
                          详情
                        </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!rows.length && !loading && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {isFiltered && result.items.length > 0
                    ? "没有匹配的已加载任务"
                    : "当前范围暂无任务"}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          {result.hasMore && (
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void more()}
            >
              加载更多
            </Button>
          )}
        </>
      )}
      <p className="feishu-workspace-boundary">
        列表显示当前账号负责的任务，搜索仅覆盖已加载内容。新建任务请使用右上角语音指令。
      </p>
      <WorkspaceHistory replies={replies} kind="feishuTask" />
      <Sheet open={selectedTask!==null} onOpenChange={open=>{if(!open)setSelectedTask(null);}}>
        <SheetContent className="feishu-calendar-detail-sheet">
          <SheetHeader><SheetTitle>任务详情</SheetTitle><SheetDescription>来自飞书任务</SheetDescription></SheetHeader>
          {selectedTask&&result&&<div className="feishu-calendar-detail-body">
            <h3>{selectedTask.title||"未命名任务"}</h3>
            <p>{selectedTask.description||"未填写任务说明"}</p>
            <p>负责人：{taskAssigneeIds(selectedTask).map(ownerName).join("、")||"未分配"}</p>
            <p>状态：{selectedTask.completed?"已完成":"未完成"}</p>
            <p>截止时间：{Number(selectedTask.dueTimestamp)>0?new Date(Number(selectedTask.dueTimestamp)).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",...(selectedTask.dueIsAllDay?{year:"numeric",month:"numeric",day:"numeric"} as const:{})}):"未设置"}</p>
            {selectedCompletion?.taskId===selectedTask.id&&<div className={`feishu-task-detail-receipt flex-col ${selectedCompletion.pending||selectedCompletion.status==="completed"?"":"text-destructive"}`} role={selectedCompletion.pending||selectedCompletion.status==="completed"?"status":"alert"}>
              <p>{selectedCompletion.message}</p>
              {completionPreventsRetry(selectedCompletion)&&selectedCompletion.status!=="completed"&&<p className="text-sm text-muted-foreground">本次操作不会再次提交，请在飞书核对后刷新列表。</p>}
            </div>}
            {detailError?.taskId===selectedTask.id&&detailError.accountId===result.accountId&&<p role="alert">{detailError.message}</p>}
            {!selectedTask.completed&&<Button variant="outline" disabled={!!pending||completionPreventsRetry(selectedCompletion)} onClick={()=>void finish(selectedTask)}>完成任务</Button>}
            {feishuDetailUrl(selectedTask.url)&&<Button variant="outline" onClick={()=>{
              setDetailError(undefined);
              void openFeishuUrl(feishuDetailUrl(selectedTask.url)!).catch(()=>setDetailError({taskId:selectedTask.id,accountId:result.accountId,message:"无法打开飞书任务。"}));
            }}><ExternalLink data-icon="inline-start"/>来源：飞书任务</Button>}
            <p className="text-sm text-muted-foreground">插件暂不提供任务编辑和删除，请在飞书中操作。</p>
          </div>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
