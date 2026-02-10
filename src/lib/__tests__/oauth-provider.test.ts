import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { createHash } from "crypto";

const TEST_DATA_DIR = join(process.cwd(), "data", ".test-oauth-provider");
let testDb: Database.Database;

vi.mock("../db", () => ({
  getDb: () => testDb,
}));

process.env.ENCRYPTION_KEY = "test-oauth-provider-encrypt-key1";

import {
  getIssuerUrl,
  getAuthServerMetadata,
  registerClient,
  validateAuthorizeParams,
  generateAuthCode,
  exchangeCodeForToken,
} from "../oauth/provider";
import { storeOAuthClient } from "../oauth/store";
import { mapWorkerUrlToSlug, setDeploymentJWTSecret } from "../oauth/store";
import type { OAuthClient } from "../oauth/types";

function createTestDb(): Database.Database {
  if (!existsSync(TEST_DATA_DIR)) {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  const dbPath = join(TEST_DATA_DIR, `provider-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

describe("getIssuerUrl", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
  });

  it("should use APP_URL if set", () => {
    process.env.APP_URL = "https://custom.example.com";
    expect(getIssuerUrl()).toBe("https://custom.example.com");
  });

  it("should fall back to localhost", () => {
    expect(getIssuerUrl()).toBe("http://localhost:3000");
  });
});

import { afterEach } from "vitest";

describe("getAuthServerMetadata", () => {
  it("should return valid metadata shape", () => {
    const meta = getAuthServerMetadata();
    expect(meta.authorization_endpoint).toContain("/oauth/authorize");
    expect(meta.token_endpoint).toContain("/api/oauth/token");
    expect(meta.registration_endpoint).toContain("/api/oauth/register");
    expect(meta.response_types_supported).toEqual(["code"]);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
  });
});

describe("registerClient", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  it("should register a client with valid redirect_uris", async () => {
    const result = await registerClient({
      redirect_uris: ["https://example.com/callback"],
      client_name: "My App",
    });

    expect("error" in result).toBe(false);
    const client = result as OAuthClient;
    expect(client.client_id).toBeDefined();
    expect(client.client_secret).toBeDefined();
    expect(client.client_name).toBe("My App");
    expect(client.redirect_uris).toEqual(["https://example.com/callback"]);
  });

  it("should reject registration without redirect_uris", async () => {
    const result = await registerClient({});
    expect("error" in result).toBe(true);
    expect((result as any).error).toBe("invalid_client_metadata");
  });

  it("should reject empty redirect_uris array", async () => {
    const result = await registerClient({ redirect_uris: [] });
    expect("error" in result).toBe(true);
  });

  it("should set default grant_types and response_types", async () => {
    const result = await registerClient({
      redirect_uris: ["https://example.com/callback"],
    });
    const client = result as OAuthClient;
    expect(client.grant_types).toEqual(["authorization_code"]);
    expect(client.response_types).toEqual(["code"]);
  });
});

describe("validateAuthorizeParams", () => {
  const validParams = {
    client_id: "client123",
    redirect_uri: "https://example.com/callback",
    response_type: "code",
    code_challenge: "challenge-value",
    code_challenge_method: "S256",
  };

  it("should accept valid params", () => {
    const result = validateAuthorizeParams(validParams);
    expect("error" in result).toBe(false);
    expect((result as any).client_id).toBe("client123");
  });

  it("should reject missing client_id", () => {
    const result = validateAuthorizeParams({ ...validParams, client_id: undefined });
    expect("error" in result).toBe(true);
    expect((result as any).error).toBe("invalid_request");
  });

  it("should reject missing redirect_uri", () => {
    const result = validateAuthorizeParams({ ...validParams, redirect_uri: undefined });
    expect("error" in result).toBe(true);
  });

  it("should reject non-code response_type", () => {
    const result = validateAuthorizeParams({ ...validParams, response_type: "token" });
    expect("error" in result).toBe(true);
    expect((result as any).error).toBe("unsupported_response_type");
  });

  it("should reject missing code_challenge (PKCE mandatory)", () => {
    const result = validateAuthorizeParams({ ...validParams, code_challenge: undefined });
    expect("error" in result).toBe(true);
  });

  it("should reject non-S256 code_challenge_method", () => {
    const result = validateAuthorizeParams({ ...validParams, code_challenge_method: "plain" });
    expect("error" in result).toBe(true);
  });

  it("should default scope to 'mcp'", () => {
    const result = validateAuthorizeParams(validParams);
    expect((result as any).scope).toBe("mcp");
  });

  it("should pass through state and resource", () => {
    const result = validateAuthorizeParams({
      ...validParams,
      state: "xyz",
      resource: "https://my-worker.workers.dev",
    });
    expect((result as any).state).toBe("xyz");
    expect((result as any).resource).toBe("https://my-worker.workers.dev");
  });
});

describe("generateAuthCode", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  it("should generate a hex code string", async () => {
    const code = await generateAuthCode({
      client_id: "client123",
      redirect_uri: "https://example.com/callback",
      response_type: "code",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      scope: "mcp",
      resource: "https://worker.workers.dev",
    });

    expect(code).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("exchangeCodeForToken", () => {
  const codeVerifier = "a-random-code-verifier-string-for-pkce-testing";
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  beforeEach(async () => {
    testDb = createTestDb();
    // Set up the worker URL mapping and JWT secret
    mapWorkerUrlToSlug("https://my-worker.workers.dev", "test-mcp");
    setDeploymentJWTSecret("test-mcp", "jwt-signing-secret");
  });

  async function createValidCode(): Promise<string> {
    return generateAuthCode({
      client_id: "client123",
      redirect_uri: "https://example.com/callback",
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope: "mcp",
      resource: "https://my-worker.workers.dev",
    });
  }

  it("should exchange valid code for access token", async () => {
    const code = await createValidCode();

    const result = await exchangeCodeForToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://example.com/callback",
      client_id: "client123",
      code_verifier: codeVerifier,
    });

    expect("error" in result).toBe(false);
    const token = result as { access_token: string; token_type: string; expires_in: number };
    expect(token.access_token).toBeDefined();
    expect(token.token_type).toBe("Bearer");
    expect(token.expires_in).toBe(3600);
  });

  it("should reject unsupported grant_type", async () => {
    const result = await exchangeCodeForToken({
      grant_type: "client_credentials",
      code: "any",
      redirect_uri: "https://example.com/callback",
      client_id: "client123",
      code_verifier: "any",
    });

    expect("error" in result).toBe(true);
    expect((result as any).error).toBe("unsupported_grant_type");
  });

  it("should reject invalid code", async () => {
    const result = await exchangeCodeForToken({
      grant_type: "authorization_code",
      code: "invalid-code",
      redirect_uri: "https://example.com/callback",
      client_id: "client123",
      code_verifier: codeVerifier,
    });

    expect("error" in result).toBe(true);
    expect((result as any).error).toBe("invalid_grant");
  });

  it("should reject mismatched client_id", async () => {
    const code = await createValidCode();

    const result = await exchangeCodeForToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://example.com/callback",
      client_id: "wrong-client",
      code_verifier: codeVerifier,
    });

    expect("error" in result).toBe(true);
    expect((result as any).error_description).toContain("client_id");
  });

  it("should reject mismatched redirect_uri", async () => {
    const code = await createValidCode();

    const result = await exchangeCodeForToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://evil.com/callback",
      client_id: "client123",
      code_verifier: codeVerifier,
    });

    expect("error" in result).toBe(true);
    expect((result as any).error_description).toContain("redirect_uri");
  });

  it("should reject wrong PKCE code_verifier", async () => {
    const code = await createValidCode();

    const result = await exchangeCodeForToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://example.com/callback",
      client_id: "client123",
      code_verifier: "wrong-verifier",
    });

    expect("error" in result).toBe(true);
    expect((result as any).error_description).toContain("PKCE");
  });

  it("should consume code on successful exchange (single use)", async () => {
    const code = await createValidCode();

    // First exchange succeeds
    const result1 = await exchangeCodeForToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://example.com/callback",
      client_id: "client123",
      code_verifier: codeVerifier,
    });
    expect("error" in result1).toBe(false);

    // Second exchange fails
    const result2 = await exchangeCodeForToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://example.com/callback",
      client_id: "client123",
      code_verifier: codeVerifier,
    });
    expect("error" in result2).toBe(true);
    expect((result2 as any).error).toBe("invalid_grant");
  });
});
