type Environment = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackOrigin(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function isConnectorDevelopmentEnvironment(environment: Environment) {
  return (
    environment.NODE_ENV === "development" &&
    environment.WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION === "true" &&
    isLoopbackOrigin(environment.WORKLIFE_APP_URL)
  );
}

export function isAllowedConnectorRequestOrigin(
  requestOrigin: string,
  configuredOrigin: string | undefined,
) {
  if (
    !isLoopbackOrigin(requestOrigin) ||
    !isLoopbackOrigin(configuredOrigin)
  ) {
    return false;
  }
  return new URL(requestOrigin).origin === new URL(configuredOrigin!).origin;
}
