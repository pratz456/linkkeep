import { CONNECTOR_CATALOG } from "@/lib/connectors/catalog";
import type {
  ConnectorId,
  PublicConnectorState,
} from "@/lib/workspace/types";

type Environment = Readonly<Record<string, string | undefined>>;

const oauthRequirements: Partial<Record<ConnectorId, readonly string[]>> = {
  gmail: [
    "WORKLIFE_GMAIL_CLIENT_ID",
    "WORKLIFE_GMAIL_CLIENT_SECRET",
    "WORKLIFE_GMAIL_REDIRECT_URI",
  ],
  slack: [
    "WORKLIFE_SLACK_CLIENT_ID",
    "WORKLIFE_SLACK_CLIENT_SECRET",
    "WORKLIFE_SLACK_REDIRECT_URI",
  ],
  calendar: [
    "WORKLIFE_CALENDAR_CLIENT_ID",
    "WORKLIFE_CALENDAR_CLIENT_SECRET",
    "WORKLIFE_CALENDAR_REDIRECT_URI",
  ],
};

export function resolveConnectorStates(
  environment: Environment,
): PublicConnectorState[] {
  return CONNECTOR_CATALOG.map((connector) => {
    const base = {
      id: connector.id,
      label: connector.label,
      shortLabel: connector.shortLabel,
      description: connector.description,
      capabilities: [...connector.capabilities],
      lastSyncedAt: null,
    };

    if (connector.id === "manual") {
      return {
        ...base,
        status: "local" as const,
        statusLabel: "Available now",
        detail:
          "Manual tasks are stored in this browser. They are not uploaded by this MVP.",
      };
    }

    if (connector.id === "granola") {
      return {
        ...base,
        status: "unavailable" as const,
        statusLabel: "Export only",
        detail:
          "No direct Granola runtime API is configured. Use an approved export when one is available.",
      };
    }

    if (connector.id === "webhook") {
      return {
        ...base,
        status: "unavailable" as const,
        statusLabel: "Backend required",
        detail:
          "The normalization boundary is designed, but this preview does not expose an ingestion endpoint.",
      };
    }

    const requirements = oauthRequirements[connector.id] ?? [];
    const hasCredentials =
      requirements.length > 0 &&
      requirements.every((key) => Boolean(environment[key]?.trim()));

    if (hasCredentials) {
      return {
        ...base,
        status: "credentials_ready" as const,
        statusLabel: "Credentials detected",
        detail:
          "Server credentials are present. User authorization and encrypted token storage are still required; no data has been read.",
      };
    }

    return {
      ...base,
      status: "needs_setup" as const,
      statusLabel: "Not connected",
      detail:
        "No server-side OAuth connection is configured. Only clearly labeled sample data is shown.",
    };
  });
}
