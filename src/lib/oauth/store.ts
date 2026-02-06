/**
 * KV storage for OAuth state: clients, authorization codes, and JWT secrets.
 */

import { kv } from "@vercel/kv";
import { encrypt, decrypt } from "../encryption";
import type { OAuthClient, AuthorizationCode } from "./types";

const AUTH_CODE_TTL = 600; // 10 minutes
const CLIENT_TTL = 60 * 60 * 24 * 365; // 1 year

// ─── OAuth Clients (Dynamic Client Registration) ───

export async function getOAuthClient(
  clientId: string
): Promise<OAuthClient | null> {
  return kv.get<OAuthClient>(`oauth:client:${clientId}`);
}

export async function storeOAuthClient(client: OAuthClient): Promise<void> {
  await kv.set(`oauth:client:${client.client_id}`, client, {
    ex: CLIENT_TTL,
  });
}

export async function deleteOAuthClient(clientId: string): Promise<void> {
  await kv.del(`oauth:client:${clientId}`);
}

// ─── Authorization Codes ───

export async function storeAuthCode(code: AuthorizationCode): Promise<void> {
  await kv.set(`oauth:code:${code.code}`, code, { ex: AUTH_CODE_TTL });
}

export async function getAuthCode(
  code: string
): Promise<AuthorizationCode | null> {
  return kv.get<AuthorizationCode>(`oauth:code:${code}`);
}

export async function deleteAuthCode(code: string): Promise<void> {
  await kv.del(`oauth:code:${code}`);
}

// ─── Per-Deployment JWT Secrets ───

export async function getDeploymentJWTSecret(
  slug: string
): Promise<string | null> {
  const encrypted = await kv.get<string>(`oauth:jwt-secret:${slug}`);
  if (!encrypted) return null;
  return decrypt(encrypted);
}

export async function setDeploymentJWTSecret(
  slug: string,
  secret: string
): Promise<void> {
  await kv.set(`oauth:jwt-secret:${slug}`, encrypt(secret));
}

/**
 * Find which deployment slug corresponds to a given worker URL.
 * Used during token issuance to find the JWT secret for a resource.
 */
export async function getSlugForWorkerUrl(
  workerUrl: string
): Promise<string | null> {
  return kv.get<string>(`oauth:url-to-slug:${workerUrl}`);
}

export async function mapWorkerUrlToSlug(
  workerUrl: string,
  slug: string
): Promise<void> {
  await kv.set(`oauth:url-to-slug:${workerUrl}`, slug);
}
