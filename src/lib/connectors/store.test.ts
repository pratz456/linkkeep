import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, ensureConnectorDb } = vi.hoisted(() => ({
  execute: vi.fn(),
  ensureConnectorDb: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({
  db: { execute },
  ensureConnectorDb,
}));

import { saveConnectorAccountWithInitialJob } from "@/lib/connectors/store";

const input = {
  workspaceId: "workspace-1",
  provider: "slack" as const,
  externalAccountId: "team-1",
  accountLabel: "Example",
  accessTokenEncrypted: "encrypted-access",
  refreshTokenEncrypted: "encrypted-refresh",
  tokenType: "bot",
  scope: "channels:history channels:read",
  expiresAt: null,
  metadataJson: "{}",
  idempotencyKey: "oauth:slack:workspace-1:state-1",
  payload: { provider: "slack", authorizationOnly: true },
};

describe("atomic connector persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the persisted upsert ID during concurrent writes", async () => {
    execute.mockResolvedValue({ rows: [{ id: "persisted-account-id" }] });

    const ids = await Promise.all([
      saveConnectorAccountWithInitialJob(input),
      saveConnectorAccountWithInitialJob({
        ...input,
        idempotencyKey: "oauth:slack:workspace-1:state-2",
      }),
    ]);

    expect(ids).toEqual(["persisted-account-id", "persisted-account-id"]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("uses one atomic database statement so queue failure cannot leave a saved grant", async () => {
    execute.mockRejectedValue(new Error("initial job insert failed"));

    await expect(
      saveConnectorAccountWithInitialJob(input),
    ).rejects.toThrow("initial job insert failed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails when the database returns no persisted account ID", async () => {
    execute.mockResolvedValue({ rows: [] });

    await expect(
      saveConnectorAccountWithInitialJob(input),
    ).rejects.toThrow("Atomic connector persistence returned no account ID.");
  });
});
