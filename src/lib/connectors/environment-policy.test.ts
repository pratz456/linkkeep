import { describe, expect, it } from "vitest";
import {
  isAllowedConnectorRequestOrigin,
  isConnectorDevelopmentEnvironment,
  isLoopbackOrigin,
} from "@/lib/connectors/environment-policy";

const localEnvironment = {
  NODE_ENV: "development",
  WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION: "true",
  WORKLIFE_APP_URL: "http://localhost:3000",
};

describe("connector development environment gate", () => {
  it("allows only an explicitly enabled loopback development environment", () => {
    expect(isConnectorDevelopmentEnvironment(localEnvironment)).toBe(true);
    expect(
      isAllowedConnectorRequestOrigin(
        "http://localhost:3000",
        localEnvironment.WORKLIFE_APP_URL,
      ),
    ).toBe(true);
  });

  it.each(["production", "staging", "test", "preview", undefined])(
    "fails closed for NODE_ENV=%s",
    (nodeEnv) => {
      expect(
        isConnectorDevelopmentEnvironment({
          ...localEnvironment,
          NODE_ENV: nodeEnv,
        }),
      ).toBe(false);
    },
  );

  it("rejects public, malformed, credentialed, and origin-mismatched URLs", () => {
    expect(isLoopbackOrigin("https://staging.example.com")).toBe(false);
    expect(isLoopbackOrigin("not-a-url")).toBe(false);
    expect(isLoopbackOrigin("http://user:pass@localhost:3000")).toBe(false);
    expect(
      isAllowedConnectorRequestOrigin(
        "http://127.0.0.1:3000",
        "http://localhost:3000",
      ),
    ).toBe(false);
  });
});
