import "server-only";

import type { ConnectorId } from "@/lib/workspace/types";
import { compareGrantedScopes } from "@/lib/connectors/security";
import {
  resolveGrantedScopes,
  resolveProviderScopes,
} from "@/lib/connectors/scope-policy";

export type OAuthConnectorId =
  | "gmail"
  | "calendar"
  | "drive"
  | "slack"
  | "notion";

type Environment = Readonly<Record<string, string | undefined>>;

interface OAuthProviderConfig {
  id: OAuthConnectorId;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  usePkce: boolean;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  scope: string | null;
  expiresAt: string | null;
  externalAccountId: string | null;
  accountLabel: string | null;
  metadata: Record<string, string | null>;
}

const oauthConnectorIds: OAuthConnectorId[] = [
  "gmail",
  "calendar",
  "drive",
  "slack",
  "notion",
];

export function isOAuthConnectorId(
  value: string | ConnectorId,
): value is OAuthConnectorId {
  return oauthConnectorIds.includes(value as OAuthConnectorId);
}

export function getOAuthProviderConfig(
  provider: OAuthConnectorId,
  environment: Environment,
): OAuthProviderConfig | null {
  if (
    provider === "gmail" ||
    provider === "calendar" ||
    provider === "drive"
  ) {
    const clientId = environment.WORKLIFE_GOOGLE_CLIENT_ID?.trim();
    const clientSecret = environment.WORKLIFE_GOOGLE_CLIENT_SECRET?.trim();
    const scopes = resolveProviderScopes(
      provider,
      environment[`WORKLIFE_${provider.toUpperCase()}_SCOPES`],
    );
    if (!clientId || !clientSecret || !scopes) return null;
    return {
      id: provider,
      clientId,
      clientSecret,
      authorizationUrl:
        environment.WORKLIFE_GOOGLE_AUTHORIZATION_URL?.trim() ||
        "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl:
        environment.WORKLIFE_GOOGLE_TOKEN_URL?.trim() ||
        "https://oauth2.googleapis.com/token",
      scopes,
      usePkce: true,
    };
  }

  if (provider === "slack") {
    const clientId = environment.WORKLIFE_SLACK_CLIENT_ID?.trim();
    const clientSecret = environment.WORKLIFE_SLACK_CLIENT_SECRET?.trim();
    const scopes = resolveProviderScopes(
      "slack",
      environment.WORKLIFE_SLACK_BOT_SCOPES,
    );
    if (!clientId || !clientSecret || !scopes) return null;
    return {
      id: provider,
      clientId,
      clientSecret,
      authorizationUrl:
        environment.WORKLIFE_SLACK_AUTHORIZATION_URL?.trim() ||
        "https://slack.com/oauth/v2/authorize",
      tokenUrl:
        environment.WORKLIFE_SLACK_TOKEN_URL?.trim() ||
        "https://slack.com/api/oauth.v2.access",
      scopes,
      usePkce: false,
    };
  }

  const clientId = environment.WORKLIFE_NOTION_CLIENT_ID?.trim();
  const clientSecret = environment.WORKLIFE_NOTION_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    id: provider,
    clientId,
    clientSecret,
    authorizationUrl:
      environment.WORKLIFE_NOTION_AUTHORIZATION_URL?.trim() ||
      "https://api.notion.com/v1/oauth/authorize",
    tokenUrl:
      environment.WORKLIFE_NOTION_TOKEN_URL?.trim() ||
      "https://api.notion.com/v1/oauth/token",
    scopes: [],
    usePkce: false,
  };
}

