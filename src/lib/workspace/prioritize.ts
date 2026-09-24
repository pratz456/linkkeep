import type {
  Horizon,
  Importance,
  ScheduleItem,
  WorkTask,
} from "@/lib/workspace/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function endOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function getHorizonEnd(horizon: Horizon, now: Date) {
  if (horizon === "today") return endOfDay(now);

  if (horizon === "week") {
    const end = endOfDay(now);
    const daysUntilSunday = (7 - end.getDay()) % 7;
    end.setDate(end.getDate() + daysUntilSunday);
    return end;
  }

  return new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
}

export function isTaskInHorizon(
  task: WorkTask,
  horizon: Horizon,
  now: Date,
) {
  if (task.status === "completed") return false;
  return new Date(task.dueAt).getTime() <= getHorizonEnd(horizon, now).getTime();
}

export function scoreTask(task: WorkTask, now: Date) {
  const dueTime = new Date(task.dueAt).getTime();
  const distanceInDays = (dueTime - now.getTime()) / DAY_MS;

  let score = task.importance === "major" ? 80 : 24;

  if (distanceInDays < 0) score += 64;
  else if (distanceInDays < 1) score += 42;
  else if (distanceInDays < 3) score += 26;
  else if (distanceInDays < 7) score += 14;

  score += Math.min(task.signals.length * 4, 12);
  if (task.estimateMinutes <= 30) score += 4;

  return score;
}

export function prioritizeTasks(
  tasks: WorkTask[],
  horizon: Horizon,
  now: Date,
) {
  return tasks
    .filter((task) => isTaskInHorizon(task, horizon, now))
    .sort((a, b) => {
      const scoreDifference = scoreTask(b, now) - scoreTask(a, now);
      if (scoreDifference !== 0) return scoreDifference;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
}

export function scheduleForHorizon(
  schedule: ScheduleItem[],
  horizon: Horizon,
  now: Date,
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = getHorizonEnd(horizon, now);

  return schedule
    .filter((item) => {
      const itemTime = new Date(item.startAt).getTime();
      return itemTime >= start.getTime() && itemTime <= end.getTime();
    })
    .sort(
      (a, b) =>
        new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
}

export function groupByImportance(tasks: WorkTask[]) {
  return tasks.reduce<Record<Importance, WorkTask[]>>(
    (groups, task) => {
      groups[task.importance].push(task);
      return groups;
    },
    { major: [], minor: [] },
  );
}

export function getCompletionStats(tasks: WorkTask[], horizon: Horizon, now: Date) {
  const horizonEnd = getHorizonEnd(horizon, now).getTime();
  const relevant = tasks.filter(
    (task) => new Date(task.dueAt).getTime() <= horizonEnd,
  );
  const completed = relevant.filter((task) => task.status === "completed").length;

  return {
    completed,
    total: relevant.length,
    percent: relevant.length ? Math.round((completed / relevant.length) * 100) : 0,
  };
}

export function formatHorizonRange(horizon: Horizon, now: Date) {
  if (horizon === "today") {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(now);
  }

  const end = getHorizonEnd(horizon, now);
  if (horizon === "week") {
    return `${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(now)} – ${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(end)}`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(now);
}
