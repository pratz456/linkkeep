import { CONNECTOR_CATALOG } from "@/lib/connectors/catalog";
import { isConnectorDevelopmentEnvironment } from "@/lib/connectors/environment-policy";
import { parseEncryptionKey } from "@/lib/connectors/security";
import {
  hasDistinctGoogleClientIds,
  resolveProviderScopes,
} from "@/lib/connectors/scope-policy";
import type {
  ConnectorId,
  PublicConnectorState,
} from "@/lib/workspace/types";

type Environment = Readonly<Record<string, string | undefined>>;

export interface ConnectorAccountSummary {
  provider: ConnectorId;
  accountLabel: string | null;
  authorizedAt: string;
  lastSyncedAt: string | null;
}

const globalRequirements = [
  "DATABASE_URL",
  "WORKLIFE_APP_URL",
  "WORKLIFE_SESSION_SECRET",
  "CONNECTOR_ENCRYPTION_KEY",
] as const;

const oauthRequirements: Partial<Record<ConnectorId, readonly string[]>> = {
  gmail: ["WORKLIFE_GMAIL_CLIENT_ID", "WORKLIFE_GMAIL_CLIENT_SECRET"],
  calendar: [
    "WORKLIFE_CALENDAR_CLIENT_ID",
    "WORKLIFE_CALENDAR_CLIENT_SECRET",
  ],
  drive: ["WORKLIFE_DRIVE_CLIENT_ID", "WORKLIFE_DRIVE_CLIENT_SECRET"],
  slack: [
    "WORKLIFE_SLACK_CLIENT_ID",
    "WORKLIFE_SLACK_CLIENT_SECRET",
    "WORKLIFE_SLACK_SIGNING_SECRET",
  ],
  notion: [
    "WORKLIFE_NOTION_CLIENT_ID",
    "WORKLIFE_NOTION_CLIENT_SECRET",
    "WORKLIFE_NOTION_WEBHOOK_SECRET",
    "WORKLIFE_NOTION_VERSION",
  ],
};

