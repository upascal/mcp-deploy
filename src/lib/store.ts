import { getDb } from "./db";
import { encrypt, decrypt } from "./encryption";
import type { DeploymentRecord, McpMetadata, McpSecretsRecord, StoredMcpEntry } from "./types";

// ─── Deployment Records ───

export function getDeployment(
  slug: string
): DeploymentRecord | null {
  const row = getDb()
    .prepare(
      "SELECT slug, status, worker_url, bearer_token, oauth_password, auth_mode, deployed_at, version, error FROM deployments WHERE slug = ?"
    )
    .get(slug) as
    | {
        slug: string;
        status: string;
        worker_url: string | null;
        bearer_token: string | null;
        oauth_password: string | null;
        auth_mode: string | null;
        deployed_at: string | null;
        version: string;
        error: string | null;
      }
    | undefined;

  if (!row) return null;

  return {
    slug: row.slug,
    status: row.status as DeploymentRecord["status"],
    workerUrl: row.worker_url,
    bearerToken: row.bearer_token,
    oauthPassword: row.oauth_password,
    authMode:
      (row.auth_mode as DeploymentRecord["authMode"]) ?? "bearer",
    deployedAt: row.deployed_at,
    version: row.version,
    ...(row.error ? { error: row.error } : {}),
  };
}

export function setDeployment(record: DeploymentRecord): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO deployments (slug, status, worker_url, bearer_token, oauth_password, auth_mode, deployed_at, version, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.slug,
      record.status,
      record.workerUrl,
      record.bearerToken,
      record.oauthPassword ?? null,
      record.authMode ?? "bearer",
      record.deployedAt,
      record.version,
      record.error ?? null
    );
}

// ─── MCP Secrets ───

export function getMcpSecrets(
  slug: string
): McpSecretsRecord | null {
  const rows = getDb()
    .prepare("SELECT key, value FROM secrets WHERE slug = ?")
    .all(slug) as Array<{ key: string; value: string }>;

  if (rows.length === 0) return null;

  const result: McpSecretsRecord = {};
  for (const row of rows) {
    try {
      result[row.key] = decrypt(row.value);
    } catch {
      // Fallback for pre-encryption plaintext values
      result[row.key] = row.value;
    }
  }
  return result;
}

export function setMcpSecrets(
  slug: string,
  secrets: Record<string, string>
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM secrets WHERE slug = ?").run(slug);
    const insert = db.prepare(
      "INSERT INTO secrets (slug, key, value) VALUES (?, ?, ?)"
    );
    for (const [key, val] of Object.entries(secrets)) {
      if (val) {
        insert.run(slug, key, encrypt(val));
      }
    }
  });
  tx();
}

/**
 * Get the bearer token for a deployed MCP.
 */
export function getMcpBearerToken(
  slug: string
): string | null {
  const deployment = getDeployment(slug);
  return deployment?.bearerToken ?? null;
}

// ─── MCP Registry ───

export function getMcps(): StoredMcpEntry[] {
  const rows = getDb()
    .prepare(
      "SELECT slug, github_repo, release_tag, added_at, is_default FROM mcps"
    )
    .all() as Array<{
    slug: string;
    github_repo: string;
    release_tag: string;
    added_at: string;
    is_default: number;
  }>;

  return rows.map((row) => ({
    slug: row.slug,
    githubRepo: row.github_repo,
    releaseTag: row.release_tag,
    addedAt: row.added_at,
    ...(row.is_default ? { isDefault: true } : {}),
  }));
}

export function setMcps(mcps: StoredMcpEntry[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM mcps").run();
    const insert = db.prepare(
      "INSERT INTO mcps (slug, github_repo, release_tag, added_at, is_default) VALUES (?, ?, ?, ?, ?)"
    );
    for (const mcp of mcps) {
      insert.run(
        mcp.slug,
        mcp.githubRepo,
        mcp.releaseTag,
        mcp.addedAt,
        mcp.isDefault ? 1 : 0
      );
    }
  });
  tx();
}

export function addMcp(entry: StoredMcpEntry): void {
  const existing = getDb()
    .prepare("SELECT slug FROM mcps WHERE slug = ?")
    .get(entry.slug);

  if (existing) {
    throw new Error(`MCP with slug "${entry.slug}" already exists`);
  }

  getDb()
    .prepare(
      "INSERT INTO mcps (slug, github_repo, release_tag, added_at, is_default) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      entry.slug,
      entry.githubRepo,
      entry.releaseTag,
      entry.addedAt,
      entry.isDefault ? 1 : 0
    );
}

