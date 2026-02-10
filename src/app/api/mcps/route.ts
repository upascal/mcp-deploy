import { NextResponse } from "next/server";
import { getAllMcps, resolveMcpEntry } from "@/lib/mcp-registry";
import { getDeployment } from "@/lib/store";

export async function GET() {
  try {
    const entries = await getAllMcps();

    const mcps = await Promise.all(
      entries.map(async (entry) => {
        try {
          // Resolve the entry to get full metadata from GitHub
          const resolved = await resolveMcpEntry(entry);
          const deployment = getDeployment(entry.slug);

          // Check for updates: resolved.version is the latest from GitHub (cached 5 min)
          const latestVersion = resolved.version;
          const updateAvailable =
            !!deployment?.version &&
            deployment.status === "deployed" &&
            deployment.version !== latestVersion;

          return {
            slug: resolved.slug,
            name: resolved.name,
            description: resolved.description,
            version: resolved.version,
            deployedVersion: deployment?.version ?? null,
            latestVersion,
            updateAvailable,
            githubRepo: resolved.githubRepo,
            isDefault: resolved.isDefault,
            status: deployment?.status ?? "not_deployed",
            workerUrl: deployment?.workerUrl ?? null,
            deployedAt: deployment?.deployedAt ?? null,
          };
        } catch (err) {
          // If we can't resolve, return minimal info with error
          console.error(`Failed to resolve MCP ${entry.slug}:`, err);
          const deployment = getDeployment(entry.slug);
          return {
            slug: entry.slug,
            name: entry.slug,
            description: "Failed to load metadata from GitHub",
            version: "unknown",
            deployedVersion: deployment?.version ?? null,
            latestVersion: null,
            updateAvailable: false,
            githubRepo: entry.githubRepo,
            isDefault: entry.isDefault,
            status: deployment?.status ?? "not_deployed",
            workerUrl: deployment?.workerUrl ?? null,
            deployedAt: deployment?.deployedAt ?? null,
            error: err instanceof Error ? err.message : "Failed to load",
          };
        }
      })
    );

    return NextResponse.json({ mcps });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
