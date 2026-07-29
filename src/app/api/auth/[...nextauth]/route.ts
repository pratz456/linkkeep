import { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { ensureDb } from "@/db";

export async function GET(req: NextRequest) {
  await ensureDb();
  return handlers.GET(req);
}

export async function POST(req: NextRequest) {
  await ensureDb();
  return handlers.POST(req);
}
