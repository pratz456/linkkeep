import "server-only";

import { resolveConnectorStates } from "@/lib/connectors/status";

export function getPublicConnectorStates() {
  return resolveConnectorStates(process.env);
}
