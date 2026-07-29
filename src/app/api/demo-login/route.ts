import { NextResponse } from "next/server";

/** @deprecated Use server actions instead. Kept for compatibility. */
export async function POST() {
  return NextResponse.json(
    { error: "Use the demo sign-in button on the home page." },
    { status: 410 },
  );
}
