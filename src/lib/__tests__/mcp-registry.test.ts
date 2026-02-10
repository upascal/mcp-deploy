import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync, existsSync, rmSync } from "fs";

// Set up test DB before importing modules that use it
const TEST_DATA_DIR = join(process.cwd(), "data", ".test-registry");
let testDb: Database.Database;

vi.mock("../db", () => ({
  getDb: () => testDb,
}));

process.env.ENCRYPTION_KEY = "test-registry-encryption-key-123";

// Mock github-releases to avoid real network calls
vi.mock("../github-releases", () => ({
  fetchMcpMetadata: vi.fn(),
  getLatestVersion: vi.fn(),
}));

import {
  seedDefaultsIfNeeded,
  getAllMcps,
  getStoredMcp,
  resolveMcpEntry,
  checkForUpdate,
  DEFAULT_MCPS,
} from "../mcp-registry";
import { getMcps, addMcp, hasSeededDefaults } from "../store";
import { fetchMcpMetadata, getLatestVersion } from "../github-releases";

function createTestDb(): Database.Database {
  if (!existsSync(TEST_DATA_DIR)) {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  const dbPath = join(TEST_DATA_DIR, `registry-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS mcps (
      slug TEXT PRIMARY KEY,
      github_repo TEXT NOT NULL,
      release_tag TEXT NOT NULL DEFAULT 'latest',
      added_at TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deployments (
      slug TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      worker_url TEXT,
      bearer_token TEXT,
      oauth_password TEXT,
      auth_mode TEXT NOT NULL DEFAULT 'bearer',
      deployed_at TEXT,
      version TEXT NOT NULL DEFAULT '',
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS secrets (
      slug TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (slug, key)
    );
    CREATE TABLE IF NOT EXISTS metadata_cache (
      slug TEXT PRIMARY KEY,
      metadata TEXT NOT NULL,
      bundle_url TEXT NOT NULL,
      version TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe("mcp-registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDb = createTestDb();
  });

  describe("seedDefaultsIfNeeded", () => {
    it("should seed default MCPs on first run", async () => {
      await seedDefaultsIfNeeded();

      const mcps = await getMcps();
      expect(mcps.length).toBe(DEFAULT_MCPS.length);

      for (const def of DEFAULT_MCPS) {
        const found = mcps.find((m) => m.slug === def.slug);
        expect(found).toBeDefined();
        expect(found!.githubRepo).toBe(def.githubRepo);
        expect(found!.isDefault).toBe(true);
      }
    });

    it("should not seed twice", async () => {
      await seedDefaultsIfNeeded();
      const countBefore = (await getMcps()).length;

      await seedDefaultsIfNeeded();
      const countAfter = (await getMcps()).length;

      expect(countAfter).toBe(countBefore);
    });

    it("should skip duplicates gracefully", async () => {
      // Manually add one default MCP first
      await addMcp({
        slug: DEFAULT_MCPS[0].slug,
        githubRepo: DEFAULT_MCPS[0].githubRepo,
        releaseTag: "latest",
        addedAt: new Date().toISOString(),
      });

      await seedDefaultsIfNeeded();

      const mcps = await getMcps();
      // Should still have all defaults (skipped the duplicate)
      expect(mcps.length).toBe(DEFAULT_MCPS.length);
    });
  });

  describe("getAllMcps", () => {
    it("should seed defaults and return MCPs", async () => {
      const mcps = await getAllMcps();
      expect(mcps.length).toBe(DEFAULT_MCPS.length);
    });

    it("should include user-added MCPs", async () => {
      await addMcp({
        slug: "custom-mcp",
        githubRepo: "user/custom-mcp-remote",
        releaseTag: "latest",
        addedAt: new Date().toISOString(),
      });

      const mcps = await getAllMcps();
      expect(mcps.length).toBe(DEFAULT_MCPS.length + 1);
      expect(mcps.find((m) => m.slug === "custom-mcp")).toBeDefined();
    });
  });

  describe("getStoredMcp", () => {
    it("should return MCP by slug", async () => {
      const mcp = await getStoredMcp(DEFAULT_MCPS[0].slug);
      expect(mcp).toBeDefined();
      expect(mcp!.slug).toBe(DEFAULT_MCPS[0].slug);
    });

    it("should return undefined for non-existent slug", async () => {
      const mcp = await getStoredMcp("non-existent");
      expect(mcp).toBeUndefined();
    });
  });

  describe("resolveMcpEntry", () => {
    it("should fetch and return resolved entry", async () => {
      const mockMetadata = {
        metadata: {
          name: "Test MCP",
          description: "A test MCP",
          version: "0.1.0",
          worker: {
            name: "test-worker",
            durableObjectBinding: "MCP_OBJ",
            durableObjectClassName: "TestMCP",
            compatibilityDate: "2024-12-01",
            compatibilityFlags: ["nodejs_compat"],
            migrationTag: "v1",
          },
          secrets: [{ key: "API_KEY", label: "API Key", required: true }],
          config: [],
          autoSecrets: ["BEARER_TOKEN"],
        },
        bundleUrl: "https://github.com/owner/repo/releases/download/v0.1.0/worker.mjs",
        version: "v0.1.0",
      };

      vi.mocked(fetchMcpMetadata).mockResolvedValue(mockMetadata);

      const entry = {
        slug: "test-mcp",
        githubRepo: "owner/test-mcp-remote",
        releaseTag: "latest",
        addedAt: new Date().toISOString(),
      };

      const resolved = await resolveMcpEntry(entry);

      expect(resolved.name).toBe("Test MCP");
      expect(resolved.workerName).toBe("test-worker");
      expect(resolved.version).toBe("v0.1.0");
      expect(resolved.secrets).toHaveLength(1);
      expect(resolved.secrets[0].key).toBe("API_KEY");
      expect(resolved.bundleUrl).toContain("worker.mjs");
    });

    it("should use cached metadata within TTL", async () => {
      const mockMetadata = {
        metadata: {
          name: "Cached MCP",
          description: "test",
          version: "0.1.0",
          worker: {
            name: "cached-worker",
            durableObjectBinding: "MCP_OBJ",
            durableObjectClassName: "CachedMCP",
            compatibilityDate: "2024-12-01",
            compatibilityFlags: [],
            migrationTag: "v1",
          },
          secrets: [],
          config: [],
          autoSecrets: [],
        },
        bundleUrl: "https://example.com/worker.mjs",
        version: "v0.2.0",
      };

      vi.mocked(fetchMcpMetadata).mockResolvedValue(mockMetadata);

      const entry = {
        slug: "cached-mcp",
        githubRepo: "owner/cached-mcp-remote",
        releaseTag: "latest",
        addedAt: new Date().toISOString(),
      };

      // First call — fetches
      await resolveMcpEntry(entry);
      expect(fetchMcpMetadata).toHaveBeenCalledTimes(1);

      // Second call — uses cache
      const resolved = await resolveMcpEntry(entry);
      expect(fetchMcpMetadata).toHaveBeenCalledTimes(1); // still 1
      expect(resolved.name).toBe("Cached MCP");
    });
  });

  describe("checkForUpdate", () => {
    it("should detect update available", async () => {
      vi.mocked(getLatestVersion).mockResolvedValue("v0.2.0");

      const result = await checkForUpdate(
        {
          slug: "test-mcp",
          githubRepo: "owner/test-mcp-remote",
          releaseTag: "latest",
          addedAt: new Date().toISOString(),
        },
        "v0.1.0"
      );

      expect(result.updateAvailable).toBe(true);
      expect(result.latestVersion).toBe("v0.2.0");
    });

    it("should not detect update when versions match", async () => {
      vi.mocked(getLatestVersion).mockResolvedValue("v0.1.0");

      const result = await checkForUpdate(
        {
          slug: "test-mcp",
          githubRepo: "owner/test-mcp-remote",
          releaseTag: "latest",
          addedAt: new Date().toISOString(),
        },
        "v0.1.0"
      );

      expect(result.updateAvailable).toBe(false);
    });

    it("should not check for update when pinned to a release tag", async () => {
      const result = await checkForUpdate(
        {
          slug: "test-mcp",
          githubRepo: "owner/test-mcp-remote",
          releaseTag: "v0.1.0", // pinned
          addedAt: new Date().toISOString(),
        },
        "v0.1.0"
      );

      expect(result.updateAvailable).toBe(false);
      expect(getLatestVersion).not.toHaveBeenCalled();
    });

    it("should handle null deployed version", async () => {
      vi.mocked(getLatestVersion).mockResolvedValue("v0.1.0");

      const result = await checkForUpdate(
        {
          slug: "test-mcp",
          githubRepo: "owner/test-mcp-remote",
          releaseTag: "latest",
          addedAt: new Date().toISOString(),
        },
        null
      );

      expect(result.updateAvailable).toBe(false);
    });
  });
});
