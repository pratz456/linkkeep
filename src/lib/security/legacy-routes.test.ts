import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";
import {
  LEGACY_ROUTE_PREFIXES,
  isLegacyRoute,
} from "@/lib/security/legacy-routes";

describe("legacy route release gate", () => {
  it.each([
    "/api/auth/session",
    "/api/connections",
    "/api/connections/import",
    "/api/demo-login",
    "/api/integrations",
    "/api/webhooks/duxsoup",
    "/api/webhooks/phantombuster",
  ])("unconditionally disables and matches %s", (pathname) => {
    expect(isLegacyRoute(pathname)).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: pathname,
      }),
    ).toBe(true);
  });

  it.each([
    "/",
    "/api/connectors",
    "/api/connectors/gmail/authorize",
  ])("does not block intended route %s", (pathname) => {
    expect(isLegacyRoute(pathname)).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: pathname,
      }),
    ).toBe(false);
  });

  it("keeps the release gate inventory explicit", () => {
    expect(LEGACY_ROUTE_PREFIXES).toEqual([
      "/api/auth",
      "/api/connections",
      "/api/demo-login",
      "/api/integrations",
      "/api/webhooks",
    ]);
  });

  it.each([
    "src/app/api/auth/[...nextauth]/route.ts",
    "src/app/api/connections/route.ts",
    "src/app/api/connections/[id]/route.ts",
    "src/app/api/connections/import/route.ts",
    "src/app/api/connections/sync/route.ts",
    "src/app/api/demo-login/route.ts",
    "src/app/api/integrations/route.ts",
    "src/app/api/webhooks/duxsoup/route.ts",
    "src/app/api/webhooks/phantombuster/route.ts",
  ])("does not compile removed legacy handler %s", (routePath) => {
    expect(existsSync(resolve(process.cwd(), routePath))).toBe(false);
  });
});
