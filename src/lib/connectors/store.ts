import "server-only";

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, ensureConnectorDb } from "@/db";
import {
  connectorAccounts,
  connectorOAuthStates,
  workspaces,
} from "@/db/schema";
import type { ConnectorAccountSummary } from "@/lib/connectors/status";
import type { OAuthConnectorId } from "@/lib/connectors/providers";
import { hashOAuthState } from "@/lib/connectors/security";

export async function ensureWorkspace(workspaceId: string) {
  await ensureConnectorDb();
  const now = new Date().toISOString();
  await db
    .insert(workspaces)
    .values({ id: workspaceId, updatedAt: now })
    .onConflictDoUpdate({
      target: workspaces.id,
      set: { updatedAt: now },
    });
}

export async function listConnectorAccounts(
  workspaceId: string,
): Promise<ConnectorAccountSummary[]> {
  await ensureConnectorDb();
  const rows = await db
    .select({
      provider: connectorAccounts.provider,
      accountLabel: connectorAccounts.accountLabel,
      authorizedAt: connectorAccounts.authorizedAt,
      lastSyncedAt: connectorAccounts.lastSyncedAt,
    })
    .from(connectorAccounts)
    .where(eq(connectorAccounts.workspaceId, workspaceId));

  return rows.map((row) => ({
    provider: row.provider as OAuthConnectorId,
    accountLabel: row.accountLabel,
    authorizedAt: row.authorizedAt,
    lastSyncedAt: row.lastSyncedAt,
  }));
}

export async function saveConnectorAccountWithInitialJob(input: {
  workspaceId: string;
  provider: OAuthConnectorId;
  externalAccountId: string | null;
  accountLabel: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenType: string | null;
  scope: string | null;
  expiresAt: string | null;
  metadataJson: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}) {
  await ensureConnectorDb();
  const now = new Date().toISOString();
  const accountId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const keyVersion =
    process.env.CONNECTOR_ENCRYPTION_KEY_VERSION?.trim() || "local-v1";
  const result = await db.execute<{ id: string }>(sql`
    WITH upserted AS (
      INSERT INTO "connectorAccounts" (
        id,
        "workspaceId",
        provider,
        "externalAccountId",
        "accountLabel",
        "accessTokenEncrypted",
        "refreshTokenEncrypted",
        "keyVersion",
        "tokenGeneration",
        "tokenType",
        scope,
        "expiresAt",
        "metadataJson",
        "authorizedAt",
        "lastSyncedAt",
        "updatedAt"
      )
      VALUES (
        ${accountId},
        ${input.workspaceId},
        ${input.provider},
        ${input.externalAccountId},
        ${input.accountLabel},
        ${input.accessTokenEncrypted},
        ${input.refreshTokenEncrypted},
        ${keyVersion},
        1,
        ${input.tokenType},
        ${input.scope},
        ${input.expiresAt},
        ${input.metadataJson},
        ${now},
        NULL,
        ${now}
      )
      ON CONFLICT ("workspaceId", provider) DO UPDATE SET
        "externalAccountId" = EXCLUDED."externalAccountId",
        "accountLabel" = EXCLUDED."accountLabel",
        "accessTokenEncrypted" = EXCLUDED."accessTokenEncrypted",
        "refreshTokenEncrypted" = CASE
          WHEN EXCLUDED."refreshTokenEncrypted" IS NOT NULL
            THEN EXCLUDED."refreshTokenEncrypted"
          WHEN "connectorAccounts"."externalAccountId" IS NOT NULL
            AND "connectorAccounts"."externalAccountId"
              IS NOT DISTINCT FROM EXCLUDED."externalAccountId"
            AND "connectorAccounts".scope IS NOT DISTINCT FROM EXCLUDED.scope
            THEN "connectorAccounts"."refreshTokenEncrypted"
          ELSE NULL
        END,
        "keyVersion" = EXCLUDED."keyVersion",
        "tokenGeneration" = "connectorAccounts"."tokenGeneration" + 1,
        "tokenType" = EXCLUDED."tokenType",
        scope = EXCLUDED.scope,
        "expiresAt" = EXCLUDED."expiresAt",
        "metadataJson" = EXCLUDED."metadataJson",
        "authorizedAt" = EXCLUDED."authorizedAt",
        "lastSyncedAt" = NULL,
        "updatedAt" = EXCLUDED."updatedAt"
      RETURNING id
    ),
    queued AS (
      INSERT INTO "connectorSyncJobs" (
        id,
        "connectorAccountId",
        "jobType",
        status,
        "idempotencyKey",
        "payloadJson",
        "attemptCount",
        "maxAttempts",
        "runAfter",
        "updatedAt"
      )
      SELECT
        ${jobId},
        id,
        'connector.initial_backfill',
        'queued',
        ${input.idempotencyKey},
        ${JSON.stringify(input.payload)},
        0,
        8,
        ${now},
        ${now}
      FROM upserted
      ON CONFLICT ("idempotencyKey") DO NOTHING
    )
    SELECT id FROM upserted
  `);

  const persistedId = result.rows[0]?.id;
  if (!persistedId) {
    throw new Error("Atomic connector persistence returned no account ID.");
  }
  return persistedId;
}

export async function deleteConnectorAccount(
  workspaceId: string,
  provider: OAuthConnectorId,
) {
  await ensureConnectorDb();
  await db
    .delete(connectorAccounts)
    .where(
      and(
        eq(connectorAccounts.workspaceId, workspaceId),
        eq(connectorAccounts.provider, provider),
      ),
    );
}

export async function registerOAuthState(input: {
  state: string;
  workspaceId: string;
  provider: OAuthConnectorId;
  expiresAt: string;
}) {
  await ensureConnectorDb();
  await db.insert(connectorOAuthStates).values({
    id: crypto.randomUUID(),
    stateHash: hashOAuthState(input.state),
    workspaceId: input.workspaceId,
    provider: input.provider,
    expiresAt: input.expiresAt,
  });
}

export async function consumeOAuthState(input: {
  state: string;
  workspaceId: string;
  provider: OAuthConnectorId;
}) {
  await ensureConnectorDb();
  const now = new Date().toISOString();
  const rows = await db
    .update(connectorOAuthStates)
    .set({ consumedAt: now })
    .where(
      and(
        eq(connectorOAuthStates.stateHash, hashOAuthState(input.state)),
        eq(connectorOAuthStates.workspaceId, input.workspaceId),
        eq(connectorOAuthStates.provider, input.provider),
        isNull(connectorOAuthStates.consumedAt),
        gt(connectorOAuthStates.expiresAt, now),
      ),
    )
    .returning({ id: connectorOAuthStates.id });
  return rows.length === 1;
}
