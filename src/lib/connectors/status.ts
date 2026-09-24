import { CONNECTOR_CATALOG } from "@/lib/connectors/catalog";
import { parseEncryptionKey } from "@/lib/connectors/security";
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
  gmail: ["WORKLIFE_GOOGLE_CLIENT_ID", "WORKLIFE_GOOGLE_CLIENT_SECRET"],
  calendar: ["WORKLIFE_GOOGLE_CLIENT_ID", "WORKLIFE_GOOGLE_CLIENT_SECRET"],
  drive: ["WORKLIFE_GOOGLE_CLIENT_ID", "WORKLIFE_GOOGLE_CLIENT_SECRET"],
  slack: [
    "WORKLIFE_SLACK_CLIENT_ID",
    "WORKLIFE_SLACK_CLIENT_SECRET",
  ],
  notion: [
    "WORKLIFE_NOTION_CLIENT_ID",
    "WORKLIFE_NOTION_CLIENT_SECRET",
    "WORKLIFE_NOTION_VERSION",
  ],
};

export function resolveConnectorStates(
  environment: Environment,
  accounts: ConnectorAccountSummary[] = [],
): PublicConnectorState[] {
  const localMode = environment.WORKLIFE_LOCAL_MODE === "true";
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
    const blockers =
      environment.NODE_ENV === "production"
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
      environment.WORKLIFE_GMAIL_VERIFICATION_STATUS !== "approved" &&
      !(
        localMode &&
        environment.WORKLIFE_GMAIL_VERIFICATION_STATUS === "local_testing"
      )
    ) {
      blockers.push(
        "Google restricted-scope verification and security review approval",
      );
    }
    if (environment.NODE_ENV === "production") {
      blockers.push(
        "Production identity, tenant isolation, KMS encryption, verified webhooks, and deletion controls",
      );
    } else if (
      environment.WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION !== "true"
    ) {
      blockers.push(
        "WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION=true (development only)",
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
      const isLive = Boolean(account.lastSyncedAt);
      const workerConfigured = Boolean(
        localMode || environment.WORKLIFE_SYNC_DISPATCH_URL?.trim(),
      );
      return {
        ...base,
        status: isLive ? ("connected" as const) : ("authorized" as const),
        statusLabel: isLive
          ? "Live"
          : workerConfigured
            ? "Authorized · queued"
            : "Authorized · worker needed",
        detail: isLive
          ? "Authorization is stored server-side and this source has completed a sync."
          : "Authorization is stored server-side. No ingestion has completed, so this source is not marked live.",
        setupUrl: `/api/connectors/${connector.id}/authorize`,
        lastSyncedAt: account.lastSyncedAt,
        accountLabel: account.accountLabel,
        blockers: [
          ...(workerConfigured
            ? []
            : ["Durable sync worker (Inngest, Trigger.dev, or equivalent)"]),
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
