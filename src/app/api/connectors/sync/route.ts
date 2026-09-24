import { type NextRequest, NextResponse } from "next/server";
import {
  isOAuthConnectorId,
  type OAuthConnectorId,
} from "@/lib/connectors/providers";
import {
  mergeSyncedWorkspace,
  syncLocalConnectors,
} from "@/lib/connectors/local-sync";
import {
  connectorAuthorizationEnabled,
  getAppOrigin,
  readWorkspaceId,
} from "@/lib/connectors/session";
import { createDemoWorkspace } from "@/lib/workspace/demo-data";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (
    process.env.WORKLIFE_LOCAL_MODE !== "true" ||
    !connectorAuthorizationEnabled()
  ) {
    return NextResponse.json(
      { error: "Local connector sync is disabled." },
      { status: 404 },
    );
  }

  const requestOrigin = request.headers.get("origin");
  const expectedOrigin = getAppOrigin(request);
  if (
    requestOrigin &&
    requestOrigin !== request.nextUrl.origin &&
    requestOrigin !== expectedOrigin
  ) {
    return NextResponse.json(
      { error: "Cross-origin request rejected." },
      { status: 403 },
    );
  }

  const workspaceId = readWorkspaceId(request);
  if (!workspaceId) {
    return NextResponse.json(
      { error: "Workspace session is missing or expired." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const requestedProvider =
    body &&
    typeof body === "object" &&
    "provider" in body &&
    typeof body.provider === "string"
      ? body.provider
      : null;
  if (requestedProvider && !isOAuthConnectorId(requestedProvider)) {
    return NextResponse.json(
      { error: "Unknown connector." },
      { status: 400 },
    );
  }

  try {
    const outcomes = await syncLocalConnectors(
      workspaceId,
      (requestedProvider as OAuthConnectorId | null) ?? undefined,
    );
    const snapshot = await mergeSyncedWorkspace(
      workspaceId,
      createDemoWorkspace(),
    );
    return NextResponse.json(
      { outcomes, snapshot, syncedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Local connector sync could not run." },
      { status: 503 },
    );
  }
}
