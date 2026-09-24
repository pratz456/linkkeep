import { describe, expect, it } from "vitest";
import {
  createOAuthTransaction,
  createPkcePair,
  createWorkspaceSession,
  compareGrantedScopes,
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
  readOAuthTransaction,
  readWorkspaceSession,
  validateOAuthTransaction,
} from "@/lib/connectors/security";

const signingSecret = "a-secure-test-secret-with-more-than-32-characters";
const encryptionKey = Buffer.alloc(32, 7).toString("base64");

describe("connector secret encryption", () => {
  it("round-trips secrets with authenticated encryption", () => {
    const encrypted = encryptSecret("provider-access-token", encryptionKey);

    expect(encrypted).not.toContain("provider-access-token");
    expect(decryptSecret(encrypted, encryptionKey)).toBe(
      "provider-access-token",
    );
  });

  it("rejects invalid keys and tampered ciphertext", () => {
    expect(parseEncryptionKey("too-short")).toBeNull();
    const encrypted = encryptSecret("provider-access-token", encryptionKey);
    const parts = encrypted.split(".");
    parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
    const tampered = parts.join(".");

    expect(() => decryptSecret(tampered, encryptionKey)).toThrow();
  });
});

describe("OAuth scope validation", () => {
  it("accepts the exact granted set independent of provider separators", () => {
    expect(
      compareGrantedScopes(
        ["calendar.events.readonly", "calendar.calendarlist.readonly"],
        "calendar.calendarlist.readonly,calendar.events.readonly",
      ),
    ).toEqual({
      matches: true,
      missing: [],
      unexpected: [],
    });
  });

  it("fails closed on missing or unexpectedly broad scopes", () => {
    expect(
      compareGrantedScopes(["gmail.metadata"], "gmail.readonly"),
    ).toMatchObject({
      matches: false,
      missing: ["gmail.metadata"],
      unexpected: ["gmail.readonly"],
    });
    expect(compareGrantedScopes(["gmail.metadata"], null).matches).toBe(false);
  });
});

describe("signed connector sessions", () => {
  it("verifies workspace sessions and rejects tampering or expiry", () => {
    const issuedAt = Date.UTC(2026, 8, 24, 12);
    const token = createWorkspaceSession(
      "workspace-1",
      signingSecret,
      issuedAt,
    );

    expect(
      readWorkspaceSession(token, signingSecret, issuedAt + 1000)?.workspaceId,
    ).toBe("workspace-1");
    expect(
      readWorkspaceSession(`${token}x`, signingSecret, issuedAt + 1000),
    ).toBeNull();
    expect(
      readWorkspaceSession(
        token,
        signingSecret,
        issuedAt + 31 * 24 * 60 * 60 * 1000,
      ),
    ).toBeNull();
  });

  it("binds OAuth state to a workspace and short expiry", () => {
    const issuedAt = Date.UTC(2026, 8, 24, 12);
    const transaction = createOAuthTransaction(
      {
        workspaceId: "workspace-1",
        provider: "gmail",
        state: "random-state",
        verifier: "pkce-verifier",
        returnTo: "/",
        redirectUri: "https://app.example/api/connectors/gmail/callback",
        scopes: ["gmail.metadata"],
      },
      signingSecret,
      issuedAt,
    );

    expect(
      readOAuthTransaction(
        transaction,
        signingSecret,
        issuedAt + 60_000,
      ),
    ).toMatchObject({
      workspaceId: "workspace-1",
      provider: "gmail",
      state: "random-state",
    });
    expect(
      readOAuthTransaction(
        transaction,
        signingSecret,
        issuedAt + 11 * 60_000,
      ),
    ).toBeNull();

    const parsed = readOAuthTransaction(
      transaction,
      signingSecret,
      issuedAt + 60_000,
    );
    expect(
      validateOAuthTransaction(parsed, {
        workspaceId: "workspace-1",
        provider: "gmail",
        state: "random-state",
      }),
    ).toBe(true);
    expect(
      validateOAuthTransaction(parsed, {
        workspaceId: "workspace-1",
        provider: "slack",
        state: "random-state",
      }),
    ).toBe(false);
    expect(
      validateOAuthTransaction(parsed, {
        workspaceId: "workspace-2",
        provider: "gmail",
        state: "random-state",
      }),
    ).toBe(false);
  });

  it("creates a valid S256 PKCE pair", () => {
    const pair = createPkcePair();

    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
