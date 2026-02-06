import { getDb } from "./db";
import type { DeploymentRecord, McpSecretsRecord, StoredMcpEntry } from "./types";

// ─── Deployment Records ───

export async function getDeployment(
  slug: string
): Promise<DeploymentRecord | null> {
  const row = getDb()
    .prepare(
      "SELECT slug, status, worker_url, bearer_token, deployed_at, version, error FROM deployments WHERE slug = ?"
    )
    .get(slug) as
    | {
        slug: string;
        status: string;
        worker_url: string | null;
        bearer_token: string | null;
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
    deployedAt: row.deployed_at,
    version: row.version,
    ...(row.error ? { error: row.error } : {}),
  };
}

export async function setDeployment(record: DeploymentRecord): Promise<void> {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO deployments (slug, status, worker_url, bearer_token, deployed_at, version, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.slug,
      record.status,
      record.workerUrl,
      record.bearerToken,
      record.deployedAt,
      record.version,
      record.error ?? null
    );
}

// ─── MCP Secrets ───

export async function getMcpSecrets(
  slug: string
): Promise<McpSecretsRecord | null> {
  const rows = getDb()
    .prepare("SELECT key, value FROM secrets WHERE slug = ?")
    .all(slug) as Array<{ key: string; value: string }>;

  if (rows.length === 0) return null;

  const result: McpSecretsRecord = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export async function setMcpSecrets(
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
        insert.run(slug, key, val);
      }
    }
  });
  tx();
}

/**
 * Get the bearer token for a deployed MCP.
 */
export async function getMcpBearerToken(
  slug: string
): Promise<string | null> {
  const deployment = await getDeployment(slug);
  return deployment?.bearerToken ?? null;
}

// ─── MCP Registry ───

export async function getMcps(): Promise<StoredMcpEntry[]> {
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

export async function setMcps(mcps: StoredMcpEntry[]): Promise<void> {
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

export async function addMcp(entry: StoredMcpEntry): Promise<void> {
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

export async function removeMcp(slug: string): Promise<void> {
  getDb().prepare("DELETE FROM mcps WHERE slug = ?").run(slug);
}

// ─── Seeding ───

export async function hasSeededDefaults(): Promise<boolean> {
  const row = getDb()
    .prepare("SELECT value FROM config WHERE key = 'seeded_defaults'")
    .get() as { value: string } | undefined;
  return row?.value === "1";
}

export async function markSeededDefaults(): Promise<void> {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO config (key, value) VALUES ('seeded_defaults', '1')"
    )
    .run();
}

export async function resetSeededDefaults(): Promise<void> {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO config (key, value) VALUES ('seeded_defaults', '0')"
    )
    .run();
}

// ─── Cloudflare Config (legacy, kept for API compat) ───

export async function getCfToken(): Promise<string | null> {
  const row = getDb()
    .prepare("SELECT value FROM config WHERE key = 'cf_token'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

export async function setCfToken(token: string): Promise<void> {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO config (key, value) VALUES ('cf_token', ?)"
    )
    .run(token);
}

export async function getCfAccountId(): Promise<string | null> {
  const row = getDb()
    .prepare("SELECT value FROM config WHERE key = 'cf_account_id'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

export async function setCfAccountId(accountId: string): Promise<void> {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO config (key, value) VALUES ('cf_account_id', ?)"
    )
    .run(accountId);
}

export async function isCfConfigured(): Promise<boolean> {
  const token = await getCfToken();
  const accountId = await getCfAccountId();
  return !!(token && accountId);
}
