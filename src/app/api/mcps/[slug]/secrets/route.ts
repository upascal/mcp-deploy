import { NextResponse } from "next/server";
import { getStoredMcp, resolveMcpEntry } from "@/lib/mcp-registry";
import { getMcpSecrets } from "@/lib/store";
import { isValidSlug, isValidSecretsObject, isValidSecretKey } from "@/lib/validation";
import { updateSecrets } from "@/lib/operations";

/**
 * GET: Return which secret keys are configured (not their values).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "Invalid slug format" }, { status: 400 });
    }
    const entry = await getStoredMcp(slug);
    if (!entry) {
      return NextResponse.json({ error: "MCP not found" }, { status: 404 });
    }

    const resolved = await resolveMcpEntry(entry);
    const secrets = await getMcpSecrets(slug);
    const configuredKeys = secrets ? Object.keys(secrets) : [];

    return NextResponse.json({
      slug,
      schema: resolved.secrets,
      configuredKeys,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT: Update secrets on the deployed worker without redeploying.
 * Pass `deleteKeys` array to remove specific secrets.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "Invalid slug format" }, { status: 400 });
    }

    const body = await request.json();
    const newSecrets: Record<string, string> = body.secrets ?? {};
    const deleteKeys: string[] = body.deleteKeys ?? [];

    // Validate secrets format
    if (newSecrets && !isValidSecretsObject(newSecrets)) {
      return NextResponse.json(
        { error: "Invalid secrets format" },
        { status: 400 }
      );
    }

    // Validate deleteKeys
    if (!Array.isArray(deleteKeys) || !deleteKeys.every(k => isValidSecretKey(k))) {
      return NextResponse.json(
        { error: "Invalid deleteKeys format" },
        { status: 400 }
      );
    }

    if (Object.keys(newSecrets).length === 0 && deleteKeys.length === 0) {
      return NextResponse.json(
        { error: "No secrets to update or delete" },
        { status: 400 }
      );
    }

    const result = await updateSecrets(slug, newSecrets, deleteKeys);

    return NextResponse.json({
      success: true,
      updatedKeys: result.updatedKeys,
      deletedKeys: result.deletedKeys,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message === "MCP not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Not logged in to Cloudflare")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
