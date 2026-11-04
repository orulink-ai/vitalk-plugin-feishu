import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import {
  calendarDays,
  eventSegmentLabel,
  eventSegments,
  shanghaiDate,
  type CalendarItem,
} from "./workspace-calendar";
const hourHeight = 48;
const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
function weekday(date: string) {
  return weekdays[(new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7];
}
export function CalendarTimeGrid({
  date,
  view,
  items,
  focusKey,
  onSelect,
  onDay,
}: {
  date: string;
  view: "day" | "week";
  items: CalendarItem[];
  focusKey: number;
  onSelect: (item: CalendarItem) => void;
  onDay: (date: string) => void;
}) {
  const days = calendarDays(date, view);
  const scroll = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const today = shanghaiDate(now);
  useEffect(() => {
    if (!scroll.current) return;
    const current = new Date().toLocaleTimeString("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      hour12: false,
    });
    const visible = calendarDays(date, view).includes(shanghaiDate());
    scroll.current.scrollTop =
      (visible ? Math.max(0, Number(current) - 2) : 8) * hourHeight;
  }, [date, view, focusKey]);
  const currentMinute =
    (now / 1000 - Date.parse(today + "T00:00:00+08:00") / 1000) / 60;
  return (
    <section
      className="feishu-time-calendar"
      role="region"
      aria-label={view === "week" ? "周日历" : "日历日视图"}
      style={{ "--calendar-columns": days.length } as CSSProperties}
    >
      <div
        className="feishu-time-scroll"
        ref={scroll}
        tabIndex={0}
        aria-label="日历时间轴，可滚动查看全天时段"
      >
        <div className="feishu-time-inner">
          <div className="feishu-calendar-day-headings">
            <span className="feishu-calendar-zone">GMT+8</span>
            {days.map((day) => (
              <div key={day} data-today={day === today}>
                <span>{weekday(day)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`查看${day}日程`}
                  onClick={() => onDay(day)}
                >
                  <strong>{Number(day.slice(-2))}</strong>
                </Button>
              </div>
            ))}
          </div>
          <div className="feishu-calendar-all-day">
            <span>全天</span>
            {days.map((day) => (
              <div key={day}>
                {eventSegments(items, day)
                  .filter((s) => s.allDay)
                  .map((s) => (
                    <Button
                      variant="secondary"
                      size="sm"
                      key={s.item.id}
                      onClick={() => onSelect(s.item)}
                      aria-label={`${s.item.title} 全天`}
                    >
                      {s.item.title || "未命名日程"}
                    </Button>
                  ))}
              </div>
            ))}
          </div>
          <div className="feishu-calendar-time-body">
            <div className="feishu-calendar-hour-axis">
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={hour}>{String(hour).padStart(2, "0")}:00</span>
              ))}
            </div>
            {days.map((day) => (
              <div
                className="feishu-calendar-time-column"
                key={day}
                data-today={day === today}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <div className="feishu-calendar-hour-line" key={hour} />
                ))}
                {eventSegments(items, day)
                  .filter((s) => !s.allDay)
                  .map((s) => (
                    <Button
                      variant="secondary"
                      className="feishu-calendar-event"
                      key={s.item.id}
                      aria-label={`${s.item.title || "未命名日程"} ${eventSegmentLabel(s)}`}
                      onClick={() => onSelect(s.item)}
                      style={{
                        top: (s.startMinute / 60) * hourHeight,
                        height: Math.max(
                          16,
                          ((s.endMinute - s.startMinute) / 60) * hourHeight,
                        ),
                        left: `calc(${(s.lane / s.lanes) * 100}% + 3px)`,
                        width: `calc(${100 / s.lanes}% - 6px)`,
                      }}
                    >
                      <strong>{s.item.title || "未命名日程"}</strong>
                      <span>{eventSegmentLabel(s)}</span>
                    </Button>
                  ))}
                {day === today && (
                  <div
                    className="feishu-calendar-now"
                    style={{ top: (currentMinute / 60) * hourHeight }}
                    aria-label="当前时间"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
export function CalendarMonth({
  date,
  items,
  onDay,
  onSelect,
}: {
  date: string;
  items: CalendarItem[];
  onDay: (date: string) => void;
  onSelect: (item: CalendarItem) => void;
}) {
  const days = calendarDays(date, "month"),
    today = shanghaiDate();
  return (
    <section
      className="feishu-month-calendar"
      role="region"
      aria-label="月日历"
    >
      <table>
        <thead>
          <tr>
            {weekdays.map((day) => (
              <th scope="col" key={day}>
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, week) => (
            <tr key={week}>
              {days.slice(week * 7, week * 7 + 7).map((day) => {
                // The workspace queries the selected month only. Adjacent cells
                // remain navigation targets, never claims about unloaded data.
                const outside = day.slice(0, 7) !== date.slice(0, 7);
                const rows = outside ? [] : eventSegments(items, day);
                return (
                  <td
                    key={day}
                    data-outside={outside}
                    data-today={day === today}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="feishu-month-day"
                      aria-label={
                        outside
                          ? `${day}，未加载，点击查看`
                          : `${day}，${rows.length}项日程`
                      }
                      onClick={() => onDay(day)}
                    >
                      {Number(day.slice(-2))}
                    </Button>
                    <div className="feishu-month-events">
                      {rows.slice(0, 3).map((row) => (
                        <Button
                          key={row.item.id}
                          variant="ghost"
                          size="sm"
                          onClick={() => onSelect(row.item)}
                          title={row.item.title}
                        >
                          <span>{eventSegmentLabel(row)}</span>
                          <strong>{row.item.title || "未命名日程"}</strong>
                        </Button>
                      ))}
                      {rows.length > 3 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDay(day)}
                        >
                          还有{rows.length - 3}项
                        </Button>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
