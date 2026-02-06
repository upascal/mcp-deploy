/**
 * SQLite database module for mcp-deploy.
 * Uses better-sqlite3 (synchronous API) for local storage.
 * Auto-creates tables on first run and migrates data from legacy JSON files.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync, readFileSync, renameSync } from "fs";
import { join } from "path";
import {
  createDecipheriv,
  scryptSync,
} from "crypto";
import { encrypt as currentEncrypt } from "./encryption";

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "mcp-deploy.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  createTables(db);
  migrateFromJson(db);

  return db;
}

function createTables(db: Database.Database): void {
  db.exec(`
    -- MCP registry
    CREATE TABLE IF NOT EXISTS mcps (
      slug TEXT PRIMARY KEY,
      github_repo TEXT NOT NULL,
      release_tag TEXT DEFAULT 'latest',
      added_at TEXT NOT NULL,
      is_default INTEGER DEFAULT 0
    );

    -- Deployment records
    CREATE TABLE IF NOT EXISTS deployments (
      slug TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'not_deployed',
      worker_url TEXT,
      bearer_token TEXT,
      deployed_at TEXT,
      version TEXT,
      error TEXT
    );

    -- MCP secrets (key-value per slug)
    CREATE TABLE IF NOT EXISTS secrets (
      slug TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (slug, key)
    );

    -- Config flags
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- OAuth clients
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    -- OAuth auth codes
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    -- JWT secrets per deployment
    CREATE TABLE IF NOT EXISTS jwt_secrets (
      slug TEXT PRIMARY KEY,
      secret TEXT NOT NULL
    );

    -- Worker URL to slug mapping
    CREATE TABLE IF NOT EXISTS worker_url_mapping (
      worker_url TEXT PRIMARY KEY,
      slug TEXT NOT NULL
    );
  `);
}

// ─── JSON → SQLite Migration ───

interface LegacyStore {
  mcps: Array<{
    slug: string;
    githubRepo: string;
    releaseTag: string;
    addedAt: string;
    isDefault?: boolean;
  }>;
  deployments: Record<
    string,
    {
      slug: string;
      status: string;
      workerUrl: string | null;
      bearerToken: string | null;
      deployedAt: string | null;
      version: string;
      error?: string;
    }
  >;
  secrets: Record<string, Record<string, string>>;
  seededDefaults: boolean;
  cfToken?: string;
  cfAccountId?: string;
}

interface LegacyOAuthStore {
  clients: Record<string, { data: unknown; expiresAt: number }>;
  authCodes: Record<string, { data: unknown; expiresAt: number }>;
  jwtSecrets: Record<string, string>;
  urlToSlug: Record<string, string>;
}

// Re-encrypt a value from the old hardcoded key to the current key.
// The old key was "mcp-deploy-local-dev-key" with salt "mcp-deploy-salt".
const LEGACY_KEY_SECRET = "mcp-deploy-local-dev-key";
const ENCRYPTION_SALT = "mcp-deploy-salt";

function legacyDecrypt(encryptedText: string): string | null {
  try {
    const key = scryptSync(LEGACY_KEY_SECRET, ENCRYPTION_SALT, 32);
    const parts = encryptedText.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

function migrateFromJson(db: Database.Database): void {
  const storePath = join(DATA_DIR, "store.json");
  const oauthStorePath = join(DATA_DIR, "oauth-store.json");

  // Check if we already migrated (config table has a marker)
  const migrated = db
    .prepare("SELECT value FROM config WHERE key = 'migrated_from_json'")
    .get() as { value: string } | undefined;
  if (migrated) return;

  // Migrate main store
  if (existsSync(storePath)) {
    try {
      const raw = readFileSync(storePath, "utf-8");
      const store: LegacyStore = JSON.parse(raw);

      const tx = db.transaction(() => {
        // MCPs
        const insertMcp = db.prepare(
          "INSERT OR IGNORE INTO mcps (slug, github_repo, release_tag, added_at, is_default) VALUES (?, ?, ?, ?, ?)"
        );
        for (const mcp of store.mcps) {
          insertMcp.run(
            mcp.slug,
            mcp.githubRepo,
            mcp.releaseTag,
            mcp.addedAt,
            mcp.isDefault ? 1 : 0
          );
        }

        // Deployments — re-encrypt bearer tokens with new key
        const insertDeploy = db.prepare(
          "INSERT OR IGNORE INTO deployments (slug, status, worker_url, bearer_token, deployed_at, version, error) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        for (const dep of Object.values(store.deployments)) {
          let token = dep.bearerToken;
          if (token) {
            const plaintext = legacyDecrypt(token);
            if (plaintext) {
              token = currentEncrypt(plaintext);
            }
            // If decrypt fails, keep original (might already be plain or use current key)
          }
          insertDeploy.run(
            dep.slug,
            dep.status,
            dep.workerUrl,
            token,
            dep.deployedAt,
            dep.version,
            dep.error ?? null
          );
        }

        // Secrets
        const insertSecret = db.prepare(
          "INSERT OR IGNORE INTO secrets (slug, key, value) VALUES (?, ?, ?)"
        );
        for (const [slug, secretMap] of Object.entries(store.secrets)) {
          for (const [key, value] of Object.entries(secretMap)) {
            insertSecret.run(slug, key, value);
          }
        }

        // Seeded defaults flag
        if (store.seededDefaults) {
          db.prepare(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('seeded_defaults', '1')"
          ).run();
        }
      });
      tx();

      renameSync(storePath, storePath + ".bak");
      console.log("[mcp-deploy] Migrated data/store.json → SQLite");
    } catch (err) {
      console.error("[mcp-deploy] Failed to migrate store.json:", err);
    }
  }

  // Migrate OAuth store
  if (existsSync(oauthStorePath)) {
    try {
      const raw = readFileSync(oauthStorePath, "utf-8");
      const store: LegacyOAuthStore = JSON.parse(raw);

      const tx = db.transaction(() => {
        const insertClient = db.prepare(
          "INSERT OR IGNORE INTO oauth_clients (client_id, data, expires_at) VALUES (?, ?, ?)"
        );
        for (const [clientId, entry] of Object.entries(store.clients)) {
          insertClient.run(clientId, JSON.stringify(entry.data), entry.expiresAt);
        }

        const insertCode = db.prepare(
          "INSERT OR IGNORE INTO oauth_codes (code, data, expires_at) VALUES (?, ?, ?)"
        );
        for (const [code, entry] of Object.entries(store.authCodes)) {
          insertCode.run(code, JSON.stringify(entry.data), entry.expiresAt);
        }

        // JWT secrets — re-encrypt with new key
        const insertJwt = db.prepare(
          "INSERT OR IGNORE INTO jwt_secrets (slug, secret) VALUES (?, ?)"
        );
        for (const [slug, secret] of Object.entries(store.jwtSecrets)) {
          let reEncrypted = secret;
          const plaintext = legacyDecrypt(secret);
          if (plaintext) {
            reEncrypted = currentEncrypt(plaintext);
          }
          insertJwt.run(slug, reEncrypted);
        }

        const insertUrl = db.prepare(
          "INSERT OR IGNORE INTO worker_url_mapping (worker_url, slug) VALUES (?, ?)"
        );
        for (const [url, slug] of Object.entries(store.urlToSlug)) {
          insertUrl.run(url, slug);
        }
      });
      tx();

      renameSync(oauthStorePath, oauthStorePath + ".bak");
      console.log("[mcp-deploy] Migrated data/oauth-store.json → SQLite");
    } catch (err) {
      console.error("[mcp-deploy] Failed to migrate oauth-store.json:", err);
    }
  }

  // Mark migration complete
  db.prepare(
    "INSERT OR REPLACE INTO config (key, value) VALUES ('migrated_from_json', '1')"
  ).run();
}
