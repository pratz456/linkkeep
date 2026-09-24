import "server-only";

import { cookies } from "next/headers";
import {
  connectorAuthorizationEnabled,
  getSessionSecret,
  workspaceCookieName,
} from "@/lib/connectors/session";
import { readWorkspaceSession } from "@/lib/connectors/security";
import { mergeSyncedWorkspace } from "@/lib/connectors/local-sync";
import { listConnectorAccounts } from "@/lib/connectors/store";
import { resolveConnectorStates } from "@/lib/connectors/status";
import type { WorkspaceSnapshot } from "@/lib/workspace/types";

export async function getPublicConnectorStates() {
  if (!connectorAuthorizationEnabled()) {
    return resolveConnectorStates(process.env);
  }
  const secret = getSessionSecret();
  if (!secret || !process.env.DATABASE_URL) {
    return resolveConnectorStates(process.env);
  }

  const cookieStore = await cookies();
  const session = readWorkspaceSession(
    cookieStore.get(workspaceCookieName())?.value,
    secret,
  );
  if (!session) return resolveConnectorStates(process.env);

  try {
    const accounts = await listConnectorAccounts(session.workspaceId);
    return resolveConnectorStates(process.env, accounts);
  } catch {
    return resolveConnectorStates(process.env);
  }
}

export async function getInitialWorkspaceSnapshot(
  fallback: WorkspaceSnapshot,
) {
  if (
    process.env.WORKLIFE_LOCAL_MODE !== "true" ||
    !connectorAuthorizationEnabled()
  ) {
    return fallback;
  }
  const secret = getSessionSecret();
  if (!secret || !process.env.DATABASE_URL) return fallback;

  const cookieStore = await cookies();
  const session = readWorkspaceSession(
    cookieStore.get(workspaceCookieName())?.value,
    secret,
  );
  if (!session) return fallback;

  try {
    return await mergeSyncedWorkspace(session.workspaceId, fallback);
  } catch {
    return fallback;
  }
}
