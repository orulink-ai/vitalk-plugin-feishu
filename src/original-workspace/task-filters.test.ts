import { expect, it } from "vitest";
import {
  selectTasks,
  isTaskOverdue,
  taskDeadlineInstant,
  type DeadlineFilter,
} from "./task-filters";
const make = (id: string, date: string, completed = false) => ({
  id,
  title: id,
  description: "",
  ownerId: "a",
  completed,
  dueTimestamp: date ? String(Date.parse(date)) : "",
});
const items = [
  make("lastWeek", "2026-10-18T23:59:59+08:00"),
  make("todayEarly", "2026-10-20T00:00:00+08:00"),
  make("todayEnd", "2026-10-20T23:59:59+08:00"),
  make("tomorrow", "2026-10-21T00:00:00+08:00"),
  make("nextMonday", "2026-10-26T00:00:00+08:00"),
  make("noDate", ""),
  make("done", "2026-10-19T10:00:00+08:00", true),
];
const now = Date.parse("2026-10-20T16:00:00+08:00");
it.each<[DeadlineFilter, string[]]>([
  ["today", ["todayEarly", "todayEnd"]],
  ["overdue", ["lastWeek", "todayEarly"]],
  ["week", ["todayEarly", "todayEnd", "tomorrow", "done"]],
  ["undated", ["noDate"]],
])("filters %s using Shanghai boundaries", (deadline, expected) => {
  expect(
    selectTasks(
      items,
      { query: "", deadline, owner: "all", sort: "original" },
      () => "负责人",
      now,
    ).map((r) => r.id),
  ).toEqual(expected);
});
it("normalizes search and sorts a copy with unknown deadlines always last", () => {
  const original = items.map((r) => r.id);
  expect(
    selectTasks(
      items,
      { query: "  负责人  ", deadline: "all", owner: "a", sort: "dueDesc" },
      () => "负责人",
      now,
    ).at(-1)?.id,
  ).toBe("noDate");
  expect(items.map((r) => r.id)).toEqual(original);
});

it("matches every assignee and respects an explicitly unassigned task", () => {
  const shared = { ...make("shared", ""), ownerIds: ["a", "b", "a"] };
  const unassigned = { ...make("unassigned", ""), ownerIds: [] };
  const names = (id: string) => (id === "b" ? "第二负责人" : "第一负责人");
  expect(
    selectTasks(
      [shared, unassigned],
      { query: "", deadline: "all", owner: "b", sort: "original" },
      names,
      now,
    ).map((r) => r.id),
  ).toEqual(["shared"]);
  expect(
    selectTasks(
      [shared, unassigned],
      { query: "第二负责人", deadline: "all", owner: "all", sort: "original" },
      names,
      now,
    ).map((r) => r.id),
  ).toEqual(["shared"]);
  expect(
    selectTasks(
      [unassigned],
      { query: "", deadline: "all", owner: "a", sort: "original" },
      names,
      now,
    ),
  ).toEqual([]);
});

it("combines creator, start and an inclusive custom deadline range", () => {
  const rows = [
    {
      ...make("matching", "2026-10-23T23:59:59+08:00"),
      creatorId: "creator",
      startTimestamp: String(Date.parse("2026-10-20T09:00:00+08:00")),
      createdAt: "2",
      updatedAt: "4",
    },
    {
      ...make("outside", "2026-10-24T00:00:00+08:00"),
      creatorId: "creator",
      startTimestamp: "",
      createdAt: "3",
      updatedAt: "1",
    },
  ];
  expect(
    selectTasks(
      rows,
      {
        query: "",
        owner: "all",
        creator: "creator",
        start: "started",
        deadline: "custom",
        dueFrom: "2026-10-23",
        dueTo: "2026-10-23",
        sort: "updatedDesc",
      },
      () => "成员",
      now,
    ).map((r) => r.id),
  ).toEqual(["matching"]);
  expect(
    selectTasks(
      rows,
      {
        query: "",
        owner: "all",
        deadline: "all",
        start: "undated",
        sort: "createdDesc",
      },
      () => "成员",
      now,
    ).map((r) => r.id),
  ).toEqual(["outside"]);
});

it("keeps all-day deadlines current until the following Shanghai midnight", () => {
  const task = {
    ...make("allDay", "2026-10-20T00:00:00+08:00"),
    dueIsAllDay: true,
  };
  const filters = {
    query: "",
    deadline: "overdue" as const,
    owner: "all",
    sort: "original" as const,
  };
  for (const time of [
    "2026-10-20T00:00:00+08:00",
    "2026-10-20T12:00:00+08:00",
    "2026-10-20T23:59:59.999+08:00",
  ]) {
    expect(selectTasks([task], filters, () => "", Date.parse(time))).toEqual(
      [],
    );
  }
  expect(
    selectTasks(
      [task],
      filters,
      () => "",
      Date.parse("2026-10-21T00:00:00+08:00"),
    ),
  ).toEqual([task]);
  expect(
    selectTasks([task], { ...filters, deadline: "today" }, () => "", now),
  ).toEqual([task]);
});

it("exports one deadline boundary and overdue policy for task list consumers", () => {
  const task = {
    ...make("allDay", "2026-10-20T08:00:00+08:00"),
    dueIsAllDay: true,
  };
  expect(taskDeadlineInstant(task)).toBe(
    Date.parse("2026-10-21T00:00:00+08:00"),
  );
  expect(isTaskOverdue(task, now)).toBe(false);
  expect(isTaskOverdue(task, Date.parse("2026-10-21T00:00:00+08:00"))).toBe(
    true,
  );
  expect(
    isTaskOverdue(
      { ...task, completed: true },
      Date.parse("2026-10-22T00:00:00+08:00"),
    ),
  ).toBe(false);
  const timed = make("timed", "2026-10-20T10:00:00+08:00");
  expect(taskDeadlineInstant(timed)).toBe(Number(timed.dueTimestamp));
  expect(isTaskOverdue(timed, Number(timed.dueTimestamp))).toBe(false);
  expect(isTaskOverdue(timed, Number(timed.dueTimestamp) + 1)).toBe(true);
  for (const dueTimestamp of ["", "NaN", "0", "-1"]) {
    expect(taskDeadlineInstant({ ...task, dueTimestamp })).toBeNull();
    expect(isTaskOverdue({ ...task, dueTimestamp }, now)).toBe(false);
  }
});
