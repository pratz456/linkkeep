import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser, serializeTags } from "@/lib/connections";
import {
  fetchLinkedInConnections,
  getLinkedInAccessToken,
} from "@/lib/linkedin";

export async function POST() {
  const authResult = await requireUser();
  if ("error" in authResult) return authResult.error;

  const token = await getLinkedInAccessToken(authResult.userId);
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        code: "no_token",
        message:
          "No LinkedIn access token found. Sign in with LinkedIn first.",
      },
      { status: 400 },
    );
  }

  const result = await fetchLinkedInConnections(token);
  if (!result.ok) {
    return NextResponse.json(result, {
      status: result.code === "forbidden" ? 403 : 400,
    });
  }

  let imported = 0;
  let updated = 0;

  for (const item of result.items) {
    const existing = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.userId, authResult.userId),
          eq(connections.linkedinId, item.linkedinId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(connections)
        .set({
          firstName: item.firstName,
          lastName: item.lastName,
          position: item.headline ?? existing[0].position,
          source: "api",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(connections.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(connections).values({
        id: crypto.randomUUID(),
        userId: authResult.userId,
        linkedinId: item.linkedinId,
        firstName: item.firstName,
        lastName: item.lastName,
        position: item.headline ?? null,
        tags: serializeTags([]),
        notes: "",
        status: "active",
        source: "api",
      });
      imported += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    imported,
    updated,
    fetched: result.items.length,
    totalReported: result.total,
  });
}
