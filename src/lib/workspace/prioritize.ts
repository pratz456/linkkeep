import type {
  RankedWorkItem,
  ScoreFactor,
} from "@/lib/workspace/domain";
import type {
  Horizon,
  Importance,
  ScheduleItem,
  WorkTask,
} from "@/lib/workspace/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const impactPoints = [0, 6, 12, 19, 25] as const;

function endOfDay(date: Date) {
  const result = new Date(date);
  result.setUTCHours(23, 59, 59, 999);
  return result;
}

export function getHorizonEnd(horizon: Horizon, now: Date) {
  if (horizon === "today") return endOfDay(now);

  if (horizon === "week") {
    const end = endOfDay(now);
    const daysUntilSunday = (7 - end.getUTCDay()) % 7;
    end.setUTCDate(end.getUTCDate() + daysUntilSunday);
    return end;
  }

  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  ));
}

export function getPrimaryHorizon(
  task: WorkTask,
  now: Date,
): RankedWorkItem["primaryHorizon"] {
  if (task.priority?.manualHorizon) return task.priority.manualHorizon;
  const dueAt = new Date(task.dueAt);
  const attentionAt =
    task.priority?.attentionAt != null
      ? new Date(task.priority.attentionAt)
      : deriveAttentionAt(dueAt, task.estimateMinutes);
  const anchor = attentionAt.getTime() < dueAt.getTime() ? attentionAt : dueAt;

  if (
    dueAt.getTime() < now.getTime() ||
    anchor.getTime() <= getHorizonEnd("today", now).getTime()
  ) {
    return "today";
  }
  if (anchor.getTime() <= getHorizonEnd("week", now).getTime()) return "week";
  if (anchor.getTime() <= getHorizonEnd("month", now).getTime()) return "month";
  return task.priority?.accepted === false ? "inbox" : "future";
}

function deriveAttentionAt(dueAt: Date, estimateMinutes: number) {
  const leadDays =
    estimateMinutes <= 30
      ? 0
      : estimateMinutes <= 120
        ? 1
        : estimateMinutes <= 480
          ? 3
          : 7;
  return new Date(dueAt.getTime() - leadDays * DAY_MS);
}

function horizonIncludes(primary: RankedWorkItem["primaryHorizon"], horizon: Horizon) {
  if (horizon === "today") return primary === "today";
  if (horizon === "week") return primary === "today" || primary === "week";
  return (
    primary === "today" || primary === "week" || primary === "month"
  );
}

export function isTaskInHorizon(task: WorkTask, horizon: Horizon, now: Date) {
  if (task.status === "completed") return false;
  return horizonIncludes(getPrimaryHorizon(task, now), horizon);
}

export function scoreTask(task: WorkTask, now: Date) {
  return projectTask(task, now).priorityScore;
}

