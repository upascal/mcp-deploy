import { NextResponse } from "next/server";
import { getStoredMcp, resolveMcpEntry } from "@/lib/mcp-registry";
import { getDeployment, getMcpSecrets } from "@/lib/store";
import { decrypt } from "@/lib/encryption";
import { isValidSlug } from "@/lib/validation";

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

    // Resolve the entry to get full metadata from GitHub
    const resolved = await resolveMcpEntry(entry);

    const [deployment, secrets] = await Promise.all([
      getDeployment(slug),
      getMcpSecrets(slug),
    ]);

    // Return secret keys (not values) so the UI knows what's configured
    const secretKeys = secrets ? Object.keys(secrets) : [];

    // Check for updates: resolved.version is the latest from GitHub (cached 5 min)
    const latestVersion = resolved.version;
    const updateAvailable =
      !!deployment?.version &&
      deployment.status === "deployed" &&
      deployment.version !== latestVersion;

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
      version: resolved.version,
      deployedVersion: deployment?.version ?? null,
      latestVersion,
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
