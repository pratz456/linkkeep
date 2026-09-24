export interface DedupeCandidate {
  id: string;
  title: string;
  project: string | null;
  actors: string[];
  dueAt: string | null;
  sourceReferences: string[];
  recurrenceKey: string | null;
  isManual: boolean;
  structuredExternalId: string | null;
  explicitOwner: string | null;
}

export interface DedupeResult {
  score: number;
  decision:
    | "auto_merged"
    | "review_same"
    | "review_distinct"
    | "pending";
  hardConflicts: string[];
  features: {
    title: number;
    actionVerb: number;
    entityOrProject: number;
    actorOverlap: number;
    dateProximity: number;
    sourceReference: number;
  };
}

const actionVerbs = new Set([
  "approve",
  "book",
  "draft",
  "finalize",
  "prepare",
  "review",
  "send",
  "ship",
  "update",
]);

export function scoreDuplicatePair(
  left: DedupeCandidate,
  right: DedupeCandidate,
): DedupeResult {
  const leftTokens = titleTokens(left.title);
  const rightTokens = titleTokens(right.title);
  const title = jaccard(leftTokens, rightTokens);
  const leftAction = leftTokens.find((token) => actionVerbs.has(token));
  const rightAction = rightTokens.find((token) => actionVerbs.has(token));
  const actionVerb = leftAction && leftAction === rightAction ? 1 : 0;
  const entityOrProject =
    left.project &&
    right.project &&
    normalize(left.project) === normalize(right.project)
      ? 1
      : 0;
  const actorOverlap = jaccard(
    left.actors.map(normalize),
    right.actors.map(normalize),
  );
  const dateProximity = dateSimilarity(left.dueAt, right.dueAt);
  const sourceReference = left.sourceReferences.some((reference) =>
    right.sourceReferences.includes(reference),
  )
    ? 1
    : 0;
  const features = {
    title,
    actionVerb,
    entityOrProject,
    actorOverlap,
    dateProximity,
    sourceReference,
  };
  const score = round(
    0.38 * title +
      0.18 * actionVerb +
      0.14 * entityOrProject +
      0.12 * actorOverlap +
      0.1 * dateProximity +
      0.08 * sourceReference,
  );
  const hardConflicts = hardConflictReasons(left, right, leftAction, rightAction);

  return {
    score,
    features,
    hardConflicts,
    decision:
      hardConflicts.length > 0
        ? "review_distinct"
        : score >= 0.9 && (title >= 0.8 || sourceReference === 1)
          ? "auto_merged"
          : score >= 0.72
            ? "review_same"
            : "pending",
  };
}

export function artifactDedupeKey(input: {
  connectorAccountId: string;
  kind: string;
  externalId: string;
}) {
  return `${input.connectorAccountId}:${input.kind}:${input.externalId}`;
}

function hardConflictReasons(
  left: DedupeCandidate,
  right: DedupeCandidate,
  leftAction: string | undefined,
  rightAction: string | undefined,
) {
  const conflicts: string[] = [];
  if (
    left.recurrenceKey &&
    right.recurrenceKey &&
    left.recurrenceKey !== right.recurrenceKey
  ) {
    conflicts.push("different_recurrence_occurrences");
  }
  if (left.isManual && right.isManual) {
    conflicts.push("independently_created_manual_items");
  }
  if (
    left.explicitOwner &&
    right.explicitOwner &&
    normalize(left.explicitOwner) !== normalize(right.explicitOwner)
  ) {
    conflicts.push("incompatible_explicit_owners");
  }
  if (
    left.structuredExternalId &&
    right.structuredExternalId &&
    left.structuredExternalId !== right.structuredExternalId &&
    !left.sourceReferences.some((reference) =>
      right.sourceReferences.includes(reference),
    )
  ) {
    conflicts.push("distinct_structured_task_ids");
  }
  if (leftAction && rightAction && leftAction !== rightAction) {
    conflicts.push("distinct_action_verbs");
  }
  return conflicts;
}

function titleTokens(value: string) {
  return normalize(value)
    .split(" ")
    .filter(
      (token) =>
        token &&
        !["a", "an", "the", "to", "for", "of", "and"].includes(token),
    );
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccard(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
}

function dateSimilarity(left: string | null, right: string | null) {
  if (!left || !right) return 0;
  const distance =
    Math.abs(new Date(left).getTime() - new Date(right).getTime()) /
    (24 * 60 * 60 * 1000);
  return distance <= 1 ? 1 : distance <= 7 ? (7 - distance) / 6 : 0;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
