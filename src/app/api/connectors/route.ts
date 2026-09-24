import { type NextRequest, NextResponse } from "next/server";
import { databaseConfigured } from "@/db";
import {
  resolveConnectorStates,
  type ConnectorAccountSummary,
} from "@/lib/connectors/status";
import {
  connectorAuthorizationEnabled,
  ensureWorkspaceSession,
  getSessionSecret,
  setWorkspaceCookie,
} from "@/lib/connectors/session";
import { listConnectorAccounts } from "@/lib/connectors/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let accounts: ConnectorAccountSummary[] = [];
  let sessionToken: string | null = null;
  let runtimeBlocker: string | null = null;

  if (
    connectorAuthorizationEnabled() &&
    databaseConfigured &&
    getSessionSecret()
  ) {
    try {
      const workspace = await ensureWorkspaceSession(request);
      accounts = await listConnectorAccounts(workspace.workspaceId);
      sessionToken = workspace.sessionToken;
    } catch {
      runtimeBlocker =
        "Connector storage is configured but unavailable. Check the database connection.";
    }
  }

  let connectors = resolveConnectorStates(process.env, accounts);
  if (runtimeBlocker) {
    connectors = connectors.map((connector) =>
      connector.callbackPath
        ? {
            ...connector,
            status: "needs_setup" as const,
            statusLabel: "Storage unavailable",
            detail:
              "Authorization is paused because encrypted connector storage could not be reached.",
            setupUrl: null,
            blockers: [...connector.blockers, runtimeBlocker],
          }
        : connector,
    );
  }

  const response = NextResponse.json(
    {
      connectors,
      checkedAt: new Date().toISOString(),
      runtimeBlocker,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
  setWorkspaceCookie(response, sessionToken);
  return response;
}
