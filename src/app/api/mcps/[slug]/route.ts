import { NextResponse } from "next/server";
import { getStoredMcp, resolveMcpEntry, checkForUpdate } from "@/lib/mcp-registry";
import { getDeployment, getMcpSecrets } from "@/lib/kv";

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

    // Resolve the entry to get full metadata from GitHub
    const resolved = await resolveMcpEntry(entry);

    const [deployment, secrets] = await Promise.all([
      getDeployment(slug),
      getMcpSecrets(slug),
    ]);

    // Return secret keys (not values) so the UI knows what's configured
    const secretKeys = secrets ? Object.keys(secrets) : [];

    // Check for updates if deployed
    let updateAvailable = false;
    let latestVersion: string | null = resolved.version;

    if (deployment?.status === "deployed" && deployment.version) {
      const updateCheck = await checkForUpdate(entry, deployment.version);
      updateAvailable = updateCheck.updateAvailable;
      latestVersion = updateCheck.latestVersion;
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
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
