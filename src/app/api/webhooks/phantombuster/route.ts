import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/db";
import {
  normalizePerson,
  resolveUserIdFromWebhookKey,
  upsertPeople,
  type IngestPerson,
} from "@/lib/ingest";

export const runtime = "nodejs";

function collectPeople(payload: unknown): IngestPerson[] {
  const people: IngestPerson[] = [];

  const pushRow = (row: unknown) => {
    if (!row || typeof row !== "object") return;
    const person = normalizePerson(row as Record<string, unknown>);
    if (person) people.push(person);
  };

  if (Array.isArray(payload)) {
    payload.forEach(pushRow);
    return people;
  }

  if (!payload || typeof payload !== "object") return people;
  const body = payload as Record<string, unknown>;

  // PhantomBuster agent webhook shape
  let result = body.resultObject;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      result = null;
    }
  }

  if (Array.isArray(result)) {
    result.forEach(pushRow);
  } else if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.json)) obj.json.forEach(pushRow);
    else if (Array.isArray(obj.results)) obj.results.forEach(pushRow);
    else if (Array.isArray(obj.data)) obj.data.forEach(pushRow);
    else pushRow(obj);
  }

  // Direct batch under common keys
  for (const key of ["connections", "data", "results", "output", "items"]) {
    if (Array.isArray(body[key])) {
      (body[key] as unknown[]).forEach(pushRow);
    }
  }

  // Single person payload
  if (people.length === 0) {
    pushRow(body);
  }

  return people;
}

/**
 * PhantomBuster webhook receiver.
 * In your Phantom → Advanced settings → Webhooks → Custom webhook URL:
 *   https://YOUR_HOST/api/webhooks/phantombuster?key=YOUR_WEBHOOK_TOKEN
 *
 * Use with "LinkedIn Connections Export" (or any Phantom that outputs profile rows).
 * Schedule the Phantom daily/weekly for ongoing updates.
 */
export async function POST(req: NextRequest) {
  await ensureDb();

  const key = req.nextUrl.searchParams.get("key");
  const userId = await resolveUserIdFromWebhookKey(key);
  if (!userId) {
    return NextResponse.json({ error: "Invalid webhook key" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const people = collectPeople(body);

  if (!people.length) {
    return NextResponse.json({
      ok: true,
      imported: 0,
      updated: 0,
      note: "No profile rows found in payload",
    });
  }

  const result = await upsertPeople(userId, people, "phantombuster");
  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  return NextResponse.json({
    service: "LinkKeep PhantomBuster webhook",
    usage:
      "POST Phantom result payloads. Append ?key=YOUR_TOKEN. Schedule LinkedIn Connections Export for recurring sync.",
  });
}
