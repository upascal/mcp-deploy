import { NextRequest, NextResponse } from "next/server";
import { getAllMcps, checkForUpdate } from "@/lib/mcp-registry";
import { getDeployment, setLatestVersionCache } from "@/lib/store";

/**
 * Explicitly check for updates on GitHub.
 *
 * POST /api/mcps/check-updates
 * Body (optional): { slugs: string[] }
 *
 * If slugs is omitted, checks all MCPs.
 * Each check makes 1 lightweight GitHub API call (getLatestVersion).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedSlugs: string[] | undefined = body.slugs;

    const allEntries = await getAllMcps();
    const entries = requestedSlugs
      ? allEntries.filter((e) => requestedSlugs.includes(e.slug))
      : allEntries;

    const results = await Promise.all(
      entries.map(async (entry) => {
        try {
          const deployment = getDeployment(entry.slug);
          const { updateAvailable, latestVersion } = await checkForUpdate(
            entry,
            deployment?.version ?? null
          );

          // Store in latest_version_cache
          if (latestVersion) {
            setLatestVersionCache(entry.slug, latestVersion);
          }

          return {
            slug: entry.slug,
            latestVersion,
            updateAvailable,
          };
        } catch (err) {
          return {
            slug: entry.slug,
            latestVersion: null,
            updateAvailable: false,
            error: err instanceof Error ? err.message : "Check failed",
          };
        }
      })
    );

    return NextResponse.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
