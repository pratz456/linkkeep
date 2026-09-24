export type Horizon = "today" | "week" | "month";

export type Importance = "major" | "minor";

export type TaskStatus = "open" | "completed";

export type ConnectorId =
  | "gmail"
  | "slack"
  | "calendar"
  | "drive"
  | "notion"
  | "granola"
  | "linkedin"
  | "manual"
  | "webhook";

export type WorkArea = "Work" | "Personal" | "Wellbeing";

export interface PriorityMetadata {
  deadlineKind?: "hard" | "soft" | "inferred";
  deadlineConfidence?: number;
  impactLevel?: 0 | 1 | 2 | 3 | 4;
  impactConfidence?: number;
  commitmentKind?:
    | "manual"
    | "structured"
    | "assignment"
    | "promise"
    | "flagged"
    | "inferred";
  commitmentConfidence?: number;
  attentionAt?: string | null;
  accepted?: boolean;
  lastEvidenceAt?: string | null;
  lastUserTouchAt?: string | null;
  blockedBy?: Array<{ id: string; title: string }>;
  unblocks?: Array<{
    id: string;
    title: string;
    importance: Importance;
  }>;
  manualRankAdjustment?: number;
  manualHorizon?: "today" | "week" | "month" | "future" | "inbox" | null;
}

export interface ContextSignal {
  id: string;
  connectorId: ConnectorId;
  label: string;
  detail: string;
  occurredAt: string;
}

export interface WorkTask {
  id: string;
  title: string;
  project: string;
  area: WorkArea;
  importance: Importance;
  status: TaskStatus;
  dueAt: string;
  estimateMinutes: number;
  sourceIds: ConnectorId[];
  signals: ContextSignal[];
  rationale: string;
  reasonCodes?: string[];
  sourceUrl?: string | null;
  completedAt?: string | null;
  deferredUntil?: string | null;
  priority?: PriorityMetadata;
  createdAt: string;
  isSample?: boolean;
}

export interface ScheduleItem {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  kind: "meeting" | "focus" | "personal";
  sourceId: ConnectorId;
  attendees?: number;
  location?: string | null;
  joinUrl?: string | null;
  preparationNote?: string | null;
  conflictState?: "none" | "overlap" | "back_to_back";
  isSample?: boolean;
}

export interface FollowUp {
  id: string;
  person: string;
  context: string;
  lastContactedAt: string | null;
  dueAt: string;
  kind: "explicit" | "suggested";
  reason: string;
  nextAction: string;
  status: "open" | "completed" | "snoozed";
  isSample?: boolean;
}

export interface WorkspaceSnapshot {
  tasks: WorkTask[];
  schedule: ScheduleItem[];
  followUps: FollowUp[];
  generatedAt: string;
  timeZone: string;
  isSample: boolean;
}

export type ConnectorStatus =
  | "connected"
  | "authorized"
  | "local"
  | "needs_setup"
  | "ready_to_connect"
  | "unavailable";

export interface PublicConnectorState {
  id: ConnectorId;
  label: string;
  shortLabel: string;
  description: string;
  status: ConnectorStatus;
  statusLabel: string;
  detail: string;
  capabilities: string[];
  lastSyncedAt: string | null;
  setupUrl: string | null;
  callbackPath: string | null;
  blockers: string[];
  accountLabel: string | null;
}
