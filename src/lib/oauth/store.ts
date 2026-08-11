/**
 * Per-deployment OAuth JWT signing secret.
 *
 * Each deployed worker is its own self-contained OAuth authorization server
 * (see worker-oauth-wrapper.ts) and holds its signing secret in
 * env.OAUTH_JWT_SECRET. These persist a copy (encrypted) so a redeploy reuses
 * the same secret rather than rotating it and invalidating every token clients
 * already hold. Delegates to the active Store.
 */

import { getStore } from "../store";

export function getDeploymentJWTSecret(slug: string): Promise<string | null> {
  return getStore().getDeploymentJWTSecret(slug);
}

export function setDeploymentJWTSecret(
  slug: string,
  secret: string
): Promise<void> {
  return getStore().setDeploymentJWTSecret(slug, secret);
}
