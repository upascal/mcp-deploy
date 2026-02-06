import type { McpRegistryEntry, ResolvedMcpEntry, StoredMcpEntry } from "./types";
import { getMcps, addMcp, hasSeededDefaults, markSeededDefaults } from "./kv";
import { fetchMcpMetadata, getLatestVersion } from "./github-releases";

/**
 * Default MCPs to seed on first run.
 * These are just regular GitHub MCPs that get added automatically.
 * Note: These must have GitHub releases with mcp-deploy.json and worker.mjs files.
 */
export const DEFAULT_MCPS: McpRegistryEntry[] = [
  {
    slug: "zotero-assistant",
    githubRepo: "upascal/zotero-assistant-mcp-remote",
  },
  {
    slug: "paper-search",
    githubRepo: "upascal/paper-search-mcp-remote",
  },
];

/**
 * Seed default MCPs if not already done.
 * Call this on app startup or when fetching the MCP list.
 */
export async function seedDefaultsIfNeeded(): Promise<void> {
  const alreadySeeded = await hasSeededDefaults();
  if (alreadySeeded) return;

  // Add each default MCP
  for (const mcp of DEFAULT_MCPS) {
    try {
      await addMcp({
        slug: mcp.slug,
        githubRepo: mcp.githubRepo,
        releaseTag: mcp.releaseTag ?? "latest",
        addedAt: new Date().toISOString(),
        isDefault: true,
      });
    } catch (error) {
      // Ignore duplicates (might already exist)
      console.log(`Skipping ${mcp.slug}: ${error}`);
    }
  }

  await markSeededDefaults();
}

/**
 * Get all MCPs from KV storage.
 * Seeds defaults on first run.
 */
export async function getAllMcps(): Promise<StoredMcpEntry[]> {
  await seedDefaultsIfNeeded();
  return getMcps();
}

/**
 * Get a specific MCP by slug.
 */
export async function getStoredMcp(
  slug: string
): Promise<StoredMcpEntry | undefined> {
  const all = await getAllMcps();
  return all.find((m) => m.slug === slug);
}

/**
 * Resolve a stored MCP entry to a full entry with all metadata from GitHub.
 */
export async function resolveMcpEntry(
  entry: StoredMcpEntry
): Promise<ResolvedMcpEntry> {
  const { metadata, bundleUrl, version } = await fetchMcpMetadata(
    entry.githubRepo,
    entry.releaseTag ?? "latest"
  );

  return {
    slug: entry.slug,
    githubRepo: entry.githubRepo,
    releaseTag: entry.releaseTag,
    isDefault: entry.isDefault,

    name: metadata.name,
    description: metadata.description,
    version: version,

    workerName: metadata.worker.name,
    durableObjectBinding: metadata.worker.durableObjectBinding,
    durableObjectClassName: metadata.worker.durableObjectClassName,
    compatibilityDate: metadata.worker.compatibilityDate,
    compatibilityFlags: metadata.worker.compatibilityFlags,
    migrationTag: metadata.worker.migrationTag,

    bundleUrl,

    secrets: metadata.secrets,
    config: metadata.config,
    autoSecrets: metadata.autoSecrets,
  };
}

/**
 * Get the bundle content for a resolved MCP entry.
 * Fetches from the GitHub release URL.
 */
export async function getBundleContent(
  entry: ResolvedMcpEntry
): Promise<string> {
  const response = await fetch(entry.bundleUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch bundle: ${response.status}`);
  }
  return response.text();
}

/**
 * Check if an update is available for an MCP.
 * Compares the deployed version with the latest GitHub release.
 */
export async function checkForUpdate(
  entry: StoredMcpEntry,
  deployedVersion: string | null
): Promise<{ updateAvailable: boolean; latestVersion: string | null }> {
  // If using a pinned version (not "latest"), no auto-update
  if (entry.releaseTag && entry.releaseTag !== "latest") {
    return { updateAvailable: false, latestVersion: entry.releaseTag };
  }

  const latestVersion = await getLatestVersion(entry.githubRepo);

  if (!latestVersion || !deployedVersion) {
    return { updateAvailable: false, latestVersion };
  }

  // Compare versions - update available if different
  const updateAvailable = latestVersion !== deployedVersion;

  return { updateAvailable, latestVersion };
}
