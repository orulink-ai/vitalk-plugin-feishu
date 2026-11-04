import {
  midnight,
  monday,
  shanghaiDate,
  shiftDate,
  validDate,
} from "./workspace-calendar";
export type TaskFilterRow = {
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
};
type TaskDeadline = Pick<TaskFilterRow, "dueTimestamp" | "dueIsAllDay">;

/** Milliseconds: exact deadline for timed tasks, exclusive next Shanghai midnight
 * for all-day dates. Missing flags retain older native builds' timed behavior. */
export function taskDeadlineInstant(item: TaskDeadline): number | null {
  const due = Number(item.dueTimestamp);
  if (
    !Number.isFinite(due) ||
    due <= 0 ||
    !Number.isFinite(new Date(due).getTime())
  )
    return null;
  return item.dueIsAllDay
    ? midnight(shiftDate(shanghaiDate(due), 1)) * 1000
    : due;
}

export function isTaskOverdue(
  item: TaskDeadline & Pick<TaskFilterRow, "completed">,
  now = Date.now(),
): boolean {
  const deadline = taskDeadlineInstant(item);
  return (
    !item.completed &&
    deadline !== null &&
    (item.dueIsAllDay ? now >= deadline : now > deadline)
  );
}

// Older native builds return only ownerId; an explicit empty array means unassigned.
export function taskAssigneeIds(
  item: Pick<TaskFilterRow, "ownerId" | "ownerIds">,
): string[] {
  return [
    ...new Set(
      (item.ownerIds ?? [item.ownerId]).filter(
        (id) => typeof id === "string" && id.trim().length > 0,
      ),
    ),
  ];
}
export type DeadlineFilter =
  "all" | "overdue" | "today" | "week" | "next7" | "undated" | "custom";
export type StartFilter = "all" | "started" | "future" | "today" | "undated";
export type TaskSort =
  "original" | "dueAsc" | "dueDesc" | "title" | "createdDesc" | "updatedDesc";
export function selectTasks<T extends TaskFilterRow>(
  items: T[],
  filters: {
    query: string;
    deadline: DeadlineFilter;
    owner: string;
    sort: TaskSort;
    creator?: string;
    start?: StartFilter;
    dueFrom?: string;
    dueTo?: string;
  },
  ownerName: (id: string) => string,
  now = Date.now(),
): T[] {
  const today = shanghaiDate(now),
    start = midnight(today) * 1000,
    next = start + 86400000;
  const week = midnight(monday(today)) * 1000;
  const query = filters.query.trim().toLocaleLowerCase();
  const result = items.filter((item) => {
    const due = Number(item.dueTimestamp),
      dated = Number.isFinite(due) && due > 0;
    const owners = taskAssigneeIds(item);
    if (
      filters.owner === "__unassigned__"
        ? owners.length > 0
        : filters.owner !== "all" && !owners.includes(filters.owner)
    )
      return false;
    if (
      filters.creator &&
      filters.creator !== "all" &&
      item.creatorId !== filters.creator
    )
      return false;
    const begins = Number(item.startTimestamp),
      hasStart = Number.isFinite(begins) && begins > 0;
    switch (filters.start) {
      case "started":
        if (!hasStart || begins > now) return false;
        break;
      case "future":
        if (!hasStart || begins <= now) return false;
        break;
      case "today":
        if (!hasStart || begins < start || begins >= next) return false;
        break;
      case "undated":
        if (hasStart) return false;
        break;
    }
    if (
      query &&
      !`${item.title} ${item.description} ${owners.map(ownerName).join(" ")} ${item.creatorId ? ownerName(item.creatorId) : ""}`
        .toLocaleLowerCase()
        .includes(query)
    )
      return false;
    switch (filters.deadline) {
      case "overdue":
        return isTaskOverdue(item, now);
      case "today":
        return dated && due >= start && due < next;
      case "week":
        return dated && due >= week && due < week + 7 * 86400000;
      case "next7":
        return (
          dated && due >= start && due < midnight(shiftDate(today, 7)) * 1000
        );
      case "undated":
        return !dated;
      case "custom": {
        const from = filters.dueFrom,
          to = filters.dueTo;
        if (
          (!from && !to) ||
          (from && !validDate(from)) ||
          (to && !validDate(to)) ||
          (from && to && from > to)
        )
          return false;
        return (
          dated &&
          (!from || due >= midnight(from) * 1000) &&
          (!to || due < midnight(shiftDate(to, 1)) * 1000)
        );
      }
      default:
        return true;
    }
  });
  if (filters.sort === "title")
    result.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  if (filters.sort === "dueAsc" || filters.sort === "dueDesc")
    result.sort((a, b) => {
      const x = Number(a.dueTimestamp),
        y = Number(b.dueTimestamp);
      const validX = Number.isFinite(x) && x > 0,
        validY = Number.isFinite(y) && y > 0;
      if (!validX || !validY) return Number(validY) - Number(validX);
      return filters.sort === "dueAsc" ? x - y : y - x;
    });
  if (filters.sort === "createdDesc" || filters.sort === "updatedDesc") {
    const field = filters.sort === "createdDesc" ? "createdAt" : "updatedAt";
    result.sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0));
  }
  return result;
}
