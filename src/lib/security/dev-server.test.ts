import { describe, expect, it } from "vitest";
import {
  DEV_HOST,
  buildDevArguments,
  validateDevArguments,
} from "../../../scripts/dev-server.mjs";

describe("development server network boundary", () => {
  it("always binds the repository dev command to IPv4 loopback", () => {
    expect(DEV_HOST).toBe("127.0.0.1");
    expect(buildDevArguments(["--port", "3103"])).toEqual([
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3103",
    ]);
  });

  it.each([
    ["--hostname", "0.0.0.0"],
    ["-H", "::"],
    ["-H0.0.0.0"],
    ["-H=0.0.0.0"],
    ["--hostname=172.30.0.2"],
  ])("rejects hostname override arguments: %s", (...args) => {
    expect(() => validateDevArguments(args)).toThrow(
      "Development hostname overrides are disabled",
    );
  });
});
