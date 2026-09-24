import type { ConnectorId } from "@/lib/workspace/types";

export interface ConnectorDefinition {
  id: ConnectorId;
  label: string;
  shortLabel: string;
  description: string;
  capabilities: string[];
  setupKind: "oauth" | "export" | "local" | "webhook";
}

export const CONNECTOR_CATALOG: readonly ConnectorDefinition[] = [
  {
    id: "gmail",
    label: "Gmail",
    shortLabel: "Mail",
    description: "Turn flagged threads and commitments into reviewable signals.",
    capabilities: ["Flagged threads", "Deadlines", "Follow-ups"],
    setupKind: "oauth",
  },
  {
    id: "slack",
    label: "Slack",
    shortLabel: "Slack",
    description: "Surface mentions, saved items, and decisions from selected spaces.",
    capabilities: ["Mentions", "Saved items", "Decisions"],
    setupKind: "oauth",
  },
  {
    id: "calendar",
    label: "Google Calendar",
    shortLabel: "Calendar",
    description: "Protect focus time and place commitments around your real schedule.",
    capabilities: ["Events", "Focus blocks", "Capacity"],
    setupKind: "oauth",
  },
  {
    id: "drive",
    label: "Google Drive",
    shortLabel: "Drive",
    description:
      "Use recently changed files as supporting context for active work.",
    capabilities: ["Recent files", "File metadata", "Shared context"],
    setupKind: "oauth",
  },
  {
    id: "notion",
    label: "Notion",
    shortLabel: "Notion",
    description:
      "Reference pages and databases explicitly shared with the integration.",
    capabilities: ["Shared pages", "Databases", "Recent edits"],
    setupKind: "oauth",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    shortLabel: "LinkedIn",
    description:
      "Use official CSV import for relationships; API sync needs partner approval.",
    capabilities: ["OIDC identity", "Connections CSV", "Follow-ups"],
    setupKind: "export",
  },
  {
    id: "granola",
    label: "Granola",
    shortLabel: "Granola",
    description: "Bring decisions and action items in through an approved export.",
    capabilities: ["Meeting notes", "Decisions", "Action items"],
    setupKind: "export",
  },
  {
    id: "manual",
    label: "Manual capture",
    shortLabel: "Manual",
    description: "Add a task yourself without sending it to a third party.",
    capabilities: ["Tasks", "Personal plans", "Private notes"],
    setupKind: "local",
  },
  {
    id: "webhook",
    label: "Secure webhook",
    shortLabel: "Webhook",
    description: "A future server-side boundary for approved internal tools.",
    capabilities: ["Custom events", "Normalized signals"],
    setupKind: "webhook",
  },
] as const;
