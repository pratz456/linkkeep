import type { NextRequest } from "next/server";
import { isLegacyRoute } from "@/lib/security/legacy-routes";

export function proxy(request: NextRequest) {
  if (!isLegacyRoute(request.nextUrl.pathname)) return;

  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const config = {
  matcher: [
    "/api/auth/:path*",
    "/api/connections/:path*",
    "/api/demo-login",
    "/api/integrations",
    "/api/webhooks/:path*",
  ],
};
