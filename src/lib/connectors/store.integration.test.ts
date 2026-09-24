import { afterEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { SQL } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import {
  executeConnectorAccountWithInitialJob,
  type ConnectorAuthorizationWrite,
} from "@/lib/connectors/store";

const clients: PGlite[] = [];

const input: ConnectorAuthorizationWrite = {
  workspaceId: "workspace-1",
  provider: "slack",
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

async function createDatabase(options?: { rejectJobs?: boolean }) {
  const client = new PGlite();
  clients.push(client);
  await client.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE "connectorAccounts" (
      id TEXT PRIMARY KEY,
      "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      "externalAccountId" TEXT,
      "accountLabel" TEXT,
      "accessTokenEncrypted" TEXT NOT NULL,
      "refreshTokenEncrypted" TEXT,
      "keyVersion" TEXT NOT NULL,
      "tokenGeneration" INTEGER NOT NULL,
      "tokenType" TEXT,
      scope TEXT,
      "expiresAt" TIMESTAMPTZ,
      "metadataJson" TEXT NOT NULL,
      "authorizedAt" TIMESTAMPTZ NOT NULL,
      "lastSyncedAt" TIMESTAMPTZ,
      "updatedAt" TIMESTAMPTZ NOT NULL,
      UNIQUE ("workspaceId", provider)
    );
    CREATE TABLE "connectorSyncJobs" (
      id TEXT PRIMARY KEY,
      "connectorAccountId" TEXT NOT NULL
        REFERENCES "connectorAccounts"(id) ON DELETE CASCADE,
      "jobType" TEXT NOT NULL ${
        options?.rejectJobs
          ? "CHECK (\"jobType\" <> 'connector.initial_backfill')"
          : ""
      },
      status TEXT NOT NULL,
      "idempotencyKey" TEXT NOT NULL UNIQUE,
      "payloadJson" TEXT NOT NULL,
      "attemptCount" INTEGER NOT NULL,
      "maxAttempts" INTEGER NOT NULL,
      "runAfter" TIMESTAMPTZ NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL
    );
    INSERT INTO workspaces (id) VALUES ('workspace-1');
  `);
  const database = drizzle(client);
  const execute = async (query: SQL) => {
    const result = await database.execute(query);
    return { rows: result.rows as Array<Record<string, unknown>> };
  };
  return { client, execute };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("atomic connector persistence against PostgreSQL semantics", () => {
  it("returns the persisted winner ID and queues both concurrent grants", async () => {
    const { client, execute } = await createDatabase();
    const ids = await Promise.all([
      executeConnectorAccountWithInitialJob(execute, input),
      executeConnectorAccountWithInitialJob(execute, {
        ...input,
        idempotencyKey: "oauth:slack:workspace-1:state-2",
      }),
    ]);
    const accounts = await client.query<{ id: string }>(
      'SELECT id FROM "connectorAccounts"',
    );
    const jobs = await client.query<{ connectorAccountId: string }>(
      'SELECT "connectorAccountId" FROM "connectorSyncJobs" ORDER BY id',
    );

    expect(accounts.rows).toHaveLength(1);
    expect(ids).toEqual([accounts.rows[0].id, accounts.rows[0].id]);
    expect(jobs.rows).toHaveLength(2);
    expect(
      jobs.rows.every(
        (job) => job.connectorAccountId === accounts.rows[0].id,
      ),
    ).toBe(true);
  });

  it("rolls back the account when the initial job insert fails", async () => {
    const { client, execute } = await createDatabase({ rejectJobs: true });

    await expect(
      executeConnectorAccountWithInitialJob(execute, input),
    ).rejects.toThrow();
    const accounts = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM "connectorAccounts"',
    );
    expect(accounts.rows[0].count).toBe(0);
  });
});
