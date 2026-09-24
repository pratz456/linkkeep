import { describe, expect, it } from "vitest";
import {
  safeReturnPath,
  safeReturnUrl,
} from "@/lib/connectors/redirect-policy";

describe("OAuth return destination policy", () => {
  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "/%5Cevil.example/phish",
    "/\u0000evil",
    "/not-allowed",
  ])("rejects external or non-allowlisted destination %s", (value) => {
    expect(safeReturnPath(value)).toBe("/");
    expect(
      safeReturnUrl(value, "https://morrow.example").origin,
    ).toBe("https://morrow.example");
  });

  it("allows only known root-view query parameters", () => {
    expect(
      safeReturnPath(
        "/?horizon=week&area=Personal&redirect=https://evil.example",
      ),
    ).toBe("/?horizon=week&area=Personal");
    expect(safeReturnPath("/?horizon=invalid&area=Unknown")).toBe("/");
  });
});
