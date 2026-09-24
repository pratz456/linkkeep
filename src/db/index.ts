import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
export const databaseConfigured = Boolean(databaseUrl);
const unavailableDatabaseUrl =
  "postgresql://disabled:disabled@unconfigured.invalid/disabled";

const sql = neon(databaseUrl ?? unavailableDatabaseUrl);
export const db = drizzle(sql, { schema });

let bootstrapped = false;
let connectorBootstrapped = false;

export async function ensureConnectorDb() {
  if (connectorBootstrapped) return;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for connector storage.");
  }

  await sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "connectorAccounts" (
      id TEXT PRIMARY KEY,
      "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      "externalAccountId" TEXT,
      "accountLabel" TEXT,
      "accessTokenEncrypted" TEXT NOT NULL,
      "refreshTokenEncrypted" TEXT,
      "keyVersion" TEXT NOT NULL DEFAULT 'local-v1',
      "tokenGeneration" INTEGER NOT NULL DEFAULT 1,
      "tokenType" TEXT,
      scope TEXT,
      "expiresAt" TIMESTAMPTZ,
      "metadataJson" TEXT NOT NULL DEFAULT '{}',
      "authorizedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "lastSyncedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "connectorSyncJobs" (
      id TEXT PRIMARY KEY,
      "connectorAccountId" TEXT NOT NULL
        REFERENCES "connectorAccounts"(id) ON DELETE CASCADE,
      "jobType" TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      "idempotencyKey" TEXT NOT NULL,
      "payloadJson" TEXT NOT NULL DEFAULT '{}',
      "attemptCount" INTEGER NOT NULL DEFAULT 0,
      "maxAttempts" INTEGER NOT NULL DEFAULT 8,
      "runAfter" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "leaseOwner" TEXT,
      "leaseExpiresAt" TIMESTAMPTZ,
      "lastErrorCode" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    ALTER TABLE "connectorAccounts"
    ADD COLUMN IF NOT EXISTS "keyVersion" TEXT NOT NULL DEFAULT 'local-v1'
  `;
  await sql`
    ALTER TABLE "connectorAccounts"
    ADD COLUMN IF NOT EXISTS "tokenGeneration" INTEGER NOT NULL DEFAULT 1
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "syncCheckpoints" (
      id TEXT PRIMARY KEY,
      "connectorAccountId" TEXT NOT NULL
        REFERENCES "connectorAccounts"(id) ON DELETE CASCADE,
      "resourceType" TEXT NOT NULL,
      "externalResourceId" TEXT NOT NULL DEFAULT 'account',
      "cursorEncrypted" TEXT,
      "highWaterAt" TIMESTAMPTZ,
      "cursorVersion" INTEGER NOT NULL DEFAULT 1,
      "lastReconciledAt" TIMESTAMPTZ,
      "lastSuccessfulDeltaAt" TIMESTAMPTZ,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "connectorOAuthStates" (
      id TEXT PRIMARY KEY,
      "stateHash" TEXT NOT NULL,
      "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "consumedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS connectorAccounts_workspace_provider_uidx
    ON "connectorAccounts"("workspaceId", provider)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS connectorSyncJobs_idempotency_uidx
    ON "connectorSyncJobs"("idempotencyKey")
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS connectorSyncJobs_queue_idx
    ON "connectorSyncJobs"(status, "runAfter")
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS syncCheckpoints_account_resource_uidx
    ON "syncCheckpoints"("connectorAccountId", "resourceType", "externalResourceId")
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS connectorOAuthStates_hash_uidx
    ON "connectorOAuthStates"("stateHash")
  `;

  connectorBootstrapped = true;
}

export const legacyStorageEnabled = false;

export async function ensureDb() {
  if (!legacyStorageEnabled) {
    throw new Error("Legacy LinkKeep storage routes are disabled in Morrow.");
  }
  if (bootstrapped) return;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured; legacy connection storage is unavailable.",
    );
  }

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      "emailVerified" TIMESTAMPTZ,
      image TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS accounts (
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      provider TEXT NOT NULL,
      "providerAccountId" TEXT NOT NULL,
      refresh_token TEXT,
      access_token TEXT,
      expires_at INTEGER,
      token_type TEXT,
      scope TEXT,
      id_token TEXT,
      session_state TEXT,
      PRIMARY KEY (provider, "providerAccountId")
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      "sessionToken" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires TIMESTAMPTZ NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "verificationTokens" (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL,
      expires TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (identifier, token)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "linkedinId" TEXT,
      "firstName" TEXT NOT NULL,
      "lastName" TEXT NOT NULL DEFAULT '',
      email TEXT,
      company TEXT,
      position TEXT,
      "connectedOn" TEXT,
      "profileUrl" TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      "lastContactedAt" TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "connectorAccounts" (
      id TEXT PRIMARY KEY,
      "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      "externalAccountId" TEXT,
      "accountLabel" TEXT,
      "accessTokenEncrypted" TEXT NOT NULL,
      "refreshTokenEncrypted" TEXT,
      "keyVersion" TEXT NOT NULL DEFAULT 'local-v1',
      "tokenGeneration" INTEGER NOT NULL DEFAULT 1,
      "tokenType" TEXT,
      scope TEXT,
      "expiresAt" TIMESTAMPTZ,
      "metadataJson" TEXT NOT NULL DEFAULT '{}',
      "authorizedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "lastSyncedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "connectorSyncJobs" (
      id TEXT PRIMARY KEY,
      "connectorAccountId" TEXT NOT NULL
        REFERENCES "connectorAccounts"(id) ON DELETE CASCADE,
      "jobType" TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      "idempotencyKey" TEXT NOT NULL,
      "payloadJson" TEXT NOT NULL DEFAULT '{}',
      "attemptCount" INTEGER NOT NULL DEFAULT 0,
      "maxAttempts" INTEGER NOT NULL DEFAULT 8,
      "runAfter" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "leaseOwner" TEXT,
      "leaseExpiresAt" TIMESTAMPTZ,
      "lastErrorCode" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS "syncCheckpoints" (
      id TEXT PRIMARY KEY,
      "connectorAccountId" TEXT NOT NULL
        REFERENCES "connectorAccounts"(id) ON DELETE CASCADE,
      "resourceType" TEXT NOT NULL,
      "externalResourceId" TEXT NOT NULL DEFAULT 'account',
      "cursorEncrypted" TEXT,
      "highWaterAt" TIMESTAMPTZ,
      "cursorVersion" INTEGER NOT NULL DEFAULT 1,
      "lastReconciledAt" TIMESTAMPTZ,
      "lastSuccessfulDeltaAt" TIMESTAMPTZ,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS connections_userId_idx ON connections("userId")`;
  await sql`CREATE INDEX IF NOT EXISTS connections_status_idx ON connections(status)`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS connectorAccounts_workspace_provider_uidx
    ON "connectorAccounts"("workspaceId", provider)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS connectorSyncJobs_idempotency_uidx
    ON "connectorSyncJobs"("idempotencyKey")
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS connectorSyncJobs_queue_idx
    ON "connectorSyncJobs"(status, "runAfter")
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS syncCheckpoints_account_resource_uidx
    ON "syncCheckpoints"("connectorAccountId", "resourceType", "externalResourceId")
  `;

  // Additive migration for existing Neon DBs
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "webhookToken" TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_webhookToken_uidx ON users("webhookToken")`;

  bootstrapped = true;
}
