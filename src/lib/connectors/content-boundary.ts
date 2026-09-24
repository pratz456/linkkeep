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

export function normalizeUntrustedExcerpt(input: {
  workspaceId: string;
  sourceArtifactId: string;
  provider: string;
  text: string;
  sourceUrl?: string | null;
  observedAt: string;
  maxLength?: number;
}): UntrustedConnectorExcerpt {
  const maxLength = Math.min(Math.max(input.maxLength ?? 4096, 1), 4096);
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
    sourceUrl: normalizeSourceUrl(input.sourceUrl),
    observedAt: input.observedAt,
    trust: "untrusted_connector_content",
  };
}

export function normalizeSourceUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
