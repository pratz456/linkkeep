import { describe, expect, it } from "vitest";
import {
  getCompletionStats,
  getPrimaryHorizon,
  prioritizeTasks,
  projectTask,
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
  it("keeps impact classification separate from urgency score", () => {
    const majorLater = task(
      "major-later",
      new Date(2026, 9, 14, 12),
      "major",
    );
    const minorOverdue = task(
      "minor-overdue",
      new Date(2026, 8, 23, 12),
      "minor",
    );

    expect(projectTask(majorLater, now).importance).toBe("major");
    expect(projectTask(minorOverdue, now).importance).toBe("minor");
    expect(scoreTask(minorOverdue, now)).toBeGreaterThan(
      scoreTask(majorLater, now),
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

  it("keeps hard-overdue work in Today and far-future work out of Month", () => {
    const overdue = task("overdue", new Date(2026, 7, 1, 12));
    const future = task("future", new Date(2026, 11, 1, 12));

    expect(getPrimaryHorizon(overdue, now)).toBe("today");
    expect(getPrimaryHorizon(future, now)).toBe("future");
    expect(prioritizeTasks([overdue, future], "month", now)).toHaveLength(1);
  });

  it("returns deterministic, fully explained score factors", () => {
    const item = task("explained", new Date(2026, 8, 24, 18), "major");
    item.priority = {
      impactLevel: 4,
      impactConfidence: 0.9,
      commitmentKind: "manual",
      commitmentConfidence: 1,
      manualRankAdjustment: 5,
    };

    const first = projectTask(item, now);
    const second = projectTask(item, now);
    const factorTotal = first.explanation.factors.reduce(
      (sum, factor) => sum + factor.points,
      0,
    );

    expect(first).toEqual(second);
    expect(factorTotal).toBe(first.priorityScore);
    expect(first.explanation.summary).toContain("Deadline");
    expect(first.overrides).toContainEqual(
      expect.objectContaining({ field: "rank_boost", value: 5 }),
    );
  });

  it("does not multiply recency for repeated signals from one source family", () => {
    const oneSignal = task("one-signal", new Date(2026, 8, 25, 12));
    oneSignal.sourceIds = ["slack"];
    oneSignal.signals = [
      {
        id: "signal-1",
        connectorId: "slack",
        label: "Thread",
        detail: "Action requested",
        occurredAt: new Date(2026, 8, 24, 10).toISOString(),
      },
    ];
    const tenSignals = {
      ...oneSignal,
      id: "ten-signals",
      signals: Array.from({ length: 10 }, (_, index) => ({
        ...oneSignal.signals[0],
        id: `signal-${index}`,
      })),
    };

    expect(scoreTask(tenSignals, now)).toBe(scoreTask(oneSignal, now));
  });

  it("applies a transparent blocker penalty", () => {
    const clear = task("clear", new Date(2026, 8, 25, 12), "major");
    const blocked = {
      ...clear,
      id: "blocked",
      priority: {
        blockedBy: [{ id: "predecessor", title: "Approve budget" }],
      },
    };
    const projection = projectTask(blocked, now);

    expect(scoreTask(blocked, now)).toBe(scoreTask(clear, now) - 18);
    expect(projection.explanation.factors).toContainEqual(
      expect.objectContaining({ key: "blocked", points: -18 }),
    );
  });

  it("flags stale inferred work without hiding hard-deadline work", () => {
    const inferred = task("inferred", new Date(2026, 8, 15, 12));
    inferred.createdAt = new Date(2026, 7, 1, 12).toISOString();
    inferred.priority = {
      deadlineKind: "inferred",
      deadlineConfidence: 0.7,
      lastEvidenceAt: new Date(2026, 7, 1, 12).toISOString(),
    };
    const hard = {
      ...inferred,
      id: "hard",
      priority: {
        ...inferred.priority,
        deadlineKind: "hard" as const,
      },
    };

    expect(projectTask(inferred, now).stale.isStale).toBe(true);
    expect(projectTask(inferred, now).explanation.factors).toContainEqual(
      expect.objectContaining({ key: "stale", points: -15 }),
    );
    expect(projectTask(hard, now).stale.isStale).toBe(false);
    expect(getPrimaryHorizon(hard, now)).toBe("today");
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
