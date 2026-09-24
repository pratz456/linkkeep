import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  persist: vi.fn(),
  transaction: {
    workspaceId: "workspace-1",
    provider: "gmail",
    state: "state-1",
    verifier: "verifier-1",
    returnTo: "/",
    redirectUri: "http://localhost:3000/api/connectors/gmail/callback",
    scopes: ["https://www.googleapis.com/auth/gmail.metadata"],
    issuedAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/connectors/providers", () => ({
  isOAuthConnectorId: (value: string) => value === "gmail",
  getOAuthProviderConfig: () => ({
    id: "gmail",
    clientId: "client-id",
    clientSecret: "client-secret",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.metadata"],
    usePkce: true,
  }),
  exchangeAuthorizationCode: mocks.exchange,
}));
vi.mock("@/lib/connectors/security", () => ({
  readOAuthTransaction: () => mocks.transaction,
  validateOAuthTransaction: () => true,
  encryptSecret: (value: string) => `encrypted:${value}`,
}));
vi.mock("@/lib/connectors/session", () => ({
  connectorAuthorizationEnabled: () => true,
  getSessionSecret: () => "session-secret-with-more-than-32-characters",
  oauthCookieName: () => "morrow-oauth-gmail",
  readWorkspaceId: () => "workspace-1",
  getConnectorRedirectUri: () =>
    "http://localhost:3000/api/connectors/gmail/callback",
  getAppOrigin: () => "http://localhost:3000",
  clearOAuthCookie: vi.fn(),
}));
vi.mock("@/lib/connectors/store", () => ({
  consumeOAuthState: () => Promise.resolve(true),
  saveConnectorAccountWithInitialJob: mocks.persist,
}));

import { GET } from "@/app/api/connectors/[provider]/callback/route";

function request() {
  return new NextRequest(
    "http://localhost:3000/api/connectors/gmail/callback?state=state-1&code=code-1",
  );
}

const context = { params: Promise.resolve({ provider: "gmail" }) };

describe("OAuth callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CONNECTOR_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
    mocks.transaction.returnTo = "/";
    mocks.exchange.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      scope: "https://www.googleapis.com/auth/gmail.metadata",
      expiresAt: null,
      externalAccountId: null,
      accountLabel: "Google account",
      metadata: { scopeSource: "requested_scope_default" },
    });
    mocks.persist.mockResolvedValue("persisted-account-id");
  });

  it("persists then redirects to the canonical internal destination", async () => {
    const response = await GET(request(), context);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/?connector_connected=gmail",
    );
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        provider: "gmail",
        accessTokenEncrypted: "encrypted:access-token",
        idempotencyKey: "oauth:gmail:workspace-1:state-1",
      }),
    );
  });

  it("keeps provider exchange and persistence failures distinct", async () => {
    mocks.exchange.mockRejectedValueOnce(new Error("provider rejected code"));
    const exchangeFailure = await GET(request(), context);
    expect(exchangeFailure.headers.get("location")).toContain(
      "connector_error=authorization_exchange_failed",
    );
    expect(mocks.persist).not.toHaveBeenCalled();

    mocks.persist.mockRejectedValueOnce(new Error("atomic write failed"));
    const persistenceFailure = await GET(request(), context);
    expect(persistenceFailure.headers.get("location")).toContain(
      "connector_error=authorization_persistence_failed",
    );
  });

  it("revalidates a stored redirect before callback completion", async () => {
    mocks.transaction.returnTo = "/\\evil.example/phish";
    const response = await GET(request(), context);

    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/?connector_connected=gmail",
    );
  });
});
