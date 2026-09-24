import type {
  Importance,
  PriorityMetadata,
  WorkArea,
  WorkTask,
} from "@/lib/workspace/types";

export type PrimaryHorizon =
  | "today"
  | "week"
  | "month"
  | "future"
  | "inbox";

export type DeadlineKind = "hard" | "soft" | "inferred";

export type CommitmentKind =
  | "manual"
  | "structured"
  | "assignment"
  | "promise"
  | "flagged"
  | "inferred";

export type PriorityInput = PriorityMetadata;

export interface ScoreFactor {
  key: string;
  points: number;
  maxPoints: number;
  label: string;
  confidence: number;
  sourceIds: string[];
}

export interface RankedWorkItem {
  id: string;
  title: string;
  status: WorkTask["status"];
  area: WorkArea;
  project: { id: string; name: string } | null;
  primaryHorizon: PrimaryHorizon;
  importance: Importance;
  priorityScore: number;
  confidence: number;
  deadline: {
    at: string;
    kind: DeadlineKind;
    confidence: number;
  } | null;
  estimateMinutes: number | null;
  stale: { isStale: boolean; reason?: string; since?: string };
  recurrence: { seriesId: string; recurrenceKey: string } | null;
  dependencies: {
    blockedBy: Array<{ id: string; title: string }>;
    unblocks: Array<{
      id: string;
      title: string;
      importance: Importance;
    }>;
  };
  sources: Array<{
    artifactId: string;
    provider: string;
    label: string;
    url: string | null;
    occurredAt: string;
  }>;
  explanation: {
    summary: string;
    horizonReason: string;
    factors: ScoreFactor[];
    conflicts: string[];
  };
  overrides: Array<{
    field: string;
    value: unknown;
    expiresAt: string | null;
  }>;
  task: WorkTask;
}

export interface SourceArtifactInput {
  connectorAccountId: string;
  provider: string;
  externalId: string;
  externalParentId: string | null;
  kind: string;
  title: string;
  excerpt: string | null;
  deepLink: string | null;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  contentHash: string;
  revisionKey: string;
  normalizedPayload: Record<string, unknown>;
}

export function artifactIdentityKey(artifact: SourceArtifactInput) {
  return [
    artifact.connectorAccountId,
    artifact.kind,
    artifact.externalId,
  ].join(":");
}
