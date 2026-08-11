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
  getDeploymentJWTSecret,
  setDeploymentJWTSecret,
} from "../oauth/store";

function createTestDb(): Database.Database {
  if (!existsSync(TEST_DATA_DIR)) {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  const dbPath = join(
    TEST_DATA_DIR,
    `oauth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jwt_secrets (
      slug TEXT PRIMARY KEY,
      secret TEXT NOT NULL
    );
  `);
  return db;
}

describe("per-deployment JWT signing secret", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  it("returns null when no secret is stored", async () => {
    expect(await getDeploymentJWTSecret("nope")).toBeNull();
  });

  it("round-trips a secret", async () => {
    await setDeploymentJWTSecret("zotero", "super-secret-signing-key");
    expect(await getDeploymentJWTSecret("zotero")).toBe(
      "super-secret-signing-key"
    );
  });

  it("stores the secret encrypted at rest", async () => {
    await setDeploymentJWTSecret("zotero", "super-secret-signing-key");
    const raw = testDb
      .prepare("SELECT secret FROM jwt_secrets WHERE slug = ?")
      .get("zotero") as { secret: string };
    // encrypt() emits iv:authTag:ciphertext, never the plaintext.
    expect(raw.secret).not.toContain("super-secret-signing-key");
    expect(raw.secret.split(":")).toHaveLength(3);
  });

  it("reuse-on-redeploy: a second read returns the same secret", async () => {
    // This is the property the deploy path relies on to avoid rotating the
    // signing key (and invalidating live tokens) on every redeploy.
    await setDeploymentJWTSecret("zotero", "first");
    const reused = await getDeploymentJWTSecret("zotero");
    expect(reused).toBe("first");
  });

  it("isolates secrets per slug", async () => {
    await setDeploymentJWTSecret("a", "secret-a");
    await setDeploymentJWTSecret("b", "secret-b");
    expect(await getDeploymentJWTSecret("a")).toBe("secret-a");
    expect(await getDeploymentJWTSecret("b")).toBe("secret-b");
  });
});
