export type ScopedConnectorId =
  | "gmail"
  | "calendar"
  | "drive"
  | "slack";
export type GoogleConnectorId = Exclude<ScopedConnectorId, "slack">;

const SCOPE_POLICY: Record<
  ScopedConnectorId,
  { defaults: readonly string[]; maximum: ReadonlySet<string> }
> = {
  gmail: {
    defaults: ["https://www.googleapis.com/auth/gmail.metadata"],
    maximum: new Set(["https://www.googleapis.com/auth/gmail.metadata"]),
  },
  calendar: {
    defaults: [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ],
    maximum: new Set([
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ]),
  },
  drive: {
    defaults: ["https://www.googleapis.com/auth/drive.file"],
    maximum: new Set(["https://www.googleapis.com/auth/drive.file"]),
  },
  slack: {
    defaults: [
      "channels:read",
      "channels:history",
      "groups:read",
      "groups:history",
      "users:read",
    ],
    maximum: new Set([
      "app_mentions:read",
      "channels:read",
      "channels:history",
      "groups:read",
      "groups:history",
      "users:read",
    ]),
  },
};

export function resolveProviderScopes(
  provider: ScopedConnectorId,
  configured: string | undefined,
) {
  const policy = SCOPE_POLICY[provider];
  const requested = configured?.trim()
    ? configured
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter(Boolean)
    : [...policy.defaults];
  const unique = [...new Set(requested)];

  return unique.length > 0 &&
    unique.every((scope) => policy.maximum.has(scope))
    ? unique
    : null;
}

export function resolveGrantedScopes(
  provider: ScopedConnectorId,
  reportedScope: string | null,
  requestedScopes: string[],
) {
  if (reportedScope?.trim()) {
    return {
      value: reportedScope,
      source: "provider_response" as const,
    };
  }

  if (
    provider === "gmail" ||
    provider === "calendar" ||
    provider === "drive"
  ) {
    return {
      value: requestedScopes.join(" "),
      source: "requested_scope_default" as const,
    };
  }

  return null;
}

export function resolveGoogleClientCredentials(
  provider: GoogleConnectorId,
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (!hasDistinctGoogleClientIds(environment)) return null;
  const prefix = `WORKLIFE_${provider.toUpperCase()}`;
  const clientId = environment[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = environment[`${prefix}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function hasDistinctGoogleClientIds(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const ids = (["GMAIL", "CALENDAR", "DRIVE"] as const)
    .map((provider) =>
      environment[`WORKLIFE_${provider}_CLIENT_ID`]?.trim(),
    )
    .filter((id): id is string => Boolean(id));
  return new Set(ids).size === ids.length;
}
