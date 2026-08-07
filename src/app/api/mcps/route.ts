import { NextResponse } from "next/server";
import { getAllMcps, resolveMcpEntry, resolveMcpEntryFromCache } from "@/lib/mcp-registry";
import { getDeployment, getLatestVersionCache } from "@/lib/store";

/** Strip leading "v" from version strings (handles legacy cached data). */
function stripV(v: string | null | undefined): string | null {
  return v ? v.replace(/^v/, "") : null;
}

export async function GET() {
  try {
    const entries = await getAllMcps();

    const mcps = await Promise.all(
      entries.map(async (entry) => {
        try {
          // Try cache-only first (instant), fall back to GitHub for new MCPs
          const resolved =
            resolveMcpEntryFromCache(entry) ??
            (await resolveMcpEntry(entry));

          const deployment = getDeployment(entry.slug);

          // Read update status from latest_version_cache (populated by explicit check)
          const versionCache = getLatestVersionCache(entry.slug);
          const currentV = stripV(deployment?.version) ?? stripV(resolved.version);
          const latestV = stripV(versionCache?.latestVersion);
          const updateAvailable =
            !!currentV &&
            !!latestV &&
            currentV !== latestV;

          return {
            slug: resolved.slug,
            name: resolved.name,
            description: resolved.description,
            version: stripV(resolved.version) ?? resolved.version,
            deployedVersion: stripV(deployment?.version),
            latestVersion: latestV,
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
            deployedVersion: stripV(deployment?.version),
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