export function buildAuthorizationUrl({
  config,
  redirectUri,
  state,
  codeChallenge,
}: {
  config: OAuthProviderConfig;
  redirectUri: string;
  state: string;
  codeChallenge: string | null;
}) {
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  if (config.id === "slack") {
    url.searchParams.set("scope", config.scopes.join(","));
  } else if (config.id === "notion") {
    url.searchParams.set("owner", "user");
  } else {
    url.searchParams.set("scope", config.scopes.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
    if (codeChallenge) {
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
  }

  return url;
}

export async function exchangeAuthorizationCode({
  config,
  code,
  redirectUri,
  verifier,
}: {
  config: OAuthProviderConfig;
  code: string;
  redirectUri: string;
  verifier: string | null;
}): Promise<OAuthTokenSet> {
  if (config.id === "notion") {
    return exchangeNotionCode(config, code, redirectUri);
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  if (verifier) body.set("code_verifier", verifier);

  const payload = await requestToken(config.tokenUrl, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (config.id === "slack") {
    const tokenSet = normalizeSlackToken(payload);
    assertExpectedScopes(config.scopes, tokenSet.scope);
    return tokenSet;
  }

  const accessToken = requiredString(payload, "access_token");
  const grantedScopes = resolveGrantedScopes(
    config.id,
    optionalString(payload, "scope"),
    config.scopes,
  );
  if (!grantedScopes) {
    throw new Error("Provider did not report the granted scopes.");
  }
  const tokenSet: OAuthTokenSet = {
    accessToken,
    refreshToken: optionalString(payload, "refresh_token"),
    tokenType: optionalString(payload, "token_type"),
    scope: grantedScopes.value,
    expiresAt: expiresAt(payload.expires_in),
    externalAccountId: null,
    accountLabel: "Google account",
    metadata: {
      dataClass: config.id,
      identityResolution: "deferred_to_worker",
      scopeSource: grantedScopes.source,
    },
  };
  assertExpectedScopes(config.scopes, tokenSet.scope);
  return tokenSet;
}

async function exchangeNotionCode(
  config: OAuthProviderConfig,
  code: string,
  redirectUri: string,
): Promise<OAuthTokenSet> {
  const authorization = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString("base64");
  const payload = await requestToken(config.tokenUrl, {
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const owner = asRecord(payload.owner);
  const ownerUser = asRecord(owner?.user);

  return {
    accessToken: requiredString(payload, "access_token"),
    refreshToken: optionalString(payload, "refresh_token"),
    tokenType: optionalString(payload, "token_type"),
    scope: null,
    expiresAt: null,
    externalAccountId:
      optionalString(payload, "workspace_id") ??
      optionalString(ownerUser, "id"),
    accountLabel:
      optionalString(payload, "workspace_name") ??
      optionalString(ownerUser, "name"),
    metadata: {
      workspaceId: optionalString(payload, "workspace_id"),
      workspaceName: optionalString(payload, "workspace_name"),
      ownerId: optionalString(ownerUser, "id"),
    },
  };
}

function normalizeSlackToken(payload: Record<string, unknown>): OAuthTokenSet {
  if (payload.ok !== true) {
    throw new Error("Slack declined the authorization exchange.");
  }
  const authedUser = asRecord(payload.authed_user);
  const team = asRecord(payload.team);
  const accessToken =
    optionalString(payload, "access_token") ??
    optionalString(authedUser, "access_token");
  if (!accessToken) {
    throw new Error("Slack did not return a user access token.");
  }

  return {
    accessToken,
    refreshToken:
      optionalString(payload, "refresh_token") ??
      optionalString(authedUser, "refresh_token"),
    tokenType:
      optionalString(payload, "token_type") ??
      optionalString(authedUser, "token_type"),
    scope:
      optionalString(payload, "scope") ?? optionalString(authedUser, "scope"),
    expiresAt: expiresAt(authedUser?.expires_in ?? payload.expires_in),
    externalAccountId:
      optionalString(authedUser, "id") ?? optionalString(team, "id"),
    accountLabel:
      optionalString(team, "name") ?? optionalString(authedUser, "id"),
    metadata: {
      teamId: optionalString(team, "id"),
      teamName: optionalString(team, "name"),
      userId: optionalString(authedUser, "id"),
    },
  };
}

async function requestToken(
  url: string,
  init: { headers: Record<string, string>; body: URLSearchParams | string },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
      body: init.body,
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = asRecord(await response.json().catch(() => null));
    if (!response.ok || !payload) {
      throw new Error("The provider declined the authorization exchange.");
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
): string {
  const result = optionalString(value, key);
  if (!result) throw new Error(`Provider response did not include ${key}.`);
  return result;
}

function optionalString(
  value: Record<string, unknown> | null | undefined,
  key: string,
) {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate
    : null;
}

function expiresAt(value: unknown) {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(seconds)
    ? new Date(Date.now() + seconds * 1000).toISOString()
    : null;
}

function assertExpectedScopes(requested: string[], granted: string | null) {
  if (!requested.length) return;
  if (!compareGrantedScopes(requested, granted).matches) {
    throw new Error("Provider returned an unexpected scope set.");
  }
}
