export interface UntrustedConnectorExcerpt {
  workspaceId: string;
  sourceArtifactId: string;
  provider: string;
  plainText: string;
  sourceUrl: string | null;
  observedAt: string;
  trust: "untrusted_connector_content";
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_TAGS = /<[^>]*>/g;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,200}$/;

export const MAX_CONNECTOR_INPUT_BYTES = 16 * 1024;
export const MAX_CONNECTOR_OUTPUT_CHARACTERS = 4096;

const PROVIDER_HOSTS: Record<
  string,
  { exact: ReadonlySet<string>; suffixes?: readonly string[] }
> = {
  gmail: { exact: new Set(["mail.google.com"]) },
  calendar: { exact: new Set(["calendar.google.com"]) },
  drive: {
    exact: new Set(["drive.google.com", "docs.google.com"]),
  },
  slack: {
    exact: new Set(["app.slack.com", "slack.com"]),
    suffixes: [".slack.com"],
  },
  notion: { exact: new Set(["notion.so", "www.notion.so"]) },
  granola: { exact: new Set(["app.granola.ai", "granola.ai"]) },
  linkedin: { exact: new Set(["linkedin.com", "www.linkedin.com"]) },
};

export class ConnectorIngressValidationError extends Error {
  constructor(
    public readonly code:
      | "invalid_identifier"
      | "invalid_provider"
      | "invalid_timestamp"
      | "payload_too_large",
  ) {
    super(code);
    this.name = "ConnectorIngressValidationError";
  }
}

export function normalizeUntrustedExcerpt(input: {
  workspaceId: string;
  sourceArtifactId: string;
  provider: string;
  text: string;
  sourceUrl?: string | null;
  observedAt: string;
  maxLength?: number;
  encodedByteLength?: number;
}): UntrustedConnectorExcerpt {
  validateIngressMetadata(input);
  const maxLength = Math.min(
    Math.max(input.maxLength ?? MAX_CONNECTOR_OUTPUT_CHARACTERS, 1),
    MAX_CONNECTOR_OUTPUT_CHARACTERS,
  );
  const plainText = input.text
    .replace(CONTROL_CHARACTERS, "")
    .replace(HTML_TAGS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return {
    workspaceId: input.workspaceId,
    sourceArtifactId: input.sourceArtifactId,
    provider: input.provider,
    plainText,
    sourceUrl: normalizeSourceUrl(input.sourceUrl, input.provider),
    observedAt: input.observedAt,
    trust: "untrusted_connector_content",
  };
}

export function normalizeSourceUrl(
  value: string | null | undefined,
  provider: string,
) {
  if (!value) return null;
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    const policy = PROVIDER_HOSTS[provider];
    const hostname = url.hostname.toLowerCase();
    const allowedHost =
      policy?.exact.has(hostname) ||
      policy?.suffixes?.some((suffix) => hostname.endsWith(suffix));
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      allowedHost
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function validateIngressMetadata(input: {
  workspaceId: string;
  sourceArtifactId: string;
  provider: string;
  text: string;
  observedAt: string;
  encodedByteLength?: number;
}) {
  if (
    !IDENTIFIER.test(input.workspaceId) ||
    !IDENTIFIER.test(input.sourceArtifactId)
  ) {
    throw new ConnectorIngressValidationError("invalid_identifier");
  }
  if (!PROVIDER_HOSTS[input.provider]) {
    throw new ConnectorIngressValidationError("invalid_provider");
  }
  if (
    input.observedAt.length > 64 ||
    !Number.isFinite(new Date(input.observedAt).getTime())
  ) {
    throw new ConnectorIngressValidationError("invalid_timestamp");
  }
  if (
    input.text.length > MAX_CONNECTOR_INPUT_BYTES ||
    (input.encodedByteLength !== undefined &&
      input.encodedByteLength > MAX_CONNECTOR_INPUT_BYTES) ||
    new TextEncoder().encode(input.text).byteLength >
      MAX_CONNECTOR_INPUT_BYTES
  ) {
    throw new ConnectorIngressValidationError("payload_too_large");
  }
}
