import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync, existsSync, rmSync } from "fs";

// We'll test the store functions by mocking the db module to return a test DB
const TEST_DATA_DIR = join(process.cwd(), "data", ".test-store");
let testDb: Database.Database;

vi.mock("../db", () => ({
  getDb: () => testDb,
}));

// Set encryption key before importing store (which may trigger encryption)
process.env.ENCRYPTION_KEY = "test-store-encryption-key-1234567";

import {
  getMcps,
  setMcps,
  addMcp,
  removeMcp,
  getDeployment,
  setDeployment,
  getMcpSecrets,
  setMcpSecrets,
  getMcpBearerToken,
  hasSeededDefaults,
  markSeededDefaults,
  resetSeededDefaults,
} from "../store";

function createSchema(db: Database.Database) {
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
  `);
}

describe("store", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DATA_DIR)) {
      mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
    testDb = new Database(":memory:");
    createSchema(testDb);
  });

  afterEach(() => {
    testDb.close();
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ─── MCPs ───

  describe("getMcps / setMcps", () => {
    it("should return empty array when no MCPs", async () => {
      const mcps = await getMcps();
      expect(mcps).toEqual([]);
    });

    it("should store and retrieve MCPs", async () => {
      await setMcps([
        {
          slug: "test-mcp",
          githubRepo: "user/repo",
          releaseTag: "latest",
          addedAt: "2026-01-01T00:00:00Z",
          isDefault: true,
        },
      ]);

      const mcps = await getMcps();
      expect(mcps).toHaveLength(1);
      expect(mcps[0].slug).toBe("test-mcp");
      expect(mcps[0].githubRepo).toBe("user/repo");
      expect(mcps[0].isDefault).toBe(true);
    });

    it("should replace all MCPs on setMcps", async () => {
      await setMcps([
        {
          slug: "mcp-a",
          githubRepo: "user/a",
          releaseTag: "latest",
          addedAt: "2026-01-01T00:00:00Z",
        },
      ]);

      await setMcps([
        {
          slug: "mcp-b",
          githubRepo: "user/b",
          releaseTag: "v1.0",
          addedAt: "2026-01-02T00:00:00Z",
        },
      ]);

      const mcps = await getMcps();
      expect(mcps).toHaveLength(1);
      expect(mcps[0].slug).toBe("mcp-b");
    });
  });

  describe("addMcp", () => {
    it("should add an MCP", async () => {
      await addMcp({
        slug: "new-mcp",
        githubRepo: "user/new",
        releaseTag: "latest",
        addedAt: "2026-01-01T00:00:00Z",
      });

      const mcps = await getMcps();
      expect(mcps).toHaveLength(1);
      expect(mcps[0].slug).toBe("new-mcp");
    });

    it("should throw on duplicate slug", async () => {
      await addMcp({
        slug: "dup",
        githubRepo: "user/a",
        releaseTag: "latest",
        addedAt: "2026-01-01T00:00:00Z",
      });

      await expect(
        addMcp({
          slug: "dup",
          githubRepo: "user/b",
          releaseTag: "latest",
          addedAt: "2026-01-02T00:00:00Z",
        })
      ).rejects.toThrow('MCP with slug "dup" already exists');
    });
  });

  describe("removeMcp", () => {
    it("should remove an MCP by slug", async () => {
      await addMcp({
        slug: "to-remove",
        githubRepo: "user/repo",
        releaseTag: "latest",
        addedAt: "2026-01-01T00:00:00Z",
      });

      await removeMcp("to-remove");
      const mcps = await getMcps();
      expect(mcps).toHaveLength(0);
    });

    it("should not throw when removing non-existent slug", async () => {
      await expect(removeMcp("nonexistent")).resolves.toBeUndefined();
    });
  });

  // ─── Deployments ───

  describe("getDeployment / setDeployment", () => {
    it("should return null for non-existent deployment", async () => {
      const dep = await getDeployment("nonexistent");
      expect(dep).toBeNull();
    });

    it("should store and retrieve a deployment", async () => {
      await setDeployment({
        slug: "test",
        status: "deployed",
        workerUrl: "https://test.workers.dev",
        bearerToken: "encrypted-token",
        deployedAt: "2026-01-01T00:00:00Z",
        version: "v1.0",
      });

      const dep = await getDeployment("test");
      expect(dep).not.toBeNull();
      expect(dep!.slug).toBe("test");
      expect(dep!.status).toBe("deployed");
      expect(dep!.workerUrl).toBe("https://test.workers.dev");
      expect(dep!.bearerToken).toBe("encrypted-token");
      expect(dep!.version).toBe("v1.0");
    });

    it("should upsert deployment on repeated set", async () => {
      await setDeployment({
        slug: "test",
        status: "deployed",
        workerUrl: "https://test.workers.dev",
        bearerToken: null,
        deployedAt: null,
        version: "v1.0",
      });

      await setDeployment({
        slug: "test",
        status: "deployed",
        workerUrl: "https://test.workers.dev",
        bearerToken: "new-token",
        deployedAt: "2026-01-02T00:00:00Z",
        version: "v2.0",
      });

      const dep = await getDeployment("test");
      expect(dep!.version).toBe("v2.0");
      expect(dep!.bearerToken).toBe("new-token");
    });

    it("should handle error field", async () => {
      await setDeployment({
        slug: "failed",
        status: "failed",
        workerUrl: null,
        bearerToken: null,
        deployedAt: null,
        version: "v1.0",
        error: "Deploy failed: timeout",
      });

      const dep = await getDeployment("failed");
      expect(dep!.status).toBe("failed");
      expect(dep!.error).toBe("Deploy failed: timeout");
    });

    it("should omit error field when null", async () => {
      await setDeployment({
        slug: "ok",
        status: "deployed",
        workerUrl: "https://ok.workers.dev",
        bearerToken: null,
        deployedAt: null,
        version: "v1.0",
      });

      const dep = await getDeployment("ok");
      expect(dep!.error).toBeUndefined();
    });
  });

  describe("getMcpBearerToken", () => {
    it("should return null when no deployment exists", async () => {
      const token = await getMcpBearerToken("nonexistent");
      expect(token).toBeNull();
    });

    it("should return bearer token from deployment", async () => {
      await setDeployment({
        slug: "test",
        status: "deployed",
        workerUrl: "https://test.workers.dev",
        bearerToken: "the-token",
        deployedAt: null,
        version: "v1.0",
      });

      const token = await getMcpBearerToken("test");
      expect(token).toBe("the-token");
    });
  });

  // ─── Secrets ───

  describe("getMcpSecrets / setMcpSecrets", () => {
    it("should return null when no secrets exist", async () => {
      const secrets = await getMcpSecrets("nonexistent");
      expect(secrets).toBeNull();
    });

    it("should store and retrieve secrets", async () => {
      await setMcpSecrets("test", {
        API_KEY: "key123",
        API_SECRET: "secret456",
      });

      const secrets = await getMcpSecrets("test");
      expect(secrets).toEqual({
        API_KEY: "key123",
        API_SECRET: "secret456",
      });
    });

    it("should replace secrets on repeated set", async () => {
      await setMcpSecrets("test", { OLD_KEY: "old" });
      await setMcpSecrets("test", { NEW_KEY: "new" });

      const secrets = await getMcpSecrets("test");
      expect(secrets).toEqual({ NEW_KEY: "new" });
      expect(secrets!.OLD_KEY).toBeUndefined();
    });

    it("should skip empty string values", async () => {
      await setMcpSecrets("test", {
        FILLED: "value",
        EMPTY: "",
      });

      const secrets = await getMcpSecrets("test");
      expect(secrets).toEqual({ FILLED: "value" });
    });

    it("should isolate secrets per slug", async () => {
      await setMcpSecrets("mcp-a", { KEY_A: "a" });
      await setMcpSecrets("mcp-b", { KEY_B: "b" });

      const secretsA = await getMcpSecrets("mcp-a");
      const secretsB = await getMcpSecrets("mcp-b");

      expect(secretsA).toEqual({ KEY_A: "a" });
      expect(secretsB).toEqual({ KEY_B: "b" });
    });
  });

  // ─── Seeding ───

  describe("seeding defaults", () => {
    it("should default to false", async () => {
      expect(await hasSeededDefaults()).toBe(false);
    });

    it("should mark seeded defaults", async () => {
      await markSeededDefaults();
      expect(await hasSeededDefaults()).toBe(true);
    });

    it("should reset seeded defaults", async () => {
      await markSeededDefaults();
      await resetSeededDefaults();
      expect(await hasSeededDefaults()).toBe(false);
    });
  });
});
