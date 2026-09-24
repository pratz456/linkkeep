import "server-only";

import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { db, ensureConnectorDb } from "@/db";
import {
  connectorAccounts,
  connectorItems,
  connectorOAuthStates,
  connectorSyncJobs,
  workspaces,
  type ConnectorAccount,
} from "@/db/schema";
import type { ConnectorAccountSummary } from "@/lib/connectors/status";
import type { OAuthConnectorId } from "@/lib/connectors/providers";
import { hashOAuthState } from "@/lib/connectors/security";

export interface ConnectorItemInput {
  externalId: string;
  itemType: "task" | "schedule" | "follow_up";
  dataJson: string;
  sourceUpdatedAt: string | null;
}

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

export async function getConnectorAccount(
  workspaceId: string,
  provider: OAuthConnectorId,
): Promise<ConnectorAccount | null> {
  await ensureConnectorDb();
  const rows = await db
    .select()
    .from(connectorAccounts)
    .where(
      and(
        eq(connectorAccounts.workspaceId, workspaceId),
        eq(connectorAccounts.provider, provider),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listConnectorAccountRecords(workspaceId: string) {
  await ensureConnectorDb();
  return db
    .select()
    .from(connectorAccounts)
    .where(eq(connectorAccounts.workspaceId, workspaceId))
    .orderBy(asc(connectorAccounts.provider));
}

export async function saveConnectorAccount(input: {
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
}) {
  await ensureConnectorDb();
  const existing = await getConnectorAccount(input.workspaceId, input.provider);
  const now = new Date().toISOString();
  const values = {
    id: existing?.id ?? crypto.randomUUID(),
    ...input,
    refreshTokenEncrypted:
      input.refreshTokenEncrypted ?? existing?.refreshTokenEncrypted ?? null,
    keyVersion:
      process.env.CONNECTOR_ENCRYPTION_KEY_VERSION?.trim() || "local-v1",
    tokenGeneration: (existing?.tokenGeneration ?? 0) + 1,
    authorizedAt: now,
    lastSyncedAt: null,
    updatedAt: now,
  };

  await db
    .insert(connectorAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: [
        connectorAccounts.workspaceId,
        connectorAccounts.provider,
      ],
      set: {
        externalAccountId: values.externalAccountId,
        accountLabel: values.accountLabel,
        accessTokenEncrypted: values.accessTokenEncrypted,
        refreshTokenEncrypted: values.refreshTokenEncrypted,
        keyVersion: values.keyVersion,
        tokenGeneration: values.tokenGeneration,
        tokenType: values.tokenType,
        scope: values.scope,
        expiresAt: values.expiresAt,
        metadataJson: values.metadataJson,
        authorizedAt: values.authorizedAt,
        lastSyncedAt: null,
        updatedAt: values.updatedAt,
      },
    });

  return values.id;
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

export async function replaceConnectorItems(
  account: ConnectorAccount,
  items: ConnectorItemInput[],
) {
  await ensureConnectorDb();
  await db
    .delete(connectorItems)
    .where(eq(connectorItems.connectorAccountId, account.id));

  if (items.length) {
    const now = new Date().toISOString();
    await db.insert(connectorItems).values(
      items.map((item) => ({
        id: crypto.randomUUID(),
        workspaceId: account.workspaceId,
        connectorAccountId: account.id,
        provider: account.provider,
        externalId: item.externalId,
        itemType: item.itemType,
        dataJson: item.dataJson,
        sourceUpdatedAt: item.sourceUpdatedAt,
        updatedAt: now,
      })),
    );
  }
}

export async function listWorkspaceConnectorItems(workspaceId: string) {
  await ensureConnectorDb();
  return db
    .select()
    .from(connectorItems)
    .where(eq(connectorItems.workspaceId, workspaceId))
    .orderBy(asc(connectorItems.sourceUpdatedAt));
}

export async function markConnectorSynced(connectorAccountId: string) {
  await ensureConnectorDb();
  const now = new Date().toISOString();
  await db
    .update(connectorAccounts)
    .set({ lastSyncedAt: now, updatedAt: now })
    .where(eq(connectorAccounts.id, connectorAccountId));
  await db
    .update(connectorSyncJobs)
    .set({
      status: "completed",
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(connectorSyncJobs.connectorAccountId, connectorAccountId),
        eq(connectorSyncJobs.status, "queued"),
      ),
    );
  return now;
}

export async function updateConnectorTokens(
  connectorAccountId: string,
  input: {
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string | null;
    expiresAt: string | null;
    scope?: string | null;
  },
) {
  await ensureConnectorDb();
  const current = await db
    .select()
    .from(connectorAccounts)
    .where(eq(connectorAccounts.id, connectorAccountId))
    .limit(1);
  if (!current[0]) {
    throw new Error("Connector account no longer exists.");
  }
  await db
    .update(connectorAccounts)
    .set({
      accessTokenEncrypted: input.accessTokenEncrypted,
      refreshTokenEncrypted:
        input.refreshTokenEncrypted === undefined
          ? current[0].refreshTokenEncrypted
          : input.refreshTokenEncrypted,
      expiresAt: input.expiresAt,
      scope: input.scope ?? current[0].scope,
      tokenGeneration: current[0].tokenGeneration + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(connectorAccounts.id, connectorAccountId));
}

export async function enqueueConnectorSyncJob(input: {
  connectorAccountId: string;
  jobType:
    | "connector.initial_backfill"
    | "connector.delta_sync"
    | "connector.reconcile"
    | "connector.refresh_token"
    | "connector.renew_subscription"
    | "connector.disconnect_and_purge";
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  runAfter?: string;
}) {
  await ensureConnectorDb();
  const now = new Date().toISOString();
  await db
    .insert(connectorSyncJobs)
    .values({
      id: crypto.randomUUID(),
      connectorAccountId: input.connectorAccountId,
      jobType: input.jobType,
      idempotencyKey: input.idempotencyKey,
      payloadJson: JSON.stringify(input.payload ?? {}),
      runAfter: input.runAfter ?? now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: connectorSyncJobs.idempotencyKey,
    });
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
