/**
 * Local JSON storage for OAuth state: clients, authorization codes, and JWT secrets.
 * Replaces @vercel/kv with a local file-based approach matching the main store.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { encrypt, decrypt } from "../encryption";
import type { OAuthClient, AuthorizationCode } from "./types";

const DATA_DIR = join(process.cwd(), "data");
const OAUTH_STORE_PATH = join(DATA_DIR, "oauth-store.json");

interface OAuthStore {
  clients: Record<string, { data: OAuthClient; expiresAt: number }>;
  authCodes: Record<string, { data: AuthorizationCode; expiresAt: number }>;
  jwtSecrets: Record<string, string>; // slug -> encrypted secret
  urlToSlug: Record<string, string>; // workerUrl -> slug
}

const EMPTY_STORE: OAuthStore = {
  clients: {},
  authCodes: {},
  jwtSecrets: {},
  urlToSlug: {},
};

const AUTH_CODE_TTL = 600; // 10 minutes
const CLIENT_TTL = 60 * 60 * 24 * 365; // 1 year

function readStore(): OAuthStore {
  try {
    if (!existsSync(OAUTH_STORE_PATH)) {
      return { ...EMPTY_STORE };
    }
    const raw = readFileSync(OAUTH_STORE_PATH, "utf-8");
    return JSON.parse(raw) as OAuthStore;
  } catch {
    return { ...EMPTY_STORE };
  }
}

function writeStore(store: OAuthStore): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(OAUTH_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── OAuth Clients (Dynamic Client Registration) ───

export async function getOAuthClient(
  clientId: string
): Promise<OAuthClient | null> {
  const store = readStore();
  const entry = store.clients[clientId];
  if (!entry) return null;
  if (entry.expiresAt < nowSeconds()) {
    // Expired — clean up
    delete store.clients[clientId];
    writeStore(store);
    return null;
  }
  return entry.data;
}

export async function storeOAuthClient(client: OAuthClient): Promise<void> {
  const store = readStore();
  store.clients[client.client_id] = {
    data: client,
    expiresAt: nowSeconds() + CLIENT_TTL,
  };
  writeStore(store);
}

export async function deleteOAuthClient(clientId: string): Promise<void> {
  const store = readStore();
  delete store.clients[clientId];
  writeStore(store);
}

// ─── Authorization Codes ───

export async function storeAuthCode(code: AuthorizationCode): Promise<void> {
  const store = readStore();
  store.authCodes[code.code] = {
    data: code,
    expiresAt: nowSeconds() + AUTH_CODE_TTL,
  };
  writeStore(store);
}

export async function getAuthCode(
  code: string
): Promise<AuthorizationCode | null> {
  const store = readStore();
  const entry = store.authCodes[code];
  if (!entry) return null;
  if (entry.expiresAt < nowSeconds()) {
    delete store.authCodes[code];
    writeStore(store);
    return null;
  }
  return entry.data;
}

export async function deleteAuthCode(code: string): Promise<void> {
  const store = readStore();
  delete store.authCodes[code];
  writeStore(store);
}

// ─── Per-Deployment JWT Secrets ───

export async function getDeploymentJWTSecret(
  slug: string
): Promise<string | null> {
  const store = readStore();
  const encrypted = store.jwtSecrets[slug];
  if (!encrypted) return null;
  return decrypt(encrypted);
}

export async function setDeploymentJWTSecret(
  slug: string,
  secret: string
): Promise<void> {
  const store = readStore();
  store.jwtSecrets[slug] = encrypt(secret);
  writeStore(store);
}

/**
 * Find which deployment slug corresponds to a given worker URL.
 * Used during token issuance to find the JWT secret for a resource.
 */
export async function getSlugForWorkerUrl(
  workerUrl: string
): Promise<string | null> {
  const store = readStore();
  return store.urlToSlug[workerUrl] ?? null;
}

export async function mapWorkerUrlToSlug(
  workerUrl: string,
  slug: string
): Promise<void> {
  const store = readStore();
  store.urlToSlug[workerUrl] = slug;
  writeStore(store);
}
