import { type NextRequest, NextResponse } from "next/server";
import { isOAuthConnectorId } from "@/lib/connectors/providers";
import {
  connectorAuthorizationEnabled,
  getAppOrigin,
  readWorkspaceId,
} from "@/lib/connectors/session";
import { deleteConnectorAccount } from "@/lib/connectors/store";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isOAuthConnectorId(provider)) {
    return NextResponse.json({ error: "Unknown connector." }, { status: 404 });
  }
  if (!connectorAuthorizationEnabled()) {
    return NextResponse.json(
      { error: "Connector authorization is disabled." },
      { status: 503 },
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

  try {
    await deleteConnectorAccount(workspaceId, provider);
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Connector could not be disconnected." },
      { status: 503 },
    );
  }
}