export function resolveConnectorStates(
  environment: Environment,
  accounts: ConnectorAccountSummary[] = [],
): PublicConnectorState[] {
  return CONNECTOR_CATALOG.map((connector) => {
    const supportsOAuth = connector.setupKind === "oauth";
    const callbackPath = supportsOAuth
      ? `/api/connectors/${connector.id}/callback`
      : null;
    const base = {
      id: connector.id,
      label: connector.label,
      shortLabel: connector.shortLabel,
      description: connector.description,
      capabilities: [...connector.capabilities],
      lastSyncedAt: null,
      setupUrl: null,
      callbackPath,
      blockers: [] as string[],
      accountLabel: null,
    };

    if (connector.id === "manual") {
      return {
        ...base,
        status: "local" as const,
        statusLabel: "Available now",
        detail:
          "Manual tasks are stored in this browser. They are not uploaded by this MVP.",
        setupUrl: null,
      };
    }

    if (connector.id === "granola") {
      return {
        ...base,
        status: "unavailable" as const,
        statusLabel: "Export only",
        detail:
          "No supported app-runtime Granola contract is configured. Cursor MCP access belongs to the agent runtime and cannot be reused by the deployed app.",
        blockers: ["Supported Granola API or approved export flow"],
      };
    }

    if (connector.id === "linkedin") {
      return {
        ...base,
        status: "unavailable" as const,
        statusLabel: "Partner gated",
        detail:
          "OIDC sign-in and official Connections CSV import are supported separately. First-degree connection API sync requires LinkedIn partner approval.",
        blockers: ["LinkedIn Connections API partner approval"],
      };
    }

    if (connector.id === "webhook") {
      return {
        ...base,
        status: "unavailable" as const,
        statusLabel: "Backend required",
        detail:
          "The normalization boundary is designed, but this preview does not expose an ingestion endpoint.",
        blockers: ["Signed ingestion endpoint"],
      };
    }

    const requirements = [
      ...globalRequirements,
      ...(oauthRequirements[connector.id] ?? []),
    ];
    const developmentEnabled =
      isConnectorDevelopmentEnvironment(environment);
    const blockers =
      !developmentEnabled
        ? [...requirements]
        : requirements.filter((key) => !environment[key]?.trim());

    if (
      environment.WORKLIFE_SESSION_SECRET &&
      environment.WORKLIFE_SESSION_SECRET.length < 32
    ) {
      blockers.push("WORKLIFE_SESSION_SECRET (minimum 32 characters)");
    }
    if (
      environment.CONNECTOR_ENCRYPTION_KEY &&
      !parseEncryptionKey(environment.CONNECTOR_ENCRYPTION_KEY)
    ) {
      blockers.push(
        "CONNECTOR_ENCRYPTION_KEY (32-byte base64 or 64-character hex)",
      );
    }
    if (
      connector.id === "gmail" &&
      environment.WORKLIFE_GMAIL_VERIFICATION_STATUS !== "approved"
    ) {
      blockers.push(
        "Google restricted-scope verification and security review approval",
      );
    }
    if (
      connector.id === "drive" &&
      !environment.WORKLIFE_GOOGLE_PICKER_API_KEY?.trim()
    ) {
      blockers.push(
        "WORKLIFE_GOOGLE_PICKER_API_KEY (selected-file Picker flow)",
      );
    }
    if (
      (connector.id === "gmail" ||
        connector.id === "calendar" ||
        connector.id === "drive") &&
      !resolveProviderScopes(
        connector.id,
        environment[`WORKLIFE_${connector.id.toUpperCase()}_SCOPES`],
      )
    ) {
      blockers.push(
        `${connector.label} scopes exceed the code-enforced read-only maximum`,
      );
    }
    if (
      (connector.id === "gmail" ||
        connector.id === "calendar" ||
        connector.id === "drive") &&
      !hasDistinctGoogleClientIds(environment)
    ) {
      blockers.push(
        "Google connector OAuth client IDs must be pairwise distinct",
      );
    }
    if (
      connector.id === "slack" &&
      !resolveProviderScopes(
        "slack",
        environment.WORKLIFE_SLACK_BOT_SCOPES,
      )
    ) {
      blockers.push(
        "Slack scopes exceed the code-enforced selected-channel bot maximum",
      );
    }
    if (!developmentEnabled) {
      blockers.push(
        "Loopback development environment only; production/staging identity, tenant isolation, KMS encryption, verified webhooks, and deletion controls remain required",
      );
    }

    const account = accounts.find(
      (candidate) => candidate.provider === connector.id,
    );

    if (account && blockers.length > 0) {
      return {
        ...base,
        status: "needs_setup" as const,
        statusLabel: "Authorized · blocked",
        detail:
          "Authorization exists, but required server configuration is missing. Stored tokens will not be used.",
        blockers,
        accountLabel: account.accountLabel,
      };
    }

    if (account) {
      return {
        ...base,
        status: "authorized" as const,
        statusLabel: "Authorized · worker needed",
        detail:
          "Authorization is stored server-side. No verified worker is bundled, so this source is not marked live.",
        setupUrl: `/api/connectors/${connector.id}/authorize`,
        lastSyncedAt: account.lastSyncedAt,
        accountLabel: account.accountLabel,
        blockers: [
          "Verified durable sync worker with authenticated capability handshake",
          "Provider revocation and derived-data deletion workflow",
        ],
      };
    }

    if (blockers.length === 0) {
      return {
        ...base,
        status: "ready_to_connect" as const,
        statusLabel: "Ready to authorize",
        detail:
          "Server configuration is ready. Authorization starts only when you choose Connect.",
        setupUrl: `/api/connectors/${connector.id}/authorize`,
      };
    }

    return {
      ...base,
      status: "needs_setup" as const,
      statusLabel: "Setup required",
      detail:
        "Required server configuration is missing. No authorization request or provider data access will occur.",
      blockers,
    };
  });
}
