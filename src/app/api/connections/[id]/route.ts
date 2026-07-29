import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { connections } from "@/db/schema";
import {
  connectionToJson,
  requireUser,
  serializeTags,
} from "@/lib/connections";

const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().optional(),
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

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const authResult = await requireUser();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  const [row] = await db
    .select()
    .from(connections)
    .where(
      and(eq(connections.id, id), eq(connections.userId, authResult.userId)),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(connectionToJson(row));
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const authResult = await requireUser();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (data.firstName !== undefined) updates.firstName = data.firstName;
  if (data.lastName !== undefined) updates.lastName = data.lastName;
  if (data.email !== undefined) updates.email = data.email || null;
  if (data.company !== undefined) updates.company = data.company || null;
  if (data.position !== undefined) updates.position = data.position || null;
  if (data.connectedOn !== undefined)
    updates.connectedOn = data.connectedOn || null;
  if (data.profileUrl !== undefined)
    updates.profileUrl = data.profileUrl || null;
  if (data.tags !== undefined) updates.tags = serializeTags(data.tags);
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.status !== undefined) updates.status = data.status;
  if (data.lastContactedAt !== undefined)
    updates.lastContactedAt = data.lastContactedAt || null;

  const result = await db
    .update(connections)
    .set(updates)
    .where(
      and(eq(connections.id, id), eq(connections.userId, authResult.userId)),
    )
    .returning();

  if (!result[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(connectionToJson(result[0]));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const authResult = await requireUser();
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  const result = await db
    .delete(connections)
    .where(
      and(eq(connections.id, id), eq(connections.userId, authResult.userId)),
    )
    .returning();

  if (!result[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