export function undeployMcp(slug: string): void {
  getDb()
    .prepare(
      "UPDATE deployments SET status = 'not_deployed', worker_url = NULL WHERE slug = ?"
    )
    .run(slug);
}

export function removeMcp(slug: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM deployments WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM secrets WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM jwt_secrets WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM metadata_cache WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM latest_version_cache WHERE slug = ?").run(slug);
    // worker_url_mapping uses worker_url as PK, so delete by slug column
    db.prepare("DELETE FROM worker_url_mapping WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM mcps WHERE slug = ?").run(slug);
  });
  tx();
}

// ─── Seeding ───

export function hasSeededDefaults(): boolean {
  const row = getDb()
    .prepare("SELECT value FROM config WHERE key = 'seeded_defaults'")
    .get() as { value: string } | undefined;
  return row?.value === "1";
}

export function markSeededDefaults(): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO config (key, value) VALUES ('seeded_defaults', '1')"
    )
    .run();
}

export function resetSeededDefaults(): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO config (key, value) VALUES ('seeded_defaults', '0')"
    )
    .run();
}

// ─── Cloudflare Config (legacy, kept for API compat) ───

export function getCfToken(): string | null {
  const row = getDb()
    .prepare("SELECT value FROM config WHERE key = 'cf_token'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

export function setCfToken(token: string): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO config (key, value) VALUES ('cf_token', ?)"
    )
    .run(token);
}

export function getCfAccountId(): string | null {
  const row = getDb()
    .prepare("SELECT value FROM config WHERE key = 'cf_account_id'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

export function setCfAccountId(accountId: string): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO config (key, value) VALUES ('cf_account_id', ?)"
    )
    .run(accountId);
}

export function isCfConfigured(): boolean {
  const token = getCfToken();
  const accountId = getCfAccountId();
  return !!(token && accountId);
}

// ─── Metadata Cache ───

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CachedMetadata {
  metadata: McpMetadata;
  bundleUrl: string;
  version: string;
}

export function getCachedMetadata(slug: string): CachedMetadata | null {
  const row = getDb()
    .prepare(
      "SELECT metadata, bundle_url, version, fetched_at FROM metadata_cache WHERE slug = ?"
    )
    .get(slug) as
    | { metadata: string; bundle_url: string; version: string; fetched_at: number }
    | undefined;

  if (!row) return null;

  // Check TTL
  if (Date.now() - row.fetched_at > CACHE_TTL_MS) return null;

  return {
    metadata: JSON.parse(row.metadata),
    bundleUrl: row.bundle_url,
    version: row.version,
  };
}

/**
 * Same as getCachedMetadata but ignores TTL — returns data regardless of age.
 * Used for instant dashboard/detail page loads (display-only, no freshness guarantee).
 */
export function getCachedMetadataForDisplay(slug: string): CachedMetadata | null {
  const row = getDb()
    .prepare(
      "SELECT metadata, bundle_url, version, fetched_at FROM metadata_cache WHERE slug = ?"
    )
    .get(slug) as
    | { metadata: string; bundle_url: string; version: string; fetched_at: number }
    | undefined;

  if (!row) return null;

  return {
    metadata: JSON.parse(row.metadata),
    bundleUrl: row.bundle_url,
    version: row.version,
  };
}

export function setCachedMetadata(
  slug: string,
  data: CachedMetadata
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO metadata_cache (slug, metadata, bundle_url, version, fetched_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      slug,
      JSON.stringify(data.metadata),
      data.bundleUrl,
      data.version,
      Date.now()
    );
}

export function deleteCachedMetadata(slug: string): void {
  getDb()
    .prepare("DELETE FROM metadata_cache WHERE slug = ?")
    .run(slug);
}

// ─── Latest Version Cache ───

interface LatestVersionCacheEntry {
  latestVersion: string;
  checkedAt: number;
}

export function getLatestVersionCache(slug: string): LatestVersionCacheEntry | null {
  const row = getDb()
    .prepare(
      "SELECT latest_version, checked_at FROM latest_version_cache WHERE slug = ?"
    )
    .get(slug) as
    | { latest_version: string; checked_at: number }
    | undefined;

  if (!row) return null;

  return {
    latestVersion: row.latest_version,
    checkedAt: row.checked_at,
  };
}

export function setLatestVersionCache(slug: string, version: string): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO latest_version_cache (slug, latest_version, checked_at)
       VALUES (?, ?, ?)`
    )
    .run(slug, version, Date.now());
}
