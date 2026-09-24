import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_TTL_MS = 10 * 60 * 1000;

interface SignedPayload {
  issuedAt: number;
  expiresAt: number;
}

export interface WorkspaceSession extends SignedPayload {
  workspaceId: string;
}

export interface OAuthTransaction extends SignedPayload {
  workspaceId: string;
  provider: string;
  state: string;
  verifier: string | null;
  returnTo: string;
  redirectUri: string;
  scopes: string[];
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function seal<T extends SignedPayload>(payload: T, secret: string) {
  const body = encode(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

function unseal<T extends SignedPayload>(
  value: string | undefined,
  secret: string,
  now = Date.now(),
): T | null {
  if (!value) return null;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra) return null;

  const expected = sign(body, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as T;
    if (
      typeof parsed.issuedAt !== "number" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createWorkspaceSession(
  workspaceId: string,
  secret: string,
  now = Date.now(),
) {
  return seal<WorkspaceSession>(
    {
      workspaceId,
      issuedAt: now,
      expiresAt: now + SESSION_TTL_MS,
    },
    secret,
  );
}

export function readWorkspaceSession(
  value: string | undefined,
  secret: string,
  now = Date.now(),
) {
  const session = unseal<WorkspaceSession>(value, secret, now);
  return session && typeof session.workspaceId === "string" ? session : null;
}

export function createOAuthTransaction(
  input: Omit<OAuthTransaction, "issuedAt" | "expiresAt">,
  secret: string,
  now = Date.now(),
) {
  return seal<OAuthTransaction>(
    {
      ...input,
      issuedAt: now,
      expiresAt: now + OAUTH_TTL_MS,
    },
    secret,
  );
}

export function readOAuthTransaction(
  value: string | undefined,
  secret: string,
  now = Date.now(),
) {
  const transaction = unseal<OAuthTransaction>(value, secret, now);
  if (
    !transaction ||
    typeof transaction.workspaceId !== "string" ||
    typeof transaction.provider !== "string" ||
    typeof transaction.state !== "string" ||
    (transaction.verifier !== null &&
      typeof transaction.verifier !== "string") ||
    typeof transaction.returnTo !== "string"
    || typeof transaction.redirectUri !== "string"
    || !Array.isArray(transaction.scopes)
    || !transaction.scopes.every((scope) => typeof scope === "string")
  ) {
    return null;
  }
  return transaction;
}

export function validateOAuthTransaction(
  transaction: OAuthTransaction | null,
  input: {
    workspaceId: string | null;
    provider: string;
    state: string | null;
  },
): transaction is OAuthTransaction {
  return Boolean(
    transaction &&
      input.workspaceId &&
      transaction.workspaceId === input.workspaceId &&
      transaction.provider === input.provider &&
      transaction.state === input.state,
  );
}

export function createPkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function createOAuthState() {
  return randomBytes(24).toString("base64url");
}

export function getOAuthExpiry(now = Date.now()) {
  return new Date(now + OAUTH_TTL_MS).toISOString();
}

export function hashOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export function parseEncryptionKey(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  const buffer = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  return buffer.length === 32 ? buffer : null;
}

export function compareGrantedScopes(
  requested: string[],
  granted: string | null,
) {
  const requestedSet = new Set(requested);
  const grantedSet = new Set(
    (granted ?? "")
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
  return {
    matches:
      granted !== null &&
      requested.every((scope) => grantedSet.has(scope)) &&
      [...grantedSet].every((scope) => requestedSet.has(scope)),
    missing: requested.filter((scope) => !grantedSet.has(scope)),
    unexpected: [...grantedSet].filter(
      (scope) => !requestedSet.has(scope),
    ),
  };
}

export function encryptSecret(value: string, rawKey: string) {
  const key = parseEncryptionKey(rawKey);
  if (!key) {
    throw new Error("CONNECTOR_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ["v1", encode(iv), encode(encrypted), encode(tag)].join(".");
}

export function decryptSecret(value: string, rawKey: string) {
  const key = parseEncryptionKey(rawKey);
  if (!key) {
    throw new Error("CONNECTOR_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  const [version, ivPart, encryptedPart, tagPart, extra] = value.split(".");
  if (
    version !== "v1" ||
    !ivPart ||
    !encryptedPart ||
    !tagPart ||
    extra
  ) {
    throw new Error("Unsupported encrypted connector secret.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
