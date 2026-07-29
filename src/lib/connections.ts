import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureDb } from "@/db";

export async function requireUser() {
  await ensureDb();
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: session.user.id, session };
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

export function serializeTags(tags: unknown): string {
  if (!Array.isArray(tags)) return "[]";
  return JSON.stringify(
    tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

export function connectionToJson(row: {
  id: string;
  userId: string;
  linkedinId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null;
  profileUrl: string | null;
  tags: string;
  notes: string;
  status: string;
  lastContactedAt: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    ...row,
    tags: parseTags(row.tags),
    fullName: `${row.firstName} ${row.lastName}`.trim(),
  };
}
