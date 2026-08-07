import { NextResponse } from "next/server";
import { setDeployment } from "@/lib/store";
import { isValidSlug, isValidSecretsObject } from "@/lib/validation";
import { deployMcp } from "@/lib/operations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  let authMode: "bearer" | "oauth" | "open" = "bearer";

  // Validate slug parameter
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: "Invalid slug format" }, { status: 400 });
  }

  try {
    // Get user-provided secrets and config from the request body
    const body = await request.json().catch(() => ({}));
    const rawSecrets: Record<string, string> = body.secrets ?? {};
    const rawConfig: Record<string, string> = body.config ?? {};
    authMode =
      body.authMode === "oauth" || body.authMode === "open"
        ? body.authMode
        : "bearer";

    // Strip empty values from config (stale fields from previous versions)
    const userConfig: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawConfig)) {
      if (typeof value === "string" && value.length > 0) {
        userConfig[key] = value;
      }
    }

    // Strip empty values from secrets
    const userSecrets: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawSecrets)) {
      if (typeof value === "string" && value.length > 0) {
        userSecrets[key] = value;
      }
    }

    // Validate secrets format
    if (!isValidSecretsObject(userSecrets)) {
      return NextResponse.json(
        { error: "Invalid secrets format" },
        { status: 400 }
      );
    }

    // Validate config format
    if (!isValidSecretsObject(userConfig)) {
      return NextResponse.json(
        { error: "Invalid config format" },
        { status: 400 }
      );
    }

    const result = await deployMcp(slug, {
      authMode,
      secrets: userSecrets,
      config: userConfig,
      regenerateToken: body.regenerateToken === true,
      regenerateOAuthPassword: body.regenerateOAuthPassword === true,
    });

    return NextResponse.json({
      success: true,
      workerUrl: result.workerUrl,
      mcpUrl: result.mcpUrl,
      mcpUrlWithToken: result.mcpUrlWithToken,
      bearerToken: result.bearerToken,
      authMode: result.authMode,
      oauthEnabled: result.oauthEnabled,
      ...(result.oauthPassword ? { oauthPassword: result.oauthPassword } : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    // Map known errors to appropriate HTTP status codes
    if (message === "MCP not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Not logged in to Cloudflare")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Store failed deployment
    try {
      setDeployment({
        slug,
        status: "failed",
        workerUrl: null,
        bearerToken: null,
        authMode,
        deployedAt: new Date().toISOString(),
        version: "unknown",
        error: message,
      });
    } catch {
      // Don't let store errors mask the original deployment error
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
