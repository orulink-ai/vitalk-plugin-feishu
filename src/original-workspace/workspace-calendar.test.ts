import { expect, it } from "vitest";
import {
  calendarRange,
  shiftDate,
  shiftMonth,
  calendarDays,
  eventSegments,
} from "./workspace-calendar";
it("uses Shanghai midnight and Monday weeks across year and leap-month boundaries", () => {
  const week = calendarRange("2026-10-20", "week");
  expect(week.startDate).toBe("2026-10-19");
  expect(week.end - week.start).toBe(7 * 86400);
  expect(
    calendarRange("2024-02-29", "month").end -
      calendarRange("2024-02-29", "month").start,
  ).toBe(29 * 86400);
  expect(shiftMonth("2024-01-31", 1)).toBe("2024-02-29");
  expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  expect(calendarDays("2026-10-20", "month")).toHaveLength(42);
});
it("clips cross-midnight meetings, includes all-day dates and separates overlapping blocks", () => {
  const make = (id: string, start: string, end: string) => ({
    id,
    title: id,
    start: { timestamp: String(Date.parse(start) / 1000) },
    end: { timestamp: String(Date.parse(end) / 1000) },
    url: "",
  });
  const items = [
    make("overnight", "2026-10-19T23:30:00+08:00", "2026-10-20T00:30:00+08:00"),
    make("a", "2026-10-20T15:00:00+08:00", "2026-10-20T16:00:00+08:00"),
    make("b", "2026-10-20T15:30:00+08:00", "2026-10-20T16:30:00+08:00"),
  ];
  const result = eventSegments(items, "2026-10-20");
  expect(result[0]).toMatchObject({ startMinute: 0, endMinute: 30 });
  expect(result.find((x) => x.item.id === "a")).toMatchObject({
    lane: 0,
    lanes: 2,
  });
  expect(result.find((x) => x.item.id === "b")).toMatchObject({
    lane: 1,
    lanes: 2,
  });
  expect(
    eventSegments(
      [
        {
          id: "all",
          title: "全天",
          url: "",
          start: { date: "2026-10-20" },
          end: { date: "2026-10-20" },
        },
      ],
      "2026-10-20",
    )[0].allDay,
  ).toBe(true);
  expect(
    eventSegments(
      [
        {
          id: "bad",
          title: "无效",
          url: "",
          start: { timestamp: "NaN" },
          end: {},
        },
      ],
      "2026-10-20",
    ),
  ).toEqual([]);
});

it("retains inclusive Feishu all-day ends and excludes timed events ending at midnight from the next day", () => {
  const all = {
    id: "all",
    title: "全天",
    url: "",
    start: { date: "2026-10-20" },
    end: { date: "2026-10-21" },
  };
  expect(eventSegments([all], "2026-10-20")).toHaveLength(1);
  expect(eventSegments([all], "2026-10-21")).toHaveLength(1);
  expect(eventSegments([all], "2026-10-22")).toHaveLength(0);
  const timed = {
    id: "midnight",
    title: "午夜结束",
    url: "",
    start: {
      timestamp: String(Date.parse("2026-10-20T23:30:00+08:00") / 1000),
    },
    end: { timestamp: String(Date.parse("2026-10-21T00:00:00+08:00") / 1000) },
  };
  expect(eventSegments([timed], "2026-10-21")).toHaveLength(0);
});
