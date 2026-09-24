import { describe, expect, it } from "vitest";
import {
  canPreserveRefreshToken,
  normalizeScopeValue,
} from "@/lib/connectors/credential-policy";

describe("refresh-token preservation policy", () => {
  it("stores equivalent scope generations in canonical order", () => {
    expect(normalizeScopeValue("scope:b, scope:a scope:b")).toBe(
      "scope:a scope:b",
    );
    expect(normalizeScopeValue(null)).toBeNull();
  });

  it("preserves only for the same verified account and exact scope generation", () => {
    expect(
      canPreserveRefreshToken({
        existingExternalAccountId: "account-1",
        nextExternalAccountId: "account-1",
        existingScope: "scope:a scope:b",
        nextScope: "scope:b,scope:a",
      }),
    ).toBe(true);
  });

  it.each([
    [null, null, "scope:a", "scope:a"],
    ["account-1", null, "scope:a", "scope:a"],
    ["account-1", "account-2", "scope:a", "scope:a"],
    ["account-1", "account-1", "scope:a", "scope:a scope:b"],
    ["account-1", "account-1", "scope:a scope:b", "scope:a"],
  ])(
    "rejects unverified identity, account change, or scope change",
    (
      existingExternalAccountId,
      nextExternalAccountId,
      existingScope,
      nextScope,
    ) => {
      expect(
        canPreserveRefreshToken({
          existingExternalAccountId,
          nextExternalAccountId,
          existingScope,
          nextScope,
        }),
      ).toBe(false);
    },
  );
});