export function projectTask(task: WorkTask, now: Date): RankedWorkItem {
  const dueTime = new Date(task.dueAt).getTime();
  const distanceInDays = (dueTime - now.getTime()) / DAY_MS;
  const metadata = task.priority ?? {};
  const deadlineKind = metadata.deadlineKind ?? "hard";
  const deadlineConfidence = clamp(metadata.deadlineConfidence ?? 1, 0, 1);
  const impactLevel =
    metadata.impactLevel ?? (task.importance === "major" ? 3 : 1);
  const impactConfidence = clamp(metadata.impactConfidence ?? 1, 0, 1);
  const commitmentKind =
    metadata.commitmentKind ?? (task.isSample ? "assignment" : "manual");
  const commitmentConfidence = clamp(
    metadata.commitmentConfidence ?? (task.isSample ? 0.88 : 1),
    0,
    1,
  );
  const sourceIds = [...new Set(task.sourceIds)];
  const factors: ScoreFactor[] = [];

  const urgencyBase =
    distanceInDays < 0
      ? 35
      : distanceInDays <= 1
        ? 32
        : distanceInDays <= 3
          ? 26
          : distanceInDays <= 7
            ? 18
            : distanceInDays <= 14
              ? 10
              : distanceInDays <= 30
                ? 5
                : 0;
  const deadlineMultiplier =
    deadlineKind === "hard"
      ? 1
      : deadlineKind === "soft"
        ? 0.75
        : deadlineConfidence;
  pushFactor(
    factors,
    "urgency",
    Math.round(urgencyBase * deadlineMultiplier),
    35,
    distanceInDays < 0
      ? "Hard deadline overdue"
      : distanceInDays <= 1
        ? "Deadline within 24 hours"
        : `Deadline in ${Math.max(1, Math.ceil(distanceInDays))} days`,
    deadlineConfidence,
    sourceIds,
  );

  pushFactor(
    factors,
    "impact",
    Math.round(impactPoints[impactLevel] * impactConfidence),
    25,
    `${task.importance === "major" ? "Major" : "Minor"} outcome impact`,
    impactConfidence,
    sourceIds,
  );

  const commitmentBase = {
    manual: 15,
    structured: 15,
    assignment: 13,
    promise: 11,
    flagged: 7,
    inferred: 3,
  }[commitmentKind];
  pushFactor(
    factors,
    "commitment",
    Math.round(commitmentBase * commitmentConfidence),
    15,
    commitmentKind === "manual"
      ? "Committed by you"
      : `${commitmentKind.replace("_", " ")} commitment`,
    commitmentConfidence,
    sourceIds,
  );

  const dependencyPoints = Math.min(
    10,
    (metadata.unblocks ?? []).reduce(
      (total, item) => total + (item.importance === "major" ? 10 : 5),
      0,
    ),
  );
  pushFactor(
    factors,
    "dependency",
    dependencyPoints,
    10,
    dependencyPoints ? "Unblocks other work" : "No dependency leverage",
    1,
    sourceIds,
  );

  const latestSignalAt = task.signals.reduce(
    (latest, signal) =>
      Math.max(latest, new Date(signal.occurredAt).getTime()),
    0,
  );
  const signalAgeDays = latestSignalAt
    ? (now.getTime() - latestSignalAt) / DAY_MS
    : Number.POSITIVE_INFINITY;
  const freshPoints =
    signalAgeDays <= 1 ? 8 : signalAgeDays <= 3 ? 5 : signalAgeDays <= 7 ? 2 : 0;
  pushFactor(
    factors,
    "fresh_attention",
    freshPoints,
    8,
    freshPoints ? "Recent independent source activity" : "No recent evidence",
    commitmentConfidence,
    sourceIds,
  );

  const primaryHorizon = getPrimaryHorizon(task, now);
  const scheduleFit =
    primaryHorizon === "today" && task.estimateMinutes <= 30 ? 2 : 0;
  pushFactor(
    factors,
    "schedule_fit",
    scheduleFit,
    7,
    scheduleFit ? "Fits a short open block" : "No confirmed focus block",
    1,
    sourceIds,
  );

  const stale = getStaleState(task, now, deadlineKind);
  if ((metadata.blockedBy?.length ?? 0) > 0) {
    pushFactor(
      factors,
      "blocked",
      -18,
      0,
      `Blocked by ${metadata.blockedBy?.[0]?.title ?? "another item"}`,
      1,
      sourceIds,
    );
  }
  if (stale.isStale) {
    pushFactor(
      factors,
      "stale",
      deadlineKind === "inferred" ? -15 : -10,
      0,
      stale.reason ?? "Needs review",
      1,
      sourceIds,
    );
  }

  const manualAdjustment = Math.round(
    clamp(metadata.manualRankAdjustment ?? 0, -25, 25),
  );
  if (manualAdjustment) {
    pushFactor(
      factors,
      "manual_adjustment",
      manualAdjustment,
      25,
      "Adjusted by you",
      1,
      ["manual"],
    );
  }

  const rawScore = factors.reduce((total, factor) => total + factor.points, 0);
  const priorityScore = clamp(rawScore, 0, 100);
  if (priorityScore !== rawScore) {
    pushFactor(
      factors,
      "score_clamp",
      priorityScore - rawScore,
      0,
      "Score bounded to 0–100",
      1,
      [],
    );
  }
  const confidence = round(
    commitmentConfidence * 0.45 +
      (metadata.accepted === false ? 0.5 : 1) * 0.25 +
      deadlineConfidence * 0.2 +
      Math.min(task.title.trim().length / 24, 1) * 0.1,
    3,
  );
  const visibleFactors = factors
    .filter((factor) => factor.points !== 0 && factor.key !== "score_clamp")
    .slice(0, 3);

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    area: task.area,
    project: { id: task.project.toLowerCase().replace(/\s+/g, "-"), name: task.project },
    primaryHorizon,
    importance: task.importance,
    priorityScore,
    confidence,
    deadline: {
      at: task.dueAt,
      kind: deadlineKind,
      confidence: deadlineConfidence,
    },
    estimateMinutes: task.estimateMinutes,
    stale,
    recurrence: null,
    dependencies: {
      blockedBy: metadata.blockedBy ?? [],
      unblocks: metadata.unblocks ?? [],
    },
    sources: task.signals.map((signal) => ({
      artifactId: signal.id,
      provider: signal.connectorId,
      label: signal.label,
      url: task.sourceUrl ?? null,
      occurredAt: signal.occurredAt,
    })),
    explanation: {
      summary: visibleFactors
        .map(
          (factor) =>
            `${factor.label} (${factor.points > 0 ? "+" : ""}${factor.points})`,
        )
        .join(", "),
      horizonReason: horizonReason(primaryHorizon),
      factors,
      conflicts: [],
    },
    overrides: manualAdjustment
      ? [
          {
            field: "rank_boost",
            value: manualAdjustment,
            expiresAt: null,
          },
        ]
      : [],
    task,
  };
}

