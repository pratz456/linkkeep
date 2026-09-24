export type Horizon = "today" | "week" | "month";

export type Importance = "major" | "minor";

export type TaskStatus = "open" | "completed";

export type ConnectorId =
  | "gmail"
  | "slack"
  | "calendar"
  | "granola"
  | "manual"
  | "webhook";

export type WorkArea = "Work" | "Personal" | "Wellbeing";

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
  isSample?: boolean;
}

export interface WorkspaceSnapshot {
  tasks: WorkTask[];
  schedule: ScheduleItem[];
  generatedAt: string;
  isSample: boolean;
}

export type ConnectorStatus =
  | "local"
  | "needs_setup"
  | "credentials_ready"
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
}
