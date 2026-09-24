import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { databaseConfigured } from "@/db";
import type { OAuthConnectorId } from "@/lib/connectors/providers";
import {
  createWorkspaceSession,
  readWorkspaceSession,
} from "@/lib/connectors/security";
import { ensureWorkspace } from "@/lib/connectors/store";

const THIRTY_DAYS = 30 * 24 * 60 * 60;
const TEN_MINUTES = 10 * 60;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function connectorAuthorizationEnabled() {
  return (
    !isProduction() &&
    process.env.WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION === "true"
  );
}

function cookiePrefix() {
  return isProduction() ? "__Host-" : "";
}

export function workspaceCookieName() {
  return `${cookiePrefix()}morrow-workspace`;
}

export function oauthCookieName(provider: OAuthConnectorId) {
  return `${cookiePrefix()}morrow-oauth-${provider}`;
}

export function getSessionSecret() {
  const secret = process.env.WORKLIFE_SESSION_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function getAppOrigin(request: NextRequest) {
  const configured = process.env.WORKLIFE_APP_URL?.trim();
  if (!configured) return request.nextUrl.origin;
  try {
    const url = new URL(configured);
    return url.origin;
  } catch {
    return request.nextUrl.origin;
  }
}

export function getConnectorRedirectUri(
  provider: OAuthConnectorId,
  request: NextRequest,
) {
  return new URL(
    `/api/connectors/${provider}/callback`,
    getAppOrigin(request),
  ).toString();
}

export async function ensureWorkspaceSession(request: NextRequest) {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error(
      "WORKLIFE_SESSION_SECRET must contain at least 32 characters.",
    );
  }
  if (!databaseConfigured) {
    throw new Error("DATABASE_URL is required for connector authorization.");
  }

  const existing = readWorkspaceSession(
    request.cookies.get(workspaceCookieName())?.value,
    secret,
  );
  const workspaceId = existing?.workspaceId ?? crypto.randomUUID();
  await ensureWorkspace(workspaceId);

  return {
    workspaceId,
    sessionToken:
      existing?.workspaceId === workspaceId
        ? null
        : createWorkspaceSession(workspaceId, secret),
  };
}

export function readWorkspaceId(request: NextRequest) {
  const secret = getSessionSecret();
  if (!secret) return null;
  return (
    readWorkspaceSession(
      request.cookies.get(workspaceCookieName())?.value,
      secret,
    )?.workspaceId ?? null
  );
}

export function setWorkspaceCookie(
  response: NextResponse,
  sessionToken: string | null,
) {
  if (!sessionToken) return;
  response.cookies.set(workspaceCookieName(), sessionToken, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS,
    priority: "high",
  });
}

export function setOAuthCookie(
  response: NextResponse,
  provider: OAuthConnectorId,
  value: string,
) {
  response.cookies.set(oauthCookieName(provider), value, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: TEN_MINUTES,
    priority: "high",
  });
}

export function clearOAuthCookie(
  response: NextResponse,
  provider: OAuthConnectorId,
) {
  response.cookies.set(oauthCookieName(provider), "", {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
