import { describe, expect, it } from "vitest";
import { resolveProviderScopes } from "@/lib/connectors/scope-policy";

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
});
