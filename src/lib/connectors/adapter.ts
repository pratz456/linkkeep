import "server-only";

import type { OAuthConnectorId } from "@/lib/connectors/providers";

export type ConnectorJobType =
  | "connector.initial_backfill"
  | "connector.delta_sync"
  | "connector.reconcile"
  | "connector.refresh_token"
  | "connector.renew_subscription"
  | "connector.disconnect_and_purge";

export interface ConnectorJob {
  id: string;
  connectorAccountId: string;
  provider: OAuthConnectorId;
  type: ConnectorJobType;
  attempt: number;
  payload: Record<string, unknown>;
}

export interface ConnectorSyncResult {
  processed: number;
  nextCursor: string | null;
  nextRunAt: string | null;
  permissionCoverage: string[];
}

export interface ConnectorAdapter {
  readonly provider: OAuthConnectorId;
  run(job: ConnectorJob, signal: AbortSignal): Promise<ConnectorSyncResult>;
}

export class ConnectorWorkerUnavailableError extends Error {
  constructor(provider: OAuthConnectorId) {
    super(
      `${provider} authorization is stored, but no durable worker adapter is active.`,
    );
    this.name = "ConnectorWorkerUnavailableError";
  }
}
