import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser, serializeTags } from "@/lib/connections";
import { parseConnectionsCsv } from "@/lib/csv";

export async function POST(req: NextRequest) {
  const authResult = await requireUser();
  if ("error" in authResult) return authResult.error;

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
  }

  const text = await file.text();
  let rows;
  try {
    rows = parseConnectionsCsv(text);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not parse CSV file",
      },
      { status: 400 },
    );
  }

  if (!rows.length) {
    return NextResponse.json(
      {
        error:
          "No connections found in CSV. Export Connections.csv from LinkedIn.",
      },
      { status: 400 },
    );
  }

  let imported = 0;
  let updated = 0;

  for (const row of rows) {
    let existing =
      row.email != null
        ? await db
            .select()
            .from(connections)
            .where(
              and(
                eq(connections.userId, authResult.userId),
                eq(connections.email, row.email),
              ),
            )
            .limit(1)
        : [];

    if (!existing[0] && row.profileUrl) {
      existing = await db
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.userId, authResult.userId),
            eq(connections.profileUrl, row.profileUrl),
          ),
        )
        .limit(1);
    }

    if (!existing[0]) {
      const nameMatches = await db
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.userId, authResult.userId),
            eq(connections.firstName, row.firstName),
            eq(connections.lastName, row.lastName),
            row.company
              ? eq(connections.company, row.company)
              : isNull(connections.company),
          ),
        )
        .limit(1);
      existing = nameMatches;
    }

    if (existing[0]) {
      await db
        .update(connections)
        .set({
          company: row.company ?? existing[0].company,
          position: row.position ?? existing[0].position,
          connectedOn: row.connectedOn ?? existing[0].connectedOn,
          profileUrl: row.profileUrl ?? existing[0].profileUrl,
          email: row.email ?? existing[0].email,
          source: "csv",
          updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
        })
        .where(eq(connections.id, existing[0].id));
      updated += 1;
      continue;
    }

    await db.insert(connections).values({
      id: crypto.randomUUID(),
      userId: authResult.userId,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      company: row.company,
      position: row.position,
      connectedOn: row.connectedOn,
      profileUrl: row.profileUrl,
      tags: serializeTags([]),
      notes: "",
      status: "active",
      source: "csv",
    });
    imported += 1;
  }

  return NextResponse.json({
    ok: true,
    imported,
    updated,
    totalParsed: rows.length,
  });
}
