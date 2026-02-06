import { NextResponse } from "next/server";
import { CloudflareDeployService } from "@/lib/cloudflare-deploy";
import { setCfToken, setCfAccountId } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const { apiToken } = await request.json();

    if (!apiToken || typeof apiToken !== "string") {
      return NextResponse.json(
        { error: "API token is required" },
        { status: 400 },
      );
    }

    // Validate the token against Cloudflare
    const result = await CloudflareDeployService.validateToken(apiToken);

    if (!result.valid || !result.accountId) {
      return NextResponse.json(
        { error: result.error ?? "Invalid API token" },
        { status: 400 },
      );
    }

    // Store encrypted token and account ID
    await Promise.all([
      setCfToken(apiToken),
      setCfAccountId(result.accountId),
    ]);

    return NextResponse.json({
      success: true,
      accountId: result.accountId,
      accountName: result.accountName,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
