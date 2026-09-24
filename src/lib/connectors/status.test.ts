import { describe, expect, it } from "vitest";
import { resolveConnectorStates } from "@/lib/connectors/status";

describe("resolveConnectorStates", () => {
  it("returns only redacted connector metadata", () => {
    const secret = "do-not-leak-this-secret";
    const connectors = resolveConnectorStates({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://configured",
      WORKLIFE_APP_URL: "http://localhost:3000",
      WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION: "true",
      WORKLIFE_SESSION_SECRET:
        "a-session-secret-that-is-at-least-32-characters",
      CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
      WORKLIFE_GMAIL_CLIENT_ID: "client-id",
      WORKLIFE_GMAIL_CLIENT_SECRET: secret,
      WORKLIFE_GMAIL_VERIFICATION_STATUS: "approved",
    });
    const gmail = connectors.find((connector) => connector.id === "gmail");

    expect(gmail?.status).toBe("ready_to_connect");
    expect(gmail?.lastSyncedAt).toBeNull();
    expect(gmail?.setupUrl).toBe("/api/connectors/gmail/authorize");
    expect(JSON.stringify(connectors)).not.toContain(secret);
    expect(JSON.stringify(connectors)).not.toContain(
      "WORKLIFE_GMAIL_CLIENT_SECRET",
    );
  });

  it("does not present unavailable providers as live", () => {
    const connectors = resolveConnectorStates({});

    expect(connectors.find((connector) => connector.id === "gmail")?.status).toBe(
      "needs_setup",
    );
    expect(
      connectors.find((connector) => connector.id === "granola")?.status,
    ).toBe("unavailable");
    expect(
      connectors.find((connector) => connector.id === "manual")?.status,
    ).toBe("local");
    expect(
      connectors.every((connector) => connector.lastSyncedAt === null),
    ).toBe(true);
  });

  it("surfaces overbroad configured scopes as a setup blocker", () => {
    const slack = resolveConnectorStates({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://configured",
      WORKLIFE_APP_URL: "http://localhost:3000",
      WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION: "true",
      WORKLIFE_SESSION_SECRET:
        "a-session-secret-that-is-at-least-32-characters",
      CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
      WORKLIFE_SLACK_CLIENT_ID: "client-id",
      WORKLIFE_SLACK_CLIENT_SECRET: "client-secret",
      WORKLIFE_SLACK_SIGNING_SECRET: "signing-secret",
      WORKLIFE_SLACK_BOT_SCOPES: "channels:read,chat:write",
    }).find((connector) => connector.id === "slack");

    expect(slack?.status).toBe("needs_setup");
    expect(slack?.blockers).toContain(
      "Slack scopes exceed the code-enforced selected-channel bot maximum",
    );
  });

  it("surfaces reused Google OAuth client IDs as a setup blocker", () => {
    const calendar = resolveConnectorStates({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://configured",
      WORKLIFE_APP_URL: "http://localhost:3000",
      WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION: "true",
      WORKLIFE_SESSION_SECRET:
        "a-session-secret-that-is-at-least-32-characters",
      CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
      WORKLIFE_GMAIL_CLIENT_ID: "same-client",
      WORKLIFE_GMAIL_CLIENT_SECRET: "gmail-secret",
      WORKLIFE_CALENDAR_CLIENT_ID: "same-client",
      WORKLIFE_CALENDAR_CLIENT_SECRET: "calendar-secret",
    }).find((connector) => connector.id === "calendar");

    expect(calendar?.status).toBe("needs_setup");
    expect(calendar?.blockers).toContain(
      "Google connector OAuth client IDs must be pairwise distinct",
    );
  });

  it("never promotes stored authorization to live without a verified worker", () => {
    const environment = {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://configured",
      WORKLIFE_APP_URL: "http://localhost:3000",
      WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION: "true",
      WORKLIFE_SESSION_SECRET:
        "a-session-secret-that-is-at-least-32-characters",
      CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
      WORKLIFE_SLACK_CLIENT_ID: "client-id",
      WORKLIFE_SLACK_CLIENT_SECRET: "client-secret",
      WORKLIFE_SLACK_SIGNING_SECRET: "signing-secret",
    };

    const authorized = resolveConnectorStates(environment, [
      {
        provider: "slack",
        accountLabel: "Example workspace",
        authorizedAt: "2026-09-24T12:00:00.000Z",
        lastSyncedAt: null,
      },
    ]).find((connector) => connector.id === "slack");
    const previouslySynced = resolveConnectorStates(environment, [
      {
        provider: "slack",
        accountLabel: "Example workspace",
        authorizedAt: "2026-09-24T12:00:00.000Z",
        lastSyncedAt: "2026-09-24T12:05:00.000Z",
      },
    ]).find((connector) => connector.id === "slack");

    expect(authorized?.status).toBe("authorized");
    expect(previouslySynced?.status).toBe("authorized");
    expect(previouslySynced?.blockers).toContain(
      "Verified durable sync worker with authenticated capability handshake",
    );
  });

  it.each(["production", "staging", "test"])(
    "never advertises readiness in NODE_ENV=%s",
    (nodeEnv) => {
    const gmail = resolveConnectorStates({
      NODE_ENV: nodeEnv,
      DATABASE_URL: "postgres://configured",
      WORKLIFE_APP_URL: "https://morrow.example",
      WORKLIFE_SESSION_SECRET:
        "a-session-secret-that-is-at-least-32-characters",
      CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
      WORKLIFE_GMAIL_CLIENT_ID: "client-id",
      WORKLIFE_GMAIL_CLIENT_SECRET: "client-secret",
      WORKLIFE_GMAIL_VERIFICATION_STATUS: "approved",
      WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION: "true",
    }).find((connector) => connector.id === "gmail");

    expect(gmail?.status).toBe("needs_setup");
    expect(gmail?.setupUrl).toBeNull();
    expect(gmail?.blockers).toContain(
      "Loopback development environment only; production/staging identity, tenant isolation, KMS encryption, verified webhooks, and deletion controls remain required",
    );
    },
  );
});
