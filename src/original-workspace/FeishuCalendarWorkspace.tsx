import { useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { openFeishuUrl } from "../client";
import { experimentsRequest, type AiReply } from "../experiments/client";
import { WorkspaceHistory } from "./workspace-controls";
import { CalendarMonth, CalendarTimeGrid } from "./FeishuCalendarViews";
import {
  shanghaiDate,
  shiftDate,
  shiftMonth,
  validDate,
  calendarRange,
  eventBounds,
  clockTime,
  type CalendarView,
  type CalendarItem,
} from "./workspace-calendar";
import { feishuDetailUrl } from "./workspace-receipts";
import { WorkspaceCreateAction } from "./WorkspaceCreateAction";
export function FeishuCalendarWorkspace({ replies }: { replies: AiReply[] }) {
  const [date, setDate] = useState(shanghaiDate),
    [view, setView] = useState<CalendarView>("week");
  const [items, setItems] = useState<CalendarItem[]>(),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<CalendarItem | null>(null),
    [focusKey, setFocusKey] = useState(0);
  const epoch = useRef(0);
  const range = validDate(date) ? calendarRange(date, view) : undefined;
  const start = range?.start,
    end = range?.end;
  useEffect(() => {
    const version = ++epoch.current;
    let active = true;
    setItems(undefined);
    setError("");
    setSelected(null);
    if (!start || !end) {
      setLoading(false);
      setError("请选择有效日期。");
      return;
    }
    setLoading(true);
    void experimentsRequest<{ items: CalendarItem[] }>({
      action: "feishuCalendarList",
      start,
      end,
    })
      .then((result) => {
        if (!active || version !== epoch.current) return;
        if (!Array.isArray(result.items))
          throw Error("日程列表格式无效，请刷新。");
        setItems(
          result.items
            .slice()
            .sort(
              (a, b) =>
                (eventBounds(a)?.start ?? 0) - (eventBounds(b)?.start ?? 0),
            ),
        );
      })
      .catch((reason) => {
        if (active && version === epoch.current)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active && version === epoch.current) setLoading(false);
      });
    return () => {
      active = false;
      epoch.current++;
    };
  }, [start, end, refresh]);
  function shift(direction: number) {
    const current = validDate(date) ? date : shanghaiDate();
    setDate(
      view === "month"
        ? shiftMonth(current, direction)
        : shiftDate(current, direction * (view === "week" ? 7 : 1)),
    );
  }
  function openDay(day: string) {
    setDate(day);
    setView("day");
  }
  const selectedReceipt =
    selected &&
    replies.find((r) => r.command?.meeting?.eventId === selected.id)?.command
      ?.meeting;
  const selectedUrl = selected && feishuDetailUrl(selected.url);
  const selectedBounds = selected && eventBounds(selected);
  const selectedStartDate =
    selected?.start.date ??
    (selectedBounds ? shanghaiDate(selectedBounds.start * 1000) : "日期待核对");
  const selectedEndDate =
    selected?.end.date ??
    (selectedBounds ? shanghaiDate(selectedBounds.end * 1000) : "日期待核对");
  const invalidCount = (items ?? []).filter(
    (item) => !eventBounds(item),
  ).length;
  const period = range
    ? view === "month"
      ? `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月`
      : view === "week"
        ? `${range.startDate.replaceAll("-", "/")} – ${shiftDate(range.endDate, -1).slice(5).replaceAll("-", "/")}`
        : date.replaceAll("-", "/")
    : "请选择日期";
  return (
    <div className="feishu-workspace-detail feishu-calendar-workspace" data-time-view={view==="day"||view==="week"}>
      <div className="feishu-detail-header">
        <div>
          <h2>
            日程与会议{" "}
            {items && (
              <span className="feishu-task-count">{items.length} 项日程</span>
            )}
          </h2>
          <p>主日历 · 北京时间（UTC+8）</p>
        </div>
      <WorkspaceCreateAction kind="calendar" onCreated={outcome=>{
        if(outcome.kind==="calendar"){
          const day=outcome.plan.start?.slice(0,10);
          if(day&&validDate(day))setDate(day);
        }
        setRefresh(n=>n+1);
        setFocusKey(n=>n+1);
      }} />
      </div>
      <div className="feishu-calendar-toolbar" role="group" aria-label="日程导航与视图">
        <div className="feishu-date-navigation">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDate(shanghaiDate());
              setFocusKey((n) => n + 1);
            }}
          >
            今天
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              view === "week"
                ? "上一周"
                : view === "month"
                  ? "上一月"
                  : "上一天"
            }
            onClick={() => shift(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              view === "week"
                ? "下一周"
                : view === "month"
                  ? "下一月"
                  : "下一天"
            }
            onClick={() => shift(1)}
          >
            <ChevronRight />
          </Button>
          <strong className="feishu-calendar-period">{period}</strong>
          <Input
            type="date"
            aria-label="查看日期"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="feishu-calendar-view-actions">
          <ToggleGroup
            aria-label="日历视图"
            value={[view]}
            onValueChange={(values) => {
              const next = values[0];
              if (["day", "week", "month", "list"].includes(next))
                setView(next as CalendarView);
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="day">日</ToggleGroupItem>
            <ToggleGroupItem value="week">周</ToggleGroupItem>
            <ToggleGroupItem value="month">月</ToggleGroupItem>
            <ToggleGroupItem value="list">列表</ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="刷新日程"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>
      {loading && (
        <p role="status" className="feishu-calendar-fetch-state">
          正在读取飞书日程…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {range && view !== "list" && (
        <div className="feishu-calendar-surface" aria-busy={loading}>
          {view === "month" ? (
            <CalendarMonth
              date={date}
              items={items ?? []}
              onSelect={setSelected}
              onDay={openDay}
            />
          ) : (
            <CalendarTimeGrid
              date={date}
              view={view}
              items={items ?? []}
              focusKey={focusKey}
              onSelect={setSelected}
              onDay={openDay}
            />
          )}
          {items?.length === 0 && (
            <p className="feishu-calendar-empty-hint">
              {view === "month"
                ? "本月暂无日程"
                : view === "week"
                  ? "本周暂无日程"
                  : "当天暂无日程"}{" "}
              · 可使用右上角语音指令预约会议
            </p>
          )}
        </div>
      )}
      {view === "list" &&
        items &&
        (items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>当天暂无日程</EmptyTitle>
            </EmptyHeader>
            <p>可以使用语音指令预约会议。</p>
          </Empty>
        ) : (
          <div className="feishu-agenda-list">
            {items.map((item) => {
              const receipt = replies.find(
                (r) => r.command?.meeting?.eventId === item.id,
              )?.command?.meeting;
              return (
                <article key={item.id}>
                  <div className="feishu-agenda-time">
                    <strong>{clockTime(item.start)}</strong>
                    <span>{clockTime(item.end)}</span>
                  </div>
                  <div>
                    <h3>{item.title || "未命名日程"}</h3>
                    {receipt ? (
                      <>
                        <p>参与人：{receipt.participants.join("、")}</p>
                        <p>{receipt.invitation}</p>
                      </>
                    ) : (
                      <p>参与人和邀请状态请在飞书详情查看。</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected(item)}
                  >
                    查看详情
                  </Button>
                </article>
              );
            })}
          </div>
        ))}
      {view !== "list" && invalidCount > 0 && (
        <p role="status">
          有 {invalidCount} 项日程时间待核对，
          <Button variant="link" size="sm" onClick={() => setView("list")}>
            切换列表查看
          </Button>
          。
        </p>
      )}
      <WorkspaceHistory replies={replies} kind="feishuMeeting" />
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          className="feishu-calendar-detail-sheet"
          showCloseButton={false}
        >
          <SheetClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="feishu-calendar-detail-close"
                aria-label="关闭详情"
              />
            }
          >
            <X />
          </SheetClose>
          <SheetHeader>
            <SheetTitle>日程详情</SheetTitle>
            <SheetDescription>来自飞书主日历</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="feishu-calendar-detail-body">
              <h3>{selected.title || "未命名日程"}</h3>
              <div>
                <CalendarDays aria-hidden="true" />
                <p>
                  {selectedStartDate === selectedEndDate
                    ? selectedStartDate
                    : `${selectedStartDate} – ${selectedEndDate}`}
                </p>
              </div>
              <div>
                <Clock aria-hidden="true" />
                <p>
                  {selected.start.date
                    ? "全天"
                    : `${clockTime(selected.start)} – ${clockTime(selected.end)}`}
                  <small>北京时间 · Asia/Shanghai</small>
                </p>
              </div>
              <div>
                <Users aria-hidden="true" />
                <p>
                  {selectedReceipt
                    ? `参与人：${selectedReceipt.participants.join("、")}`
                    : "参与人和邀请状态请在飞书详情查看。"}
                  {selectedReceipt && (
                    <small>{selectedReceipt.invitation}</small>
                  )}
                </p>
              </div>
              {selectedUrl && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void openFeishuUrl(selectedUrl)
                      .catch(() => setError("无法打开飞书日程。"))
                  }
                >
                  <ExternalLink data-icon="inline-start" />
                  来源：飞书日程
                </Button>
              )}
              <p className="text-sm text-muted-foreground">插件暂不提供日程删除，请在飞书中操作。</p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
