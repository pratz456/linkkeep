import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildAuthorizationUrl,
  getOAuthProviderConfig,
} from "@/lib/connectors/providers";

describe("isolated Google connector grants", () => {
  const environment = {
    WORKLIFE_GMAIL_CLIENT_ID: "gmail-client",
    WORKLIFE_GMAIL_CLIENT_SECRET: "gmail-secret",
    WORKLIFE_CALENDAR_CLIENT_ID: "calendar-client",
    WORKLIFE_CALENDAR_CLIENT_SECRET: "calendar-secret",
    WORKLIFE_DRIVE_CLIENT_ID: "drive-client",
    WORKLIFE_DRIVE_CLIENT_SECRET: "drive-secret",
  };

  it("builds sequential connector grants with distinct clients and exact scopes", () => {
    const providers = ["gmail", "calendar", "drive"] as const;
    const configs = providers.map((provider) => {
      const config = getOAuthProviderConfig(provider, environment);
      expect(config).not.toBeNull();
      return config!;
    });
    expect(configs.map((config) => config.clientId)).toEqual([
      "gmail-client",
      "calendar-client",
      "drive-client",
    ]);

    const urls = configs.map((config) =>
      buildAuthorizationUrl({
        config,
        redirectUri: `http://localhost:3000/api/connectors/${config.id}/callback`,
        state: `state-${config.id}`,
        codeChallenge: `challenge-${config.id}`,
      }),
    );
    expect(urls[0].searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.metadata",
    );
    expect(urls[1].searchParams.get("scope")?.split(" ").sort()).toEqual(
      [
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events.readonly",
      ].sort(),
    );
    expect(urls[2].searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(
      urls.every(
        (url) => !url.searchParams.has("include_granted_scopes"),
      ),
    ).toBe(true);
  });

  it("rejects the removed shared Google client fallback", () => {
    const legacy = {
      WORKLIFE_GOOGLE_CLIENT_ID: "shared-client",
      WORKLIFE_GOOGLE_CLIENT_SECRET: "shared-secret",
    };
    expect(getOAuthProviderConfig("gmail", legacy)).toBeNull();
    expect(getOAuthProviderConfig("calendar", legacy)).toBeNull();
    expect(getOAuthProviderConfig("drive", legacy)).toBeNull();
  });
});
