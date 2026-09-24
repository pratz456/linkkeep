import { describe, expect, it } from "vitest";
import {
  getCompletionStats,
  prioritizeTasks,
  scoreTask,
} from "@/lib/workspace/prioritize";
import type { Importance, TaskStatus, WorkTask } from "@/lib/workspace/types";

const now = new Date(2026, 8, 24, 12, 0, 0);

function task(
  id: string,
  dueAt: Date,
  importance: Importance = "minor",
  status: TaskStatus = "open",
): WorkTask {
  return {
    id,
    title: id,
    project: "Test",
    area: "Work",
    importance,
    status,
    dueAt: dueAt.toISOString(),
    estimateMinutes: 30,
    sourceIds: ["manual"],
    signals: [],
    rationale: "Test task",
    createdAt: now.toISOString(),
  };
}

describe("prioritizeTasks", () => {
  it("keeps major work ahead of minor work while accounting for urgency", () => {
    const majorTomorrow = task(
      "major-tomorrow",
      new Date(2026, 8, 25, 12),
      "major",
    );
    const minorOverdue = task(
      "minor-overdue",
      new Date(2026, 8, 23, 12),
      "minor",
    );

    const result = prioritizeTasks(
      [minorOverdue, majorTomorrow],
      "week",
      now,
    );

    expect(result.map((item) => item.id)).toEqual([
      "major-tomorrow",
      "minor-overdue",
    ]);
    expect(scoreTask(majorTomorrow, now)).toBeGreaterThan(
      scoreTask(minorOverdue, now),
    );
  });

  it("uses calendar boundaries for today, this week, and this month", () => {
    const today = task("today", new Date(2026, 8, 24, 18));
    const sunday = task("sunday", new Date(2026, 8, 27, 18));
    const monday = task("monday", new Date(2026, 8, 28, 18));
    const october = task("october", new Date(2026, 9, 1, 9));
    const tasks = [today, sunday, monday, october];

    expect(prioritizeTasks(tasks, "today", now).map((item) => item.id)).toEqual([
      "today",
    ]);
    expect(
      prioritizeTasks(tasks, "week", now)
        .map((item) => item.id)
        .sort(),
    ).toEqual(["sunday", "today"]);
    expect(
      prioritizeTasks(tasks, "month", now)
        .map((item) => item.id)
        .sort(),
    ).toEqual(["monday", "sunday", "today"]);
  });

  it("excludes completed work from the active priority stack", () => {
    const completed = task(
      "completed",
      new Date(2026, 8, 24, 15),
      "major",
      "completed",
    );

    expect(prioritizeTasks([completed], "today", now)).toEqual([]);
  });
});

describe("getCompletionStats", () => {
  it("calculates progress only from commitments inside the horizon", () => {
    const tasks = [
      task("done", new Date(2026, 8, 24, 10), "minor", "completed"),
      task("open", new Date(2026, 8, 24, 17)),
      task("later", new Date(2026, 8, 26, 17)),
    ];

    expect(getCompletionStats(tasks, "today", now)).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
    });
  });
});
