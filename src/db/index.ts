import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(databaseUrl);
export const db = drizzle(sql, { schema });

let bootstrapped = false;

export async function ensureDb() {
  if (bootstrapped) return;

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

  await sql`CREATE INDEX IF NOT EXISTS connections_userId_idx ON connections("userId")`;
  await sql`CREATE INDEX IF NOT EXISTS connections_status_idx ON connections(status)`;

  // Additive migration for existing Neon DBs
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS "webhookToken" TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_webhookToken_uidx ON users("webhookToken")`;

  bootstrapped = true;
}
