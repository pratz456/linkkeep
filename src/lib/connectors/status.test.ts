import { describe, expect, it } from "vitest";
import { resolveConnectorStates } from "@/lib/connectors/status";

describe("resolveConnectorStates", () => {
  it("returns only redacted connector metadata", () => {
    const secret = "do-not-leak-this-secret";
    const connectors = resolveConnectorStates({
      WORKLIFE_GMAIL_CLIENT_ID: "client-id",
      WORKLIFE_GMAIL_CLIENT_SECRET: secret,
      WORKLIFE_GMAIL_REDIRECT_URI: "https://example.com/callback",
    });
    const gmail = connectors.find((connector) => connector.id === "gmail");

    expect(gmail?.status).toBe("credentials_ready");
    expect(gmail?.lastSyncedAt).toBeNull();
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
});
