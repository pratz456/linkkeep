import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { connections, users } from "@/db/schema";
import { serializeTags } from "@/lib/connections";

export type IngestSource = "duxsoup" | "phantombuster" | "manual" | "csv" | "api";

export type IngestPerson = {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  company?: string | null;
  position?: string | null;
  connectedOn?: string | null;
  profileUrl?: string | null;
  linkedinId?: string | null;
  tags?: string[];
  notes?: string | null;
  lastContactedAt?: string | null;
};

function pickString(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function splitName(fullName: string | null) {
  if (!fullName) return { firstName: "Unknown", lastName: "" };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

/** Normalize messy PhantomBuster / Dux-Soup / Zapier field names into one shape. */
export function normalizePerson(raw: Record<string, unknown>): IngestPerson | null {
  const firstName =
    pickString(raw, [
      "firstName",
      "First Name",
      "first_name",
      "firstname",
    ]) ?? null;
  const lastName = pickString(raw, [
    "lastName",
    "Last Name",
    "last_name",
    "lastname",
  ]);
  const fullName = pickString(raw, [
    "fullName",
    "full_name",
    "name",
    "Name",
  ]);

  let first = firstName;
  let last = lastName ?? "";
  if (!first && fullName) {
    const split = splitName(fullName);
    first = split.firstName;
    last = split.lastName;
  }
  if (!first) return null;

  return {
    firstName: first,
    lastName: last,
    email: pickString(raw, ["email", "Email", "emailAddress", "Email Address"]),
    company: pickString(raw, [
      "company",
      "Company",
      "companyName",
      "company_name",
    ]),
    position: pickString(raw, [
      "position",
      "Title",
      "title",
      "jobTitle",
      "headline",
      "Headline",
    ]),
    connectedOn: pickString(raw, [
      "connectedOn",
      "Connected On",
      "connectionDate",
      "connection_date",
      "From",
    ]),
    profileUrl: pickString(raw, [
      "profileUrl",
      "Profile",
      "linkedinProfileUrl",
      "linkedinUrl",
      "profileUrl",
      "url",
      "URL",
      "linkedInProfileUrl",
    ]),
    linkedinId: pickString(raw, ["linkedinId", "id", "profileid", "profileId"]),
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string")
      : undefined,
    notes: pickString(raw, ["notes", "Notes"]),
    lastContactedAt: pickString(raw, ["lastContactedAt", "timestamp"]),
  };
}

export async function resolveUserIdFromWebhookKey(key: string | null) {
  if (!key) return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.webhookToken, key))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function upsertPeople(
  userId: string,
  people: IngestPerson[],
  source: IngestSource,
) {
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const person of people) {
    if (!person.firstName?.trim()) {
      skipped += 1;
      continue;
    }

    let existing =
      person.profileUrl != null
        ? await db
            .select()
            .from(connections)
            .where(
              and(
                eq(connections.userId, userId),
                eq(connections.profileUrl, person.profileUrl),
              ),
            )
            .limit(1)
        : [];

    if (!existing[0] && person.email) {
      existing = await db
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.userId, userId),
            eq(connections.email, person.email),
          ),
        )
        .limit(1);
    }

    if (!existing[0] && person.linkedinId) {
      existing = await db
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.userId, userId),
            eq(connections.linkedinId, person.linkedinId),
          ),
        )
        .limit(1);
    }

    if (existing[0]) {
      await db
        .update(connections)
        .set({
          firstName: person.firstName,
          lastName: person.lastName ?? existing[0].lastName,
          email: person.email ?? existing[0].email,
          company: person.company ?? existing[0].company,
          position: person.position ?? existing[0].position,
          connectedOn: person.connectedOn ?? existing[0].connectedOn,
          profileUrl: person.profileUrl ?? existing[0].profileUrl,
          linkedinId: person.linkedinId ?? existing[0].linkedinId,
          lastContactedAt:
            person.lastContactedAt ?? existing[0].lastContactedAt,
          notes: person.notes ?? existing[0].notes,
          tags: person.tags
            ? serializeTags(person.tags)
            : existing[0].tags,
          source,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(connections.id, existing[0].id));
      updated += 1;
      continue;
    }

    await db.insert(connections).values({
      id: crypto.randomUUID(),
      userId,
      firstName: person.firstName,
      lastName: person.lastName ?? "",
      email: person.email ?? null,
      company: person.company ?? null,
      position: person.position ?? null,
      connectedOn: person.connectedOn ?? null,
      profileUrl: person.profileUrl ?? null,
      linkedinId: person.linkedinId ?? null,
      tags: serializeTags(person.tags ?? []),
      notes: person.notes ?? "",
      status: "active",
      lastContactedAt: person.lastContactedAt ?? null,
      source,
    });
    imported += 1;
  }

  return { imported, updated, skipped, total: people.length };
}
