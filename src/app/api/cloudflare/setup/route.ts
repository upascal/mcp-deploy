import { NextResponse } from "next/server";
import { checkWranglerLogin, wranglerLogin } from "@/lib/wrangler";

export async function POST() {
  try {
    // Check if already logged in
    const status = checkWranglerLogin();
    if (status.loggedIn) {
      return NextResponse.json({
        success: true,
        alreadyLoggedIn: true,
        account: status.account,
      });
    }

    // Trigger wrangler login (opens browser)
    const result = await wranglerLogin();

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "Cloudflare login failed" },
        { status: 400 }
      );
    }

    // Verify login succeeded
    const afterLogin = checkWranglerLogin();

    return NextResponse.json({
      success: true,
      account: afterLogin.account,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
