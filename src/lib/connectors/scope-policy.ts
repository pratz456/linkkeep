export type ScopedConnectorId =
  | "gmail"
  | "calendar"
  | "drive"
  | "slack";

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
