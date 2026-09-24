import "server-only";

import { cookies } from "next/headers";
import {
  connectorAuthorizationEnabled,
  getSessionSecret,
  workspaceCookieName,
} from "@/lib/connectors/session";
import { readWorkspaceSession } from "@/lib/connectors/security";
import { listConnectorAccounts } from "@/lib/connectors/store";
import { resolveConnectorStates } from "@/lib/connectors/status";

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
