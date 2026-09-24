import { type NextRequest, NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  getOAuthProviderConfig,
  isOAuthConnectorId,
} from "@/lib/connectors/providers";
import { safeReturnUrl } from "@/lib/connectors/redirect-policy";
import {
  encryptSecret,
  readOAuthTransaction,
  validateOAuthTransaction,
} from "@/lib/connectors/security";
import {
  clearOAuthCookie,
  connectorAuthorizationEnabled,
  getAppOrigin,
  getConnectorRedirectUri,
  getSessionSecret,
  oauthCookieName,
  readWorkspaceId,
} from "@/lib/connectors/session";
import {
  consumeOAuthState,
  saveConnectorAccountWithInitialJob,
} from "@/lib/connectors/store";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isOAuthConnectorId(provider)) {
    return NextResponse.json(
      { error: "Unknown connector callback." },
      { status: 404 },
    );
  }
  if (!connectorAuthorizationEnabled(request)) {
    return NextResponse.json(
      { error: "Connector authorization is disabled." },
      { status: 503 },
    );
  }

  const sessionSecret = getSessionSecret();
  const encryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY?.trim();
  const config = getOAuthProviderConfig(provider, process.env);
  if (!sessionSecret || !encryptionKey || !config) {
    return finishWithStatus(request, provider, "/", "setup_incomplete");
  }

  const transaction = readOAuthTransaction(
    request.cookies.get(oauthCookieName(provider))?.value,
    sessionSecret,
  );
  const workspaceId = readWorkspaceId(request);
  const returnedState = request.nextUrl.searchParams.get("state");
  const providerError = request.nextUrl.searchParams.get("error");

  if (
    !validateOAuthTransaction(transaction, {
      workspaceId,
      provider,
      state: returnedState,
    }) ||
    transaction.redirectUri !== getConnectorRedirectUri(provider, request) ||
    transaction.scopes.join(" ") !== config.scopes.join(" ")
  ) {
    return finishWithStatus(
      request,
      provider,
      transaction?.returnTo ?? "/",
      "invalid_oauth_state",
    );
  }
  const validatedWorkspaceId = transaction.workspaceId;

  try {
    const consumed = await consumeOAuthState({
      state: transaction.state,
      workspaceId: validatedWorkspaceId,
      provider,
    });
    if (!consumed) {
      return finishWithStatus(
        request,
        provider,
        transaction.returnTo,
        "expired_or_reused_oauth_state",
      );
    }
  } catch {
    return finishWithStatus(
      request,
      provider,
      transaction.returnTo,
      "oauth_state_store_unavailable",
    );
  }

  if (providerError) {
    return finishWithStatus(
      request,
      provider,
      transaction.returnTo,
      "authorization_denied",
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return finishWithStatus(
      request,
      provider,
      transaction.returnTo,
      "missing_authorization_code",
    );
  }

  let tokenSet: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
  try {
    tokenSet = await exchangeAuthorizationCode({
      config,
      code,
      redirectUri: transaction.redirectUri,
      verifier: transaction.verifier,
    });
  } catch {
    return finishWithStatus(
      request,
      provider,
      transaction.returnTo,
      "authorization_exchange_failed",
    );
  }

  try {
    await saveConnectorAccountWithInitialJob({
      workspaceId: validatedWorkspaceId,
      provider,
      externalAccountId: tokenSet.externalAccountId,
      accountLabel: tokenSet.accountLabel,
      accessTokenEncrypted: encryptSecret(
        tokenSet.accessToken,
        encryptionKey,
      ),
      refreshTokenEncrypted: tokenSet.refreshToken
        ? encryptSecret(tokenSet.refreshToken, encryptionKey)
        : null,
      tokenType: tokenSet.tokenType,
      scope: tokenSet.scope,
      expiresAt: tokenSet.expiresAt,
      metadataJson: JSON.stringify(tokenSet.metadata),
      idempotencyKey: `oauth:${provider}:${validatedWorkspaceId}:${transaction.state}`,
      payload: {
        provider,
        authorizationOnly: true,
      },
    });

    return finishWithStatus(
      request,
      provider,
      transaction.returnTo,
      null,
    );
  } catch {
    return finishWithStatus(
      request,
      provider,
      transaction.returnTo,
      "authorization_persistence_failed",
    );
  }
}

function finishWithStatus(
  request: NextRequest,
  provider: Parameters<typeof clearOAuthCookie>[1],
  returnTo: string,
  error: string | null,
) {
  const destination = safeReturnUrl(returnTo, getAppOrigin(request));
  if (error) {
    destination.searchParams.set("connector_error", error);
    destination.searchParams.set("connector", provider);
  } else {
    destination.searchParams.set("connector_connected", provider);
  }
  const response = NextResponse.redirect(destination);
  clearOAuthCookie(response, provider);
  return response;
}
