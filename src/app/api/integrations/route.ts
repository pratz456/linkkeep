import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { users } from "@/db/schema";

function appBaseUrl(req: NextRequest) {
  return (
    process.env.AUTH_URL?.replace(/\/$/, "") ||
    req.nextUrl.origin ||
    "http://localhost:3000"
  );
}

async function getOrCreateToken(userId: string) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (existing[0]?.webhookToken) {
    return existing[0].webhookToken;
  }

  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await db
    .update(users)
    .set({ webhookToken: token })
    .where(eq(users.id, userId));
  return token;
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await getOrCreateToken(session.user.id);
  const base = appBaseUrl(req);

  return NextResponse.json({
    token,
    webhooks: {
      duxsoup: `${base}/api/webhooks/duxsoup?key=${token}`,
      phantombuster: `${base}/api/webhooks/phantombuster?key=${token}`,
    },
  });
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.action !== "rotate") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await db
    .update(users)
    .set({ webhookToken: token })
    .where(eq(users.id, session.user.id));

  const base = appBaseUrl(req);
  return NextResponse.json({
    token,
    webhooks: {
      duxsoup: `${base}/api/webhooks/duxsoup?key=${token}`,
      phantombuster: `${base}/api/webhooks/phantombuster?key=${token}`,
    },
  });
}
