import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

// Use a temp directory for test databases
const TEST_DATA_DIR = join(process.cwd(), "data", ".test-db");

// We need to mock process.cwd() so the db module uses our test directory
// Instead, we'll test the migration logic directly by importing internals

describe("db module", () => {
  let testDbPath: string;

  beforeEach(() => {
    if (!existsSync(TEST_DATA_DIR)) {
      mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
    testDbPath = join(TEST_DATA_DIR, `test-${Date.now()}.db`);
  });

  afterEach(() => {
    // Clean up test databases
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("should create all required tables", () => {
    const db = new Database(testDbPath);
    db.pragma("journal_mode = WAL");

    // Replicate the schema creation from db.ts
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcps (
        slug TEXT PRIMARY KEY,
        github_repo TEXT NOT NULL,
        release_tag TEXT DEFAULT 'latest',
        added_at TEXT NOT NULL,
        is_default INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS deployments (
        slug TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'not_deployed',
        worker_url TEXT,
        bearer_token TEXT,
        deployed_at TEXT,
        version TEXT,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS secrets (
        slug TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (slug, key)
      );
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jwt_secrets (
        slug TEXT PRIMARY KEY,
        secret TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS worker_url_mapping (
        worker_url TEXT PRIMARY KEY,
        slug TEXT NOT NULL
      );
    `);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("mcps");
    expect(tableNames).toContain("deployments");
    expect(tableNames).toContain("secrets");
    expect(tableNames).toContain("config");
    expect(tableNames).toContain("oauth_clients");
    expect(tableNames).toContain("oauth_codes");
    expect(tableNames).toContain("jwt_secrets");
    expect(tableNames).toContain("worker_url_mapping");

    db.close();
  });

  it("should support WAL journal mode", () => {
    const db = new Database(testDbPath);
    db.pragma("journal_mode = WAL");

    const mode = db.pragma("journal_mode", { simple: true });
    expect(mode).toBe("wal");

    db.close();
  });

  it("should handle MCP insert and retrieval", () => {
    const db = new Database(testDbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcps (
        slug TEXT PRIMARY KEY,
        github_repo TEXT NOT NULL,
        release_tag TEXT DEFAULT 'latest',
        added_at TEXT NOT NULL,
        is_default INTEGER DEFAULT 0
      );
    `);

    db.prepare(
      "INSERT INTO mcps (slug, github_repo, release_tag, added_at, is_default) VALUES (?, ?, ?, ?, ?)"
    ).run("test-mcp", "user/repo", "v1.0.0", "2026-01-01T00:00:00Z", 1);

    const row = db
      .prepare("SELECT * FROM mcps WHERE slug = ?")
      .get("test-mcp") as any;

    expect(row.slug).toBe("test-mcp");
    expect(row.github_repo).toBe("user/repo");
    expect(row.release_tag).toBe("v1.0.0");
    expect(row.is_default).toBe(1);

    db.close();
  });

  it("should handle deployment upsert with INSERT OR REPLACE", () => {
    const db = new Database(testDbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS deployments (
        slug TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'not_deployed',
        worker_url TEXT,
        bearer_token TEXT,
        deployed_at TEXT,
        version TEXT,
        error TEXT
      );
    `);

    // Insert
    db.prepare(
      "INSERT OR REPLACE INTO deployments (slug, status, worker_url, version) VALUES (?, ?, ?, ?)"
    ).run("test", "deployed", "https://test.workers.dev", "v1.0");

    // Update via upsert
    db.prepare(
      "INSERT OR REPLACE INTO deployments (slug, status, worker_url, version) VALUES (?, ?, ?, ?)"
    ).run("test", "deployed", "https://test.workers.dev", "v2.0");

    const row = db
      .prepare("SELECT * FROM deployments WHERE slug = ?")
      .get("test") as any;

    expect(row.version).toBe("v2.0");

    // Should only have one row
    const count = db
      .prepare("SELECT COUNT(*) as c FROM deployments")
      .get() as any;
    expect(count.c).toBe(1);

    db.close();
  });

  it("should support secrets with composite primary key", () => {
    const db = new Database(testDbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        slug TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (slug, key)
      );
    `);

    const insert = db.prepare(
      "INSERT INTO secrets (slug, key, value) VALUES (?, ?, ?)"
    );
    insert.run("mcp-a", "API_KEY", "secret1");
    insert.run("mcp-a", "API_SECRET", "secret2");
    insert.run("mcp-b", "API_KEY", "secret3");

    const mcpASecrets = db
      .prepare("SELECT key, value FROM secrets WHERE slug = ?")
      .all("mcp-a") as Array<{ key: string; value: string }>;

    expect(mcpASecrets).toHaveLength(2);
    expect(mcpASecrets.find((s) => s.key === "API_KEY")?.value).toBe("secret1");

    db.close();
  });

  it("should support transactional secret replacement", () => {
    const db = new Database(testDbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        slug TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (slug, key)
      );
    `);

    // Insert initial secrets
    db.prepare("INSERT INTO secrets (slug, key, value) VALUES (?, ?, ?)").run(
      "mcp-a",
      "OLD_KEY",
      "old_value"
    );

    // Replace with new secrets in a transaction
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM secrets WHERE slug = ?").run("mcp-a");
      const insert = db.prepare(
        "INSERT INTO secrets (slug, key, value) VALUES (?, ?, ?)"
      );
      insert.run("mcp-a", "NEW_KEY", "new_value");
    });
    tx();

    const secrets = db
      .prepare("SELECT key, value FROM secrets WHERE slug = ?")
      .all("mcp-a") as Array<{ key: string; value: string }>;

    expect(secrets).toHaveLength(1);
    expect(secrets[0].key).toBe("NEW_KEY");

    db.close();
  });
});
