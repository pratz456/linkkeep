import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/db";
import {
  normalizePerson,
  resolveUserIdFromWebhookKey,
  upsertPeople,
} from "@/lib/ingest";

export const runtime = "nodejs";

/**
 * Dux-Soup webhook receiver.
 * Configure in Dux-Soup → Options → Connect → Webhooks:
 *   https://YOUR_HOST/api/webhooks/duxsoup?key=YOUR_WEBHOOK_TOKEN
 *
 * Enable Visit + Scan (+ Action if you want accept events).
 */
export async function POST(req: NextRequest) {
  await ensureDb();

  const key = req.nextUrl.searchParams.get("key");
  const userId = await resolveUserIdFromWebhookKey(key);
  if (!userId) {
    return NextResponse.json({ error: "Invalid webhook key" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload = body as {
    type?: string;
    event?: string;
    data?: Record<string, unknown>;
  };

  // Ignore noise events
  if (payload.type === "session" || payload.type === "rccommand") {
    return NextResponse.json({ ok: true, ignored: payload.type });
  }

  const people = [];

  if (
    (payload.type === "visit" || payload.type === "scan") &&
    payload.data &&
    typeof payload.data === "object"
  ) {
    // Prefer 1st-degree when Degree is present
    const degree = payload.data.Degree;
    if (typeof degree === "string" && degree && !/^1/i.test(degree)) {
      return NextResponse.json({
        ok: true,
        skipped: "not_first_degree",
        degree,
      });
    }
    const person = normalizePerson(payload.data);
    if (person) people.push(person);
  }

  if (payload.type === "action" && payload.data) {
    const name = payload.data.name;
    // When someone accepts / connects, create a stub from target URL if present
    if (
      (name === "connectProfile" || name === "disconnectProfile") &&
      typeof payload.data.targeturl === "string"
    ) {
      const person = normalizePerson({
        Profile: payload.data.targeturl,
        profileid: payload.data.profileid,
        firstName: "LinkedIn",
        lastName: "Connection",
      });
      if (person) people.push(person);
    }
  }

  if (payload.type === "message" && payload.data) {
    const data = payload.data;
    if (payload.event === "received") {
      const person = normalizePerson({
        "First Name": data.fromFirstName,
        "Last Name": data.fromLastName,
        Profile: data.from,
        id: data.fromId,
        timestamp: data.timestamp,
      });
      if (person) {
        person.lastContactedAt =
          typeof data.timestamp === "string"
            ? data.timestamp.slice(0, 10)
            : null;
        people.push(person);
      }
    }
    if (payload.event === "sent") {
      const person = normalizePerson({
        "First Name": data.toFirstName,
        "Last Name": data.toLastName,
        Profile: data.to,
        id: data.toId,
        timestamp: data.timestamp,
      });
      if (person) {
        person.lastContactedAt =
          typeof data.timestamp === "string"
            ? data.timestamp.slice(0, 10)
            : null;
        people.push(person);
      }
    }
  }

  // Also accept a batch array for Zapier-style forwarding
  if (Array.isArray(body)) {
    for (const row of body) {
      if (row && typeof row === "object") {
        const person = normalizePerson(row as Record<string, unknown>);
        if (person) people.push(person);
      }
    }
  }

  if (!people.length) {
    return NextResponse.json({ ok: true, imported: 0, updated: 0 });
  }

  const result = await upsertPeople(userId, people, "duxsoup");
  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  return NextResponse.json({
    service: "LinkKeep Dux-Soup webhook",
    usage:
      "POST events from Dux-Soup Options → Connect. Append ?key=YOUR_TOKEN",
  });
}
