/**
 * The storage seam.
 *
 * Everything mcp-deploy persists — the MCP registry, deployment records,
 * encrypted secrets, config, and caches — goes through this interface. The
 * local tool backs it with better-sqlite3 (see sqlite-store.ts); a hosted
 * deployment can back it with D1 or Postgres without touching operations.ts
 * or the route handlers.
 *
 * Every method is async. better-sqlite3 is synchronous and satisfies it
 * trivially, but D1 and Postgres are not, so the interface is async so the
 * same callers work against either.
 */

import type {
  DeploymentRecord,
  McpMetadata,
  McpSecretsRecord,
  StoredMcpEntry,
} from "./types";

export interface CachedMetadata {
  metadata: McpMetadata;
  bundleUrl: string;
  version: string;
}

export interface LatestVersionCacheEntry {
  latestVersion: string;
  checkedAt: number;
}

export interface Store {
  // Deployment records
  getDeployment(slug: string): Promise<DeploymentRecord | null>;
  setDeployment(record: DeploymentRecord): Promise<void>;

  // MCP secrets (stored encrypted)
  getMcpSecrets(slug: string): Promise<McpSecretsRecord | null>;
  setMcpSecrets(slug: string, secrets: Record<string, string>): Promise<void>;
  getMcpBearerToken(slug: string): Promise<string | null>;

  // MCP registry
  getMcps(): Promise<StoredMcpEntry[]>;
  setMcps(mcps: StoredMcpEntry[]): Promise<void>;
  addMcp(entry: StoredMcpEntry): Promise<void>;
  undeployMcp(slug: string): Promise<void>;
  removeMcp(slug: string): Promise<void>;

  // Seeding
  hasSeededDefaults(): Promise<boolean>;
  markSeededDefaults(): Promise<void>;
  resetSeededDefaults(): Promise<void>;

  // Cloudflare config
  getCfToken(): Promise<string | null>;
  setCfToken(token: string): Promise<void>;
  getCfAccountId(): Promise<string | null>;
  setCfAccountId(accountId: string): Promise<void>;
  isCfConfigured(): Promise<boolean>;

  // Metadata cache
  getCachedMetadata(slug: string): Promise<CachedMetadata | null>;
  getCachedMetadataForDisplay(slug: string): Promise<CachedMetadata | null>;
  setCachedMetadata(slug: string, data: CachedMetadata): Promise<void>;
  deleteCachedMetadata(slug: string): Promise<void>;

  // Latest-version cache
  getLatestVersionCache(slug: string): Promise<LatestVersionCacheEntry | null>;
  setLatestVersionCache(slug: string, version: string): Promise<void>;
}
