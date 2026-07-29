import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { connections } from "@/db/schema";
import {
  connectionToJson,
  requireUser,
  serializeTags,
} from "@/lib/connections";

const createSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().default(""),
  email: z.string().email().optional().nullable().or(z.literal("")),
  company: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  connectedOn: z.string().optional().nullable(),
  profileUrl: z.string().url().optional().nullable().or(z.literal("")),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  status: z.enum(["active", "warm", "cold", "archived"]).optional(),
  lastContactedAt: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const authResult = await requireUser();
  if ("error" in authResult) return authResult.error;

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status");
  const tag = searchParams.get("tag")?.trim();

  const filters = [eq(connections.userId, authResult.userId)];

  if (status && ["active", "warm", "cold", "archived"].includes(status)) {
    filters.push(
      eq(
        connections.status,
        status as "active" | "warm" | "cold" | "archived",
      ),
    );
  }

  if (q) {
    const pattern = `%${q}%`;
    filters.push(
      or(
        like(connections.firstName, pattern),
        like(connections.lastName, pattern),
        like(connections.company, pattern),
        like(connections.position, pattern),
        like(connections.email, pattern),
        like(connections.notes, pattern),
      )!,
    );
  }

  if (tag) {
    filters.push(like(connections.tags, `%"${tag}"%`));
  }

  const rows = await db
    .select()
    .from(connections)
    .where(and(...filters))
    .orderBy(desc(connections.updatedAt));

  const counts = await db
    .select({
      status: connections.status,
      count: sql<number>`count(*)`,
    })
    .from(connections)
    .where(eq(connections.userId, authResult.userId))
    .groupBy(connections.status);

  return NextResponse.json({
    connections: rows.map(connectionToJson),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
    total: rows.length,
  });
}

export async function POST(req: NextRequest) {
  const authResult = await requireUser();
  if ("error" in authResult) return authResult.error;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const id = crypto.randomUUID();

  await db.insert(connections).values({
    id,
    userId: authResult.userId,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email || null,
    company: data.company || null,
    position: data.position || null,
    connectedOn: data.connectedOn || null,
    profileUrl: data.profileUrl || null,
    tags: serializeTags(data.tags ?? []),
    notes: data.notes ?? "",
    status: data.status ?? "active",
    lastContactedAt: data.lastContactedAt || null,
    source: "manual",
  });

  const [row] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, id))
    .limit(1);

  return NextResponse.json(connectionToJson(row!), { status: 201 });
}
