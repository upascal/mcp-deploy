import { NextResponse } from "next/server";
import { checkWranglerLogin } from "@/lib/wrangler";

export async function GET() {
  try {
    const status = checkWranglerLogin();

    return NextResponse.json({
      configured: status.loggedIn,
      account: status.account ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
