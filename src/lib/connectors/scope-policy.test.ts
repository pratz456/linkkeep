import { describe, expect, it } from "vitest";
import {
  resolveGrantedScopes,
  resolveProviderScopes,
} from "@/lib/connectors/scope-policy";

describe("provider scope ceilings", () => {
  it("uses least-privilege defaults and accepts a subset of allowed scopes", () => {
    expect(resolveProviderScopes("gmail", undefined)).toEqual([
      "https://www.googleapis.com/auth/gmail.metadata",
    ]);
    expect(
      resolveProviderScopes("slack", "channels:read,app_mentions:read"),
    ).toEqual(["channels:read", "app_mentions:read"]);
  });

  it.each([
    ["gmail", "https://mail.google.com/"],
    ["gmail", "https://www.googleapis.com/auth/gmail.modify"],
    ["drive", "https://www.googleapis.com/auth/drive.readonly"],
    ["slack", "chat:write"],
    ["slack", "im:history"],
  ] as const)("rejects overbroad %s scope %s", (provider, scopes) => {
    expect(resolveProviderScopes(provider, scopes)).toBeNull();
  });

  it("accepts an omitted Google scope as the unchanged requested grant", () => {
    const requested = [
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ];

    expect(resolveGrantedScopes("calendar", null, requested)).toEqual({
      value: requested[0],
      source: "requested_scope_default",
    });
  });

  it("preserves an explicit scope response for mismatch validation", () => {
    expect(
      resolveGrantedScopes(
        "gmail",
        "https://www.googleapis.com/auth/gmail.readonly",
        ["https://www.googleapis.com/auth/gmail.metadata"],
      ),
    ).toEqual({
      value: "https://www.googleapis.com/auth/gmail.readonly",
      source: "provider_response",
    });
    expect(
      resolveGrantedScopes("slack", null, ["channels:read"]),
    ).toBeNull();
  });
});
