/**
 * SQLite-backed storage for OAuth state: clients, authorization codes, and JWT secrets.
 */

import { getDb } from "../db";
import { encrypt, decrypt } from "../encryption";
import type { OAuthClient, AuthorizationCode } from "./types";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Remove expired OAuth clients and auth codes. Called lazily on reads. */
function cleanupExpired(): void {
  const now = nowSeconds();
  const db = getDb();
  db.prepare("DELETE FROM oauth_clients WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(now);
}

const AUTH_CODE_TTL = 600; // 10 minutes
const CLIENT_TTL = 60 * 60 * 24 * 365; // 1 year

// ─── OAuth Clients (Dynamic Client Registration) ───

export async function getOAuthClient(
  clientId: string
): Promise<OAuthClient | null> {
  cleanupExpired();
  const row = getDb()
    .prepare(
      "SELECT data, expires_at FROM oauth_clients WHERE client_id = ?"
    )
    .get(clientId) as { data: string; expires_at: number } | undefined;

  if (!row) return null;
  return JSON.parse(row.data) as OAuthClient;
}

export async function storeOAuthClient(client: OAuthClient): Promise<void> {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO oauth_clients (client_id, data, expires_at) VALUES (?, ?, ?)"
    )
    .run(client.client_id, JSON.stringify(client), nowSeconds() + CLIENT_TTL);
}

export async function deleteOAuthClient(clientId: string): Promise<void> {
  getDb()
    .prepare("DELETE FROM oauth_clients WHERE client_id = ?")
    .run(clientId);
}

// ─── Authorization Codes ───

export async function storeAuthCode(code: AuthorizationCode): Promise<void> {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO oauth_codes (code, data, expires_at) VALUES (?, ?, ?)"
    )
    .run(code.code, JSON.stringify(code), nowSeconds() + AUTH_CODE_TTL);
}

export async function getAuthCode(
  code: string
): Promise<AuthorizationCode | null> {
  cleanupExpired();
  const row = getDb()
    .prepare("SELECT data, expires_at FROM oauth_codes WHERE code = ?")
    .get(code) as { data: string; expires_at: number } | undefined;

  if (!row) return null;
  return JSON.parse(row.data) as AuthorizationCode;
}

export async function deleteAuthCode(code: string): Promise<void> {
  getDb().prepare("DELETE FROM oauth_codes WHERE code = ?").run(code);
}

// ─── Per-Deployment JWT Secrets ───

export async function getDeploymentJWTSecret(
  slug: string
): Promise<string | null> {
  const row = getDb()
    .prepare("SELECT secret FROM jwt_secrets WHERE slug = ?")
    .get(slug) as { secret: string } | undefined;

  if (!row) return null;
  return decrypt(row.secret);
}

export async function setDeploymentJWTSecret(
  slug: string,
  secret: string
): Promise<void> {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO jwt_secrets (slug, secret) VALUES (?, ?)"
    )
    .run(slug, encrypt(secret));
}

/**
 * Find which deployment slug corresponds to a given worker URL.
 * Used during token issuance to find the JWT secret for a resource.
 */
export async function getSlugForWorkerUrl(
  workerUrl: string
): Promise<string | null> {
  const row = getDb()
    .prepare("SELECT slug FROM worker_url_mapping WHERE worker_url = ?")
    .get(workerUrl) as { slug: string } | undefined;

  return row?.slug ?? null;
}

export async function mapWorkerUrlToSlug(
  workerUrl: string,
  slug: string
): Promise<void> {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO worker_url_mapping (worker_url, slug) VALUES (?, ?)"
    )
    .run(workerUrl, slug);
}
