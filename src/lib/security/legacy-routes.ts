export const LEGACY_ROUTE_PREFIXES = [
  "/api/auth",
  "/api/connections",
  "/api/demo-login",
  "/api/integrations",
  "/api/webhooks",
] as const;

export function isLegacyRoute(pathname: string) {
  return LEGACY_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
