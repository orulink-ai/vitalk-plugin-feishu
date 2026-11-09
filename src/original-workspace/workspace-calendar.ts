/** Calendar dates are civil dates in Asia/Shanghai, never the host's timezone. */
export type CalendarView = "day" | "week" | "month" | "list";
export type EventTime = {
  timestamp?: string;
  date?: string;
  timezone?: string;
};
export type CalendarItem = {
  id: string;
  title: string;
  description?: string;
  editable?: boolean;
  start: EventTime;
  end: EventTime;
  url: string;
};
export const calendarZone = "Asia/Shanghai";
export function shanghaiDate(ms = Date.now()) {
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: calendarZone });
}
export function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = Date.parse(date + "T12:00:00Z");
  return (
    Number.isFinite(value) &&
    new Date(value).toISOString().slice(0, 10) === date
  );
}
export function midnight(date: string) {
  return Date.parse(date + "T00:00:00+08:00") / 1000;
}
export function shiftDate(date: string, days: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function shiftMonth(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate();
  start.setUTCDate(Math.min(day, last));
  return start.toISOString().slice(0, 10);
}
export function monday(date: string) {
  const day = new Date(date + "T12:00:00Z").getUTCDay();
  return shiftDate(date, -((day + 6) % 7));
}
export function calendarRange(date: string, view: CalendarView) {
  const startDate =
    view === "month"
      ? date.slice(0, 7) + "-01"
      : view === "week"
        ? monday(date)
        : date;
  const endDate =
    view === "month"
      ? shiftMonth(startDate, 1)
      : shiftDate(startDate, view === "week" ? 7 : 1);
  return {
    startDate,
    endDate,
    start: midnight(startDate),
    end: midnight(endDate),
  };
}
export function calendarDays(date: string, view: CalendarView): string[] {
  const range = calendarRange(date, view);
  const first = view === "month" ? monday(range.startDate) : range.startDate;
  return Array.from(
    { length: view === "month" ? 42 : view === "week" ? 7 : 1 },
    (_, i) => shiftDate(first, i),
  );
}
export function eventBounds(item: CalendarItem) {
  const allDay = !!item.start.date;
  if (
    allDay &&
    (!validDate(item.start.date!) ||
      !item.end.date ||
      !validDate(item.end.date))
  )
    return null;
  const start = allDay
    ? midnight(item.start.date!)
    : Number(item.start.timestamp);
  // Feishu all-day end dates are inclusive. Use an exclusive instant internally.
  const end =
    allDay && item.end.date
      ? midnight(shiftDate(item.end.date, 1))
      : Number(item.end.timestamp);
  return Number.isFinite(start) &&
    start > 0 &&
    Number.isFinite(end) &&
    end > start
    ? { start, end, allDay }
    : null;
}
export type EventSegment = {
  item: CalendarItem;
  allDay: boolean;
  startMinute: number;
  endMinute: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  lane: number;
  lanes: number;
};
export function eventSegments(
  items: CalendarItem[],
  date: string,
): EventSegment[] {
  const start = midnight(date),
    end = start + 86400;
  const segments: EventSegment[] = [];
  for (const item of items) {
    const bounds = eventBounds(item);
    if (!bounds || bounds.end <= start || bounds.start >= end) continue;
    segments.push({
      item,
      allDay: bounds.allDay,
      startMinute: Math.max(0, (bounds.start - start) / 60),
      endMinute: Math.min(1440, (bounds.end - start) / 60),
      continuesBefore: bounds.start < start,
      continuesAfter: bounds.end > end,
      lane: 0,
      lanes: 1,
    });
  }
  const timed = segments
    .filter((s) => !s.allDay)
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
  let group: EventSegment[] = [],
    ends: number[] = [],
    groupEnd = 0;
  const finish = () => {
    for (const s of group) s.lanes = ends.length;
  };
  for (const segment of timed) {
    if (segment.startMinute >= groupEnd) {
      finish();
      group = [];
      ends = [];
    }
    let lane = ends.findIndex((end) => end <= segment.startMinute);
    if (lane < 0) lane = ends.length;
    const visualEnd = Math.max(segment.endMinute, segment.startMinute + 20);
    ends[lane] = visualEnd;
    groupEnd = Math.max(...ends);
    segment.lane = lane;
    group.push(segment);
  }
  finish();
  return [...segments.filter((s) => s.allDay), ...timed];
}
export function clockTime(time: EventTime) {
  if (time.date) return time.date;
  const value = Number(time.timestamp);
  return value > 0 && Number.isFinite(value)
    ? new Date(value * 1000).toLocaleTimeString("zh-CN", {
        timeZone: calendarZone,
        hour: "2-digit",
        minute: "2-digit",
      })
    : "时间待核对";
}

/** Label the visible day's segment; 1440 is 24:00, not next day's 00:00. */
export function eventSegmentLabel(segment: EventSegment): string {
  if (segment.allDay) return "全天";
  const time = (minute: number) => {
    const total = Math.floor(minute);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  const continuation = [
    ...(segment.continuesBefore ? ["此前开始"] : []),
    ...(segment.continuesAfter ? ["延续至次日"] : []),
  ];
  return `${time(segment.startMinute)}–${time(segment.endMinute)}${continuation.length ? `（跨天：${continuation.join("，")}）` : ""}`;
}