export function prioritizeTasks(
  tasks: WorkTask[],
  horizon: Horizon,
  now: Date,
) {
  return tasks
    .map((task) => projectTask(task, now))
    .filter(
      (projection) =>
        projection.status !== "completed" &&
        horizonIncludes(projection.primaryHorizon, horizon),
    )
    .sort((a, b) => {
      if (a.importance !== b.importance) {
        return a.importance === "major" ? -1 : 1;
      }
      const scoreDifference = b.priorityScore - a.priorityScore;
      if (scoreDifference !== 0) return scoreDifference;
      const dueDifference =
        new Date(a.deadline?.at ?? "9999-12-31").getTime() -
        new Date(b.deadline?.at ?? "9999-12-31").getTime();
      if (dueDifference !== 0) return dueDifference;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return a.id.localeCompare(b.id);
    })
    .map((projection) => projection.task);
}

function pushFactor(
  factors: ScoreFactor[],
  key: string,
  points: number,
  maxPoints: number,
  label: string,
  confidence: number,
  sourceIds: string[],
) {
  factors.push({
    key,
    points,
    maxPoints,
    label,
    confidence: round(confidence, 3),
    sourceIds,
  });
}

function getStaleState(
  task: WorkTask,
  now: Date,
  deadlineKind: "hard" | "soft" | "inferred",
): RankedWorkItem["stale"] {
  if (deadlineKind === "hard") return { isStale: false };
  const candidates = [
    task.createdAt,
    task.priority?.lastEvidenceAt,
    task.priority?.lastUserTouchAt,
    ...task.signals.map((signal) => signal.occurredAt),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const lastRelevantAt = Math.max(...candidates);
  const inactiveDays = (now.getTime() - lastRelevantAt) / DAY_MS;
  const overdueDays =
    (now.getTime() - new Date(task.dueAt).getTime()) / DAY_MS;

  if (
    deadlineKind === "inferred" &&
    overdueDays >= 7 &&
    inactiveDays >= 7
  ) {
    return {
      isStale: true,
      reason: "Inferred deadline is overdue and unconfirmed",
      since: new Date(lastRelevantAt + 7 * DAY_MS).toISOString(),
    };
  }
  if (inactiveDays >= 30) {
    return {
      isStale: true,
      reason: "No relevant activity for 30 days",
      since: new Date(lastRelevantAt + 30 * DAY_MS).toISOString(),
    };
  }
  return { isStale: false };
}

function horizonReason(horizon: RankedWorkItem["primaryHorizon"]) {
  return {
    today: "Due, overdue, or ready for attention today",
    week: "Attention begins before the end of this week",
    month: "Attention begins before month end",
    future: "Scheduled beyond this month",
    inbox: "Needs review before it becomes a commitment",
  }[horizon];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function round(value: number, places: number) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

export function scheduleForHorizon(
  schedule: ScheduleItem[],
  horizon: Horizon,
  now: Date,
) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
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

export function getCompletionStats(
  tasks: WorkTask[],
  horizon: Horizon,
  now: Date,
) {
  const relevant = tasks.filter((task) =>
    horizonIncludes(getPrimaryHorizon(task, now), horizon),
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
      timeZone: "UTC",
    }).format(now);
  }

  const end = getHorizonEnd(horizon, now);
  if (horizon === "week") {
    return `${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(now)} – ${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(end)}`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
}
