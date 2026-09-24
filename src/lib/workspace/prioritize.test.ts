import { describe, expect, it } from "vitest";
import {
  getCompletionStats,
  getPrimaryHorizon,
  nextMeetingForSchedule,
  prioritizeTasks,
  projectTask,
  scoreTask,
} from "@/lib/workspace/prioritize";
import type { Importance, TaskStatus, WorkTask } from "@/lib/workspace/types";

const utc = (month: number, day: number, hour: number) =>
  new Date(Date.UTC(2026, month - 1, day, hour));
const now = utc(9, 24, 12);

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
      utc(10, 14, 12),
      "major",
    );
    const minorOverdue = task(
      "minor-overdue",
      utc(9, 23, 12),
      "minor",
    );

    expect(projectTask(majorLater, now).importance).toBe("major");
    expect(projectTask(minorOverdue, now).importance).toBe("minor");
    expect(scoreTask(minorOverdue, now)).toBeGreaterThan(
      scoreTask(majorLater, now),
    );
  });

  it("uses calendar boundaries for today, this week, and this month", () => {
    const today = task("today", utc(9, 24, 18));
    const sunday = task("sunday", utc(9, 27, 18));
    const monday = task("monday", utc(9, 28, 18));
    const october = task("october", utc(10, 1, 9));
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
      utc(9, 24, 15),
      "major",
      "completed",
    );

    expect(prioritizeTasks([completed], "today", now)).toEqual([]);
  });

  it("keeps hard-overdue work in Today and far-future work out of Month", () => {
    const overdue = task("overdue", utc(8, 1, 12));
    const future = task("future", utc(12, 1, 12));

    expect(getPrimaryHorizon(overdue, now)).toBe("today");
    expect(getPrimaryHorizon(future, now)).toBe("future");
    expect(prioritizeTasks([overdue, future], "month", now)).toHaveLength(1);
  });

  it("reclassifies work after UTC midnight without a reload", () => {
    const item = task("after-midnight", utc(9, 25, 0));

    expect(
      getPrimaryHorizon(item, new Date("2026-09-24T23:59:00.000Z")),
    ).toBe("week");
    expect(
      getPrimaryHorizon(item, new Date("2026-09-25T00:01:00.000Z")),
    ).toBe("today");
  });

  it("returns deterministic, fully explained score factors", () => {
    const item = task("explained", utc(9, 24, 18), "major");
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
    const oneSignal = task("one-signal", utc(9, 25, 12));
    oneSignal.sourceIds = ["slack"];
    oneSignal.signals = [
      {
        id: "signal-1",
        connectorId: "slack",
        label: "Thread",
        detail: "Action requested",
        occurredAt: utc(9, 24, 10).toISOString(),
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

  it("labels short duration without claiming unverified calendar fit", () => {
    const shortTask = task("short", utc(9, 24, 18));
    const factors = projectTask(shortTask, now).explanation.factors;

    expect(factors).toContainEqual(
      expect.objectContaining({
        key: "short_duration",
        points: 2,
        label: "Short task (30 minutes or less)",
      }),
    );
    expect(factors.some((factor) => factor.key === "schedule_fit")).toBe(false);
  });

  it("applies a transparent blocker penalty", () => {
    const clear = task("clear", utc(9, 25, 12), "major");
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
    const inferred = task("inferred", utc(9, 15, 12));
    inferred.createdAt = utc(8, 1, 12).toISOString();
    inferred.priority = {
      deadlineKind: "inferred",
      deadlineConfidence: 0.7,
      lastEvidenceAt: utc(8, 1, 12).toISOString(),
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

describe("nextMeetingForSchedule", () => {
  const meetings = [
    {
      id: "first",
      title: "First",
      startAt: "2026-09-24T12:00:00.000Z",
      endAt: "2026-09-24T12:30:00.000Z",
      kind: "meeting" as const,
      sourceId: "calendar" as const,
    },
    {
      id: "second",
      title: "Second",
      startAt: "2026-09-24T14:00:00.000Z",
      endAt: "2026-09-24T14:30:00.000Z",
      kind: "meeting" as const,
      sourceId: "calendar" as const,
    },
  ];

  it("advances after a meeting boundary", () => {
    expect(
      nextMeetingForSchedule(
        meetings,
        new Date("2026-09-24T12:29:00.000Z"),
      )?.id,
    ).toBe("first");
    expect(
      nextMeetingForSchedule(
        meetings,
        new Date("2026-09-24T12:31:00.000Z"),
      )?.id,
    ).toBe("second");
    expect(
      nextMeetingForSchedule(
        meetings,
        new Date("2026-09-24T14:31:00.000Z"),
      ),
    ).toBeUndefined();
  });
});

describe("getCompletionStats", () => {
  it("calculates progress only from commitments inside the horizon", () => {
    const tasks = [
      task("done", utc(9, 24, 10), "minor", "completed"),
      task("open", utc(9, 24, 17)),
      task("later", utc(9, 26, 17)),
      task("historical", utc(8, 1, 10), "minor", "completed"),
    ];

    expect(getCompletionStats(tasks, "today", now)).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
    });
  });
});
