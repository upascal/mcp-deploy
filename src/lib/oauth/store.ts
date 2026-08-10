/**
 * OAuth storage facade — clients, authorization codes, JWT secrets, and the
 * worker-URL → slug mapping.
 *
 * These delegate to the active Store (see ../store), so they run against the
 * local SqliteStore or a hosted D1/Postgres backend without change. Kept as
 * free functions for the OAuth provider and routes that already import them.
 */

import { getStore } from "../store";
import type { OAuthClient, AuthorizationCode } from "./types";

export function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  return getStore().getOAuthClient(clientId);
}

export function storeOAuthClient(client: OAuthClient): Promise<void> {
  return getStore().storeOAuthClient(client);
}

export function deleteOAuthClient(clientId: string): Promise<void> {
  return getStore().deleteOAuthClient(clientId);
}

export function storeAuthCode(code: AuthorizationCode): Promise<void> {
  return getStore().storeAuthCode(code);
}

export function getAuthCode(code: string): Promise<AuthorizationCode | null> {
  return getStore().getAuthCode(code);
}

export function deleteAuthCode(code: string): Promise<void> {
  return getStore().deleteAuthCode(code);
}

export function getDeploymentJWTSecret(slug: string): Promise<string | null> {
  return getStore().getDeploymentJWTSecret(slug);
}

export function setDeploymentJWTSecret(
  slug: string,
  secret: string
): Promise<void> {
  return getStore().setDeploymentJWTSecret(slug, secret);
}

export function getSlugForWorkerUrl(workerUrl: string): Promise<string | null> {
  return getStore().getSlugForWorkerUrl(workerUrl);
}

export function mapWorkerUrlToSlug(
  workerUrl: string,
  slug: string
): Promise<void> {
  return getStore().mapWorkerUrlToSlug(workerUrl, slug);
}
