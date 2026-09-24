import { type NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizationUrl,
  getOAuthProviderConfig,
  isOAuthConnectorId,
} from "@/lib/connectors/providers";
import {
  createOAuthState,
  createOAuthTransaction,
  createPkcePair,
  getOAuthExpiry,
} from "@/lib/connectors/security";
import {
  ensureWorkspaceSession,
  connectorAuthorizationEnabled,
  getConnectorRedirectUri,
  getSessionSecret,
  setOAuthCookie,
  setWorkspaceCookie,
} from "@/lib/connectors/session";
import { resolveConnectorStates } from "@/lib/connectors/status";
import { registerOAuthState } from "@/lib/connectors/store";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isOAuthConnectorId(provider)) {
    return NextResponse.json(
      { error: "This connector does not support OAuth authorization." },
      { status: 404 },
    );
  }
  if (!connectorAuthorizationEnabled()) {
    return NextResponse.json(
      {
        error:
          "Connector authorization is disabled until identity and tenant isolation gates are complete.",
      },
      { status: 503 },
    );
  }

  const connector = resolveConnectorStates(process.env).find(
    (candidate) => candidate.id === provider,
  );
  const config = getOAuthProviderConfig(provider, process.env);
  const sessionSecret = getSessionSecret();
  if (
    !connector ||
    connector.status !== "ready_to_connect" ||
    !config ||
    !sessionSecret
  ) {
    return NextResponse.json(
      {
        error: "Connector setup is incomplete.",
        blockers: connector?.blockers ?? ["Provider configuration"],
      },
      { status: 503 },
    );
  }

  try {
    const workspace = await ensureWorkspaceSession(request);
    const state = createOAuthState();
    const pkce = config.usePkce ? createPkcePair() : null;
    const returnTo = safeReturnPath(
      request.nextUrl.searchParams.get("returnTo"),
    );
    const redirectUri = getConnectorRedirectUri(provider, request);
    const transaction = createOAuthTransaction(
      {
        workspaceId: workspace.workspaceId,
        provider,
        state,
        verifier: pkce?.verifier ?? null,
        returnTo,
        redirectUri,
        scopes: [...config.scopes],
      },
      sessionSecret,
    );
    await registerOAuthState({
      state,
      workspaceId: workspace.workspaceId,
      provider,
      expiresAt: getOAuthExpiry(),
    });
    const authorizationUrl = buildAuthorizationUrl({
      config,
      redirectUri,
      state,
      codeChallenge: pkce?.challenge ?? null,
    });
    const response = NextResponse.redirect(authorizationUrl);
    setWorkspaceCookie(response, workspace.sessionToken);
    setOAuthCookie(response, provider, transaction);
    return response;
  } catch {
    return NextResponse.json(
      {
        error:
          "Connector authorization could not start because secure storage is unavailable.",
      },
      { status: 503 },
    );
  }
}

function safeReturnPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}
