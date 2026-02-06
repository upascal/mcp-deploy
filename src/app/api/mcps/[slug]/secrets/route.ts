import { NextResponse } from "next/server";
import { getStoredMcp, resolveMcpEntry } from "@/lib/mcp-registry";
import { CloudflareDeployService } from "@/lib/cloudflare-deploy";
import {
  getCfToken,
  getCfAccountId,
  getMcpSecrets,
  setMcpSecrets,
} from "@/lib/kv";

/**
 * GET: Return which secret keys are configured (not their values).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
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
    const entry = await getStoredMcp(slug);
    if (!entry) {
      return NextResponse.json({ error: "MCP not found" }, { status: 404 });
    }

    const resolved = await resolveMcpEntry(entry);

    const [cfToken, cfAccountId] = await Promise.all([
      getCfToken(),
      getCfAccountId(),
    ]);

    if (!cfToken || !cfAccountId) {
      return NextResponse.json(
        { error: "Cloudflare not configured" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const newSecrets: Record<string, string> = body.secrets ?? {};
    const deleteKeys: string[] = body.deleteKeys ?? [];

    if (Object.keys(newSecrets).length === 0 && deleteKeys.length === 0) {
      return NextResponse.json(
        { error: "No secrets to update or delete" },
        { status: 400 }
      );
    }

    const service = new CloudflareDeployService(cfToken, cfAccountId);

    // Delete secrets from Cloudflare
    for (const key of deleteKeys) {
      await service.deleteSecret(resolved.workerName, key);
    }

    // Update secrets on Cloudflare
    await service.setSecrets(resolved.workerName, newSecrets);

    // Update stored secrets (merge with existing, remove deleted)
    const existing = (await getMcpSecrets(slug)) ?? {};
    const merged = { ...existing, ...newSecrets };
    for (const key of deleteKeys) {
      delete merged[key];
    }
    await setMcpSecrets(slug, merged);

    return NextResponse.json({
      success: true,
      updatedKeys: Object.keys(newSecrets),
      deletedKeys: deleteKeys,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
