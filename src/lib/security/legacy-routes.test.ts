import { describe, expect, it } from "vitest";
import { unstable_doesProxyMatch } from "next/experimental/testing/server";
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
      unstable_doesProxyMatch({
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
      unstable_doesProxyMatch({
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
});
