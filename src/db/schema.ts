import { relations } from "drizzle-orm";
import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  webhookToken: text("webhookToken").unique(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

export const connections = pgTable("connections", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  linkedinId: text("linkedinId"),
  firstName: text("firstName").notNull(),
  lastName: text("lastName").notNull().default(""),
  email: text("email"),
  company: text("company"),
  position: text("position"),
  connectedOn: text("connectedOn"),
  profileUrl: text("profileUrl"),
  tags: text("tags").notNull().default("[]"),
  notes: text("notes").notNull().default(""),
  status: text("status", {
    enum: ["active", "warm", "cold", "archived"],
  })
    .notNull()
    .default("active"),
  lastContactedAt: text("lastContactedAt"),
  source: text("source", {
    enum: ["csv", "api", "manual", "duxsoup", "phantombuster"],
  })
    .notNull()
    .default("manual"),
  createdAt: timestamp("createdAt", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "string" }).defaultNow().notNull(),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  createdAt: timestamp("createdAt", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "string" }).defaultNow().notNull(),
});

export const connectorAccounts = pgTable(
  "connectorAccounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalAccountId: text("externalAccountId"),
    accountLabel: text("accountLabel"),
    accessTokenEncrypted: text("accessTokenEncrypted").notNull(),
    refreshTokenEncrypted: text("refreshTokenEncrypted"),
    keyVersion: text("keyVersion").notNull().default("local-v1"),
    tokenGeneration: integer("tokenGeneration").notNull().default(1),
    tokenType: text("tokenType"),
    scope: text("scope"),
    expiresAt: timestamp("expiresAt", { mode: "string" }),
    metadataJson: text("metadataJson").notNull().default("{}"),
    authorizedAt: timestamp("authorizedAt", { mode: "string" })
      .defaultNow()
      .notNull(),
    lastSyncedAt: timestamp("lastSyncedAt", { mode: "string" }),
    createdAt: timestamp("createdAt", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "string" }).defaultNow().notNull(),
  },
  (account) => [
    uniqueIndex("connectorAccounts_workspace_provider_uidx").on(
      account.workspaceId,
      account.provider,
    ),
  ],
);

export const connectorSyncJobs = pgTable(
  "connectorSyncJobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    connectorAccountId: text("connectorAccountId")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    jobType: text("jobType").notNull(),
    status: text("status").notNull().default("queued"),
    idempotencyKey: text("idempotencyKey").notNull(),
    payloadJson: text("payloadJson").notNull().default("{}"),
    attemptCount: integer("attemptCount").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(8),
    runAfter: timestamp("runAfter", { mode: "string" }).defaultNow().notNull(),
    leaseOwner: text("leaseOwner"),
    leaseExpiresAt: timestamp("leaseExpiresAt", { mode: "string" }),
    lastErrorCode: text("lastErrorCode"),
    createdAt: timestamp("createdAt", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "string" }).defaultNow().notNull(),
  },
  (job) => [
    uniqueIndex("connectorSyncJobs_idempotency_uidx").on(job.idempotencyKey),
  ],
);

export const syncCheckpoints = pgTable(
  "syncCheckpoints",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    connectorAccountId: text("connectorAccountId")
      .notNull()
      .references(() => connectorAccounts.id, { onDelete: "cascade" }),
    resourceType: text("resourceType").notNull(),
    externalResourceId: text("externalResourceId").notNull().default("account"),
    cursorEncrypted: text("cursorEncrypted"),
    highWaterAt: timestamp("highWaterAt", { mode: "string" }),
    cursorVersion: integer("cursorVersion").notNull().default(1),
    lastReconciledAt: timestamp("lastReconciledAt", { mode: "string" }),
    lastSuccessfulDeltaAt: timestamp("lastSuccessfulDeltaAt", {
      mode: "string",
    }),
    updatedAt: timestamp("updatedAt", { mode: "string" }).defaultNow().notNull(),
  },
  (checkpoint) => [
    uniqueIndex("syncCheckpoints_account_resource_uidx").on(
      checkpoint.connectorAccountId,
      checkpoint.resourceType,
      checkpoint.externalResourceId,
    ),
  ],
);

export const connectorOAuthStates = pgTable(
  "connectorOAuthStates",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    stateHash: text("stateHash").notNull(),
    workspaceId: text("workspaceId")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    expiresAt: timestamp("expiresAt", { mode: "string" }).notNull(),
    consumedAt: timestamp("consumedAt", { mode: "string" }),
    createdAt: timestamp("createdAt", { mode: "string" }).defaultNow().notNull(),
  },
  (state) => [
    uniqueIndex("connectorOAuthStates_hash_uidx").on(state.stateHash),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  connections: many(connections),
}));

export const connectionsRelations = relations(connections, ({ one }) => ({
  user: one(users, {
    fields: [connections.userId],
    references: [users.id],
  }),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  connectorAccounts: many(connectorAccounts),
  oauthStates: many(connectorOAuthStates),
}));

export const connectorAccountsRelations = relations(
  connectorAccounts,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [connectorAccounts.workspaceId],
      references: [workspaces.id],
    }),
    syncJobs: many(connectorSyncJobs),
    syncCheckpoints: many(syncCheckpoints),
  }),
);

export const connectorSyncJobsRelations = relations(
  connectorSyncJobs,
  ({ one }) => ({
    connectorAccount: one(connectorAccounts, {
      fields: [connectorSyncJobs.connectorAccountId],
      references: [connectorAccounts.id],
    }),
  }),
);

export const syncCheckpointsRelations = relations(
  syncCheckpoints,
  ({ one }) => ({
    connectorAccount: one(connectorAccounts, {
      fields: [syncCheckpoints.connectorAccountId],
      references: [connectorAccounts.id],
    }),
  }),
);

export const connectorOAuthStatesRelations = relations(
  connectorOAuthStates,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [connectorOAuthStates.workspaceId],
      references: [workspaces.id],
    }),
  }),
);

export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type ConnectionStatus = Connection["status"];
export type ConnectorAccount = typeof connectorAccounts.$inferSelect;
