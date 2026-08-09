/**
 * Storage facade and injection seam.
 *
 * Callers import these free functions; each delegates to the active Store
 * implementation. The local tool uses SqliteStore. A hosted deployment calls
 * setStore() at startup to swap in a D1 or Postgres backend, and every caller
 * below then runs against it unchanged.
 */

import { SqliteStore } from "./sqlite-store";
import type {
  CachedMetadata,
  LatestVersionCacheEntry,
  Store,
} from "./store-types";
import type {
  DeploymentRecord,
  McpSecretsRecord,
  StoredMcpEntry,
} from "./types";

export type { Store, CachedMetadata, LatestVersionCacheEntry };

let active: Store = new SqliteStore();

/** The active storage backend. */
export function getStore(): Store {
  return active;
}

/** Swap the backend. Used by hosted deployments and tests. */
export function setStore(store: Store): void {
  active = store;
}

// ─── Delegating facade ───

export function getDeployment(slug: string): Promise<DeploymentRecord | null> {
  return active.getDeployment(slug);
}

export function setDeployment(record: DeploymentRecord): Promise<void> {
  return active.setDeployment(record);
}

export function getMcpSecrets(slug: string): Promise<McpSecretsRecord | null> {
  return active.getMcpSecrets(slug);
}

export function setMcpSecrets(
  slug: string,
  secrets: Record<string, string>
): Promise<void> {
  return active.setMcpSecrets(slug, secrets);
}

export function getMcpBearerToken(slug: string): Promise<string | null> {
  return active.getMcpBearerToken(slug);
}

export function getMcps(): Promise<StoredMcpEntry[]> {
  return active.getMcps();
}

export function setMcps(mcps: StoredMcpEntry[]): Promise<void> {
  return active.setMcps(mcps);
}

export function addMcp(entry: StoredMcpEntry): Promise<void> {
  return active.addMcp(entry);
}

export function undeployMcp(slug: string): Promise<void> {
  return active.undeployMcp(slug);
}

export function removeMcp(slug: string): Promise<void> {
  return active.removeMcp(slug);
}

export function hasSeededDefaults(): Promise<boolean> {
  return active.hasSeededDefaults();
}

export function markSeededDefaults(): Promise<void> {
  return active.markSeededDefaults();
}

export function resetSeededDefaults(): Promise<void> {
  return active.resetSeededDefaults();
}

export function getCfToken(): Promise<string | null> {
  return active.getCfToken();
}

export function setCfToken(token: string): Promise<void> {
  return active.setCfToken(token);
}

export function getCfAccountId(): Promise<string | null> {
  return active.getCfAccountId();
}

export function setCfAccountId(accountId: string): Promise<void> {
  return active.setCfAccountId(accountId);
}

export function isCfConfigured(): Promise<boolean> {
  return active.isCfConfigured();
}

export function getCachedMetadata(slug: string): Promise<CachedMetadata | null> {
  return active.getCachedMetadata(slug);
}

export function getCachedMetadataForDisplay(
  slug: string
): Promise<CachedMetadata | null> {
  return active.getCachedMetadataForDisplay(slug);
}

export function setCachedMetadata(
  slug: string,
  data: CachedMetadata
): Promise<void> {
  return active.setCachedMetadata(slug, data);
}

export function deleteCachedMetadata(slug: string): Promise<void> {
  return active.deleteCachedMetadata(slug);
}

export function getLatestVersionCache(
  slug: string
): Promise<LatestVersionCacheEntry | null> {
  return active.getLatestVersionCache(slug);
}

export function setLatestVersionCache(
  slug: string,
  version: string
): Promise<void> {
  return active.setLatestVersionCache(slug, version);
}
