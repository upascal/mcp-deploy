import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const TEST_DATA_DIR = join(process.cwd(), "data", ".test-oauth-store");
let testDb: Database.Database;

vi.mock("../db", () => ({
  getDb: () => testDb,
}));

process.env.ENCRYPTION_KEY = "test-oauth-store-encryption-key12";

import {
  getOAuthClient,
  storeOAuthClient,
  deleteOAuthClient,
  storeAuthCode,
  getAuthCode,
  deleteAuthCode,
  getDeploymentJWTSecret,
  setDeploymentJWTSecret,
  getSlugForWorkerUrl,
  mapWorkerUrlToSlug,
} from "../oauth/store";
import type { OAuthClient, AuthorizationCode } from "../oauth/types";

function createTestDb(): Database.Database {
  if (!existsSync(TEST_DATA_DIR)) {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  const dbPath = join(TEST_DATA_DIR, `oauth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
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
  return db;
}

const mockClient: OAuthClient = {
  client_id: "test-client-123",
  client_secret: "secret-456",
  client_name: "Test Client",
  redirect_uris: ["https://example.com/callback"],
  grant_types: ["authorization_code"],
  response_types: ["code"],
  scope: "mcp",
  token_endpoint_auth_method: "client_secret_post",
  created_at: Math.floor(Date.now() / 1000),
};

const now = Math.floor(Date.now() / 1000);
const mockAuthCode: AuthorizationCode = {
  code: "auth-code-abc",
  clientId: "test-client-123",
  redirectUri: "https://example.com/callback",
  codeChallenge: "challenge123",
  codeChallengeMethod: "S256",
  scope: "mcp",
  resource: "https://my-worker.workers.dev",
  createdAt: now,
  expiresAt: now + 600,
};

describe("OAuth client store", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  it("should store and retrieve a client", async () => {
    storeOAuthClient(mockClient);
    const retrieved = getOAuthClient("test-client-123");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.client_id).toBe("test-client-123");
    expect(retrieved!.client_name).toBe("Test Client");
    expect(retrieved!.redirect_uris).toEqual(["https://example.com/callback"]);
  });

  it("should return null for non-existent client", async () => {
    const result = getOAuthClient("non-existent");
    expect(result).toBeNull();
  });

  it("should delete a client", async () => {
    storeOAuthClient(mockClient);
    deleteOAuthClient("test-client-123");
    const result = getOAuthClient("test-client-123");
    expect(result).toBeNull();
  });

  it("should overwrite client on re-store", async () => {
    storeOAuthClient(mockClient);
    storeOAuthClient({ ...mockClient, client_name: "Updated Client" });
    const retrieved = getOAuthClient("test-client-123");
    expect(retrieved!.client_name).toBe("Updated Client");
  });
});

describe("Authorization code store", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  it("should store and retrieve an auth code", async () => {
    storeAuthCode(mockAuthCode);
    const retrieved = getAuthCode("auth-code-abc");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.clientId).toBe("test-client-123");
    expect(retrieved!.codeChallenge).toBe("challenge123");
  });

  it("should return null for non-existent code", async () => {
    const result = getAuthCode("non-existent");
    expect(result).toBeNull();
  });

  it("should delete an auth code", async () => {
    storeAuthCode(mockAuthCode);
    deleteAuthCode("auth-code-abc");
    const result = getAuthCode("auth-code-abc");
    expect(result).toBeNull();
  });
});

describe("JWT secret store", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  it("should store and retrieve an encrypted JWT secret", async () => {
    setDeploymentJWTSecret("my-mcp", "super-secret-jwt-key");
    const retrieved = getDeploymentJWTSecret("my-mcp");
    expect(retrieved).toBe("super-secret-jwt-key");
  });

  it("should return null for non-existent slug", async () => {
    const result = getDeploymentJWTSecret("non-existent");
    expect(result).toBeNull();
  });

  it("should overwrite on re-set", async () => {
    setDeploymentJWTSecret("my-mcp", "old-secret");
    setDeploymentJWTSecret("my-mcp", "new-secret");
    const result = getDeploymentJWTSecret("my-mcp");
    expect(result).toBe("new-secret");
  });
});

describe("Worker URL mapping", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  it("should map worker URL to slug", async () => {
    mapWorkerUrlToSlug("https://my-worker.workers.dev", "my-mcp");
    const slug = getSlugForWorkerUrl("https://my-worker.workers.dev");
    expect(slug).toBe("my-mcp");
  });

  it("should return null for unmapped URL", async () => {
    const slug = getSlugForWorkerUrl("https://unknown.workers.dev");
    expect(slug).toBeNull();
  });

  it("should overwrite mapping on re-map", async () => {
    mapWorkerUrlToSlug("https://my-worker.workers.dev", "old-slug");
    mapWorkerUrlToSlug("https://my-worker.workers.dev", "new-slug");
    const slug = getSlugForWorkerUrl("https://my-worker.workers.dev");
    expect(slug).toBe("new-slug");
  });
});
