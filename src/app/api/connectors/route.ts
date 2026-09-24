import { getPublicConnectorStates } from "@/lib/connectors/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      connectors: getPublicConnectorStates(),
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
