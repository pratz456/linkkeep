export type LinkedInConnectionResult =
  | { ok: true; items: LinkedInApiConnection[]; total?: number }
  | { ok: false; code: "forbidden" | "unauthorized" | "error"; message: string };

export type LinkedInApiConnection = {
  linkedinId: string;
  firstName: string;
  lastName: string;
  headline?: string;
};

/**
 * Attempts to fetch 1st-degree connections via LinkedIn's Connections API.
 * Requires partner-approved `r_1st_connections` scope — not available to self-serve apps.
 */
export async function fetchLinkedInConnections(
  accessToken: string,
): Promise<LinkedInConnectionResult> {
  try {
    const url = new URL("https://api.linkedin.com/v2/connections");
    url.searchParams.set("q", "viewer");
    url.searchParams.set("start", "0");
    url.searchParams.set("count", "50");
    url.searchParams.set(
      "projection",
      "(elements*(to~(id,localizedFirstName,localizedLastName,localizedHeadline)),paging)",
    );

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      cache: "no-store",
    });

    if (res.status === 401) {
      return {
        ok: false,
        code: "unauthorized",
        message: "LinkedIn access token is invalid or expired. Sign in again.",
      };
    }

    if (res.status === 403) {
      return {
        ok: false,
        code: "forbidden",
        message:
          "LinkedIn does not grant connection-list access to standard apps. Import a Connections.csv export instead, or apply for partner API access.",
      };
    }

    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        code: "error",
        message: `LinkedIn API error (${res.status}): ${body.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as {
      elements?: Array<{
        to?: {
          id?: string;
          localizedFirstName?: string;
          localizedLastName?: string;
          localizedHeadline?: string;
        };
      }>;
      paging?: { total?: number };
    };

    const items: LinkedInApiConnection[] = [];
    for (const el of data.elements ?? []) {
      const person = el.to;
      if (!person?.id) continue;
      items.push({
        linkedinId: person.id,
        firstName: person.localizedFirstName ?? "Unknown",
        lastName: person.localizedLastName ?? "",
        headline: person.localizedHeadline,
      });
    }

    return { ok: true, items, total: data.paging?.total };
  } catch (error) {
    return {
      ok: false,
      code: "error",
      message:
        error instanceof Error ? error.message : "Failed to reach LinkedIn API",
    };
  }
}

export async function getLinkedInAccessToken(
  userId: string,
): Promise<string | null> {
  const { db } = await import("@/db");
  const { accounts } = await import("@/db/schema");
  const { and, eq } = await import("drizzle-orm");

  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "linkedin")))
    .limit(1);

  return rows[0]?.access_token ?? null;
}
