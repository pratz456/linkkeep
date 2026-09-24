import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createTransaction: vi.fn(() => "sealed-transaction"),
  registerState: vi.fn(),
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
  buildAuthorizationUrl: ({ state }: { state: string }) =>
    new URL(
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    ),
}));
vi.mock("@/lib/connectors/security", () => ({
  createOAuthState: () => "state-1",
  createPkcePair: () => ({
    verifier: "verifier-1",
    challenge: "challenge-1",
  }),
  createOAuthTransaction: mocks.createTransaction,
  getOAuthExpiry: () => "2026-09-24T20:00:00.000Z",
}));
vi.mock("@/lib/connectors/session", () => ({
  connectorAuthorizationEnabled: () => true,
  getSessionSecret: () => "session-secret-with-more-than-32-characters",
  ensureWorkspaceSession: () =>
    Promise.resolve({
      workspaceId: "workspace-1",
      sessionToken: "workspace-session",
    }),
  getConnectorRedirectUri: () =>
    "http://localhost:3000/api/connectors/gmail/callback",
  setOAuthCookie: vi.fn(),
  setWorkspaceCookie: vi.fn(),
}));
vi.mock("@/lib/connectors/status", () => ({
  resolveConnectorStates: () => [
    { id: "gmail", status: "ready_to_connect", blockers: [] },
  ],
}));
vi.mock("@/lib/connectors/store", () => ({
  registerOAuthState: mocks.registerState,
}));

import { GET } from "@/app/api/connectors/[provider]/authorize/route";

describe("OAuth authorize route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registerState.mockResolvedValue(undefined);
  });

  it("starts authorization and binds only a safe internal return path", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/connectors/gmail/authorize?returnTo=/%5Cevil.example/phish",
    );
    const response = await GET(request, {
      params: Promise.resolve({ provider: "gmail" }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=state-1",
    );
    expect(mocks.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        provider: "gmail",
        returnTo: "/",
        redirectUri:
          "http://localhost:3000/api/connectors/gmail/callback",
        scopes: ["https://www.googleapis.com/auth/gmail.metadata"],
      }),
      "session-secret-with-more-than-32-characters",
    );
    expect(mocks.registerState).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "state-1",
        workspaceId: "workspace-1",
      }),
    );
  });
});
