/**
 * better-sqlite3 implementation of the Store interface — the local tool's
 * backend. better-sqlite3 is synchronous, so each method simply wraps a sync
 * call in an async signature to satisfy the interface.
 *
 * The SQL here was previously the free functions in store.ts; behaviour is
 * unchanged.
 */

import { getDb } from "./db";
import { encrypt, decrypt } from "./encryption";
import type {
  DeploymentRecord,
  McpSecretsRecord,
  StoredMcpEntry,
} from "./types";
import type {
  CachedMetadata,
  LatestVersionCacheEntry,
  Store,
} from "./store-types";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class SqliteStore implements Store {
  // ─── Deployment Records ───

  async getDeployment(slug: string): Promise<DeploymentRecord | null> {
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
      authMode: (row.auth_mode as DeploymentRecord["authMode"]) ?? "bearer",
      deployedAt: row.deployed_at,
      version: row.version,
      ...(row.error ? { error: row.error } : {}),
    };
  }

  async setDeployment(record: DeploymentRecord): Promise<void> {
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

  async getMcpSecrets(slug: string): Promise<McpSecretsRecord | null> {
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

  async setMcpSecrets(
    slug: string,
    secrets: Record<string, string>
  ): Promise<void> {
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

  async getMcpBearerToken(slug: string): Promise<string | null> {
    const deployment = await this.getDeployment(slug);
    return deployment?.bearerToken ?? null;
  }

  // ─── MCP Registry ───

  async getMcps(): Promise<StoredMcpEntry[]> {
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

  async setMcps(mcps: StoredMcpEntry[]): Promise<void> {
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

  async addMcp(entry: StoredMcpEntry): Promise<void> {
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

  async undeployMcp(slug: string): Promise<void> {
    getDb()
      .prepare(
        "UPDATE deployments SET status = 'not_deployed', worker_url = NULL WHERE slug = ?"
      )
      .run(slug);
  }

  async removeMcp(slug: string): Promise<void> {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM deployments WHERE slug = ?").run(slug);
      db.prepare("DELETE FROM secrets WHERE slug = ?").run(slug);
      db.prepare("DELETE FROM jwt_secrets WHERE slug = ?").run(slug);
      db.prepare("DELETE FROM metadata_cache WHERE slug = ?").run(slug);
      db.prepare("DELETE FROM latest_version_cache WHERE slug = ?").run(slug);
      db.prepare("DELETE FROM mcps WHERE slug = ?").run(slug);
    });
    tx();
  }

  // ─── Seeding ───

  async hasSeededDefaults(): Promise<boolean> {
    const row = getDb()
      .prepare("SELECT value FROM config WHERE key = 'seeded_defaults'")
      .get() as { value: string } | undefined;
    return row?.value === "1";
  }

  async markSeededDefaults(): Promise<void> {
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('seeded_defaults', '1')"
      )
      .run();
  }

  async resetSeededDefaults(): Promise<void> {
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('seeded_defaults', '0')"
      )
      .run();
  }

  // ─── Cloudflare Config ───

  async getCfToken(): Promise<string | null> {
    const row = getDb()
      .prepare("SELECT value FROM config WHERE key = 'cf_token'")
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  async setCfToken(token: string): Promise<void> {
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('cf_token', ?)"
      )
      .run(token);
  }

  async getCfAccountId(): Promise<string | null> {
    const row = getDb()
      .prepare("SELECT value FROM config WHERE key = 'cf_account_id'")
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  async setCfAccountId(accountId: string): Promise<void> {
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO config (key, value) VALUES ('cf_account_id', ?)"
      )
      .run(accountId);
  }

  async isCfConfigured(): Promise<boolean> {
    const token = await this.getCfToken();
    const accountId = await this.getCfAccountId();
    return !!(token && accountId);
  }

  // ─── Metadata Cache ───

  async getCachedMetadata(slug: string): Promise<CachedMetadata | null> {
    const row = this.readMetadataRow(slug);
    if (!row) return null;
    if (Date.now() - row.fetched_at > CACHE_TTL_MS) return null;
    return this.toCachedMetadata(row);
  }

  async getCachedMetadataForDisplay(
    slug: string
  ): Promise<CachedMetadata | null> {
    const row = this.readMetadataRow(slug);
    if (!row) return null;
    return this.toCachedMetadata(row);
  }

  private readMetadataRow(slug: string) {
    return getDb()
      .prepare(
        "SELECT metadata, bundle_url, version, fetched_at FROM metadata_cache WHERE slug = ?"
      )
      .get(slug) as
      | {
          metadata: string;
          bundle_url: string;
          version: string;
          fetched_at: number;
        }
      | undefined;
  }

  private toCachedMetadata(row: {
    metadata: string;
    bundle_url: string;
    version: string;
  }): CachedMetadata {
    return {
      metadata: JSON.parse(row.metadata),
      bundleUrl: row.bundle_url,
      version: row.version,
    };
  }

  async setCachedMetadata(slug: string, data: CachedMetadata): Promise<void> {
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

  async deleteCachedMetadata(slug: string): Promise<void> {
    getDb().prepare("DELETE FROM metadata_cache WHERE slug = ?").run(slug);
  }

  // ─── Latest Version Cache ───

  async getLatestVersionCache(
    slug: string
  ): Promise<LatestVersionCacheEntry | null> {
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

  async setLatestVersionCache(slug: string, version: string): Promise<void> {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO latest_version_cache (slug, latest_version, checked_at)
         VALUES (?, ?, ?)`
      )
      .run(slug, version, Date.now());
  }

  // ─── Per-Deployment JWT Signing Secret ───

  async getDeploymentJWTSecret(slug: string): Promise<string | null> {
    const row = getDb()
      .prepare("SELECT secret FROM jwt_secrets WHERE slug = ?")
      .get(slug) as { secret: string } | undefined;

    if (!row) return null;
    return decrypt(row.secret);
  }

  async setDeploymentJWTSecret(slug: string, secret: string): Promise<void> {
    getDb()
      .prepare("INSERT OR REPLACE INTO jwt_secrets (slug, secret) VALUES (?, ?)")
      .run(slug, encrypt(secret));
  }
}
