import { NextResponse } from "next/server";
import { getStoredMcp, resolveMcpEntry, resolveMcpEntryFromCache } from "@/lib/mcp-registry";
import { getDeployment, getMcpSecrets, getLatestVersionCache } from "@/lib/store";
import { decrypt } from "@/lib/encryption";
import { isValidSlug } from "@/lib/validation";

/** Strip leading "v" from version strings (handles legacy cached data). */
function stripV(v: string | null | undefined): string | null {
  return v ? v.replace(/^v/, "") : null;
}

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

    // Try cache-only first (instant), fall back to GitHub for new MCPs
    const resolved =
      resolveMcpEntryFromCache(entry) ??
      (await resolveMcpEntry(entry));

    const [deployment, secrets] = await Promise.all([
      getDeployment(slug),
      getMcpSecrets(slug),
    ]);

    // Return secret keys (not values) so the UI knows what's configured
    const secretKeys = secrets ? Object.keys(secrets) : [];

    // Read update status from latest_version_cache (populated by explicit check)
    const versionCache = getLatestVersionCache(slug);
    const currentV = stripV(deployment?.version) ?? stripV(resolved.version);
    const latestV = stripV(versionCache?.latestVersion);
    const updateAvailable =
      !!currentV &&
      !!latestV &&
      currentV !== latestV;

    // Decrypt credentials for display (local-only UI)
    let decryptedBearerToken: string | null = null;
    let decryptedOauthPassword: string | null = null;
    if (deployment?.bearerToken) {
      try { decryptedBearerToken = decrypt(deployment.bearerToken); } catch { /* */ }
    }
    if (deployment?.oauthPassword) {
      try { decryptedOauthPassword = decrypt(deployment.oauthPassword); } catch { /* */ }
    }

    return NextResponse.json({
      slug: resolved.slug,
      githubRepo: resolved.githubRepo,
      isDefault: resolved.isDefault,
      name: resolved.name,
      description: resolved.description,
      version: stripV(resolved.version) ?? resolved.version,
      deployedVersion: stripV(deployment?.version),
      latestVersion: latestV,
      updateAvailable,
      workerName: resolved.workerName,
      secrets: resolved.secrets ?? [],
      config: resolved.config ?? [],
      autoSecrets: resolved.autoSecrets ?? [],
      deployment: deployment ?? { status: "not_deployed" },
      configuredSecrets: secretKeys,
      credentials: {
        bearerToken: decryptedBearerToken,
        oauthPassword: decryptedOauthPassword,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
