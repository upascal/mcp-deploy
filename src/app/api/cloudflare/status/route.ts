import { NextResponse } from "next/server";
import { isCfConfigured, getCfAccountId } from "@/lib/store";

export async function GET() {
  try {
    const [configured, accountId] = await Promise.all([
      isCfConfigured(),
      getCfAccountId(),
    ]);

    return NextResponse.json({
      configured,
      accountId: configured ? accountId : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
