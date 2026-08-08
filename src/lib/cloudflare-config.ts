/**
 * Resolves the Cloudflare credentials the REST deploy path runs on.
 *
 * Three sources, in priority order:
 *   1. CLOUDFLARE_API_TOKEN in the environment.
 *   2. An API token the user saved explicitly (stored encrypted).
 *   3. The OAuth token `wrangler login` wrote to disk.
 *
 * Source 1 is how a hosted deployment supplies the single Cloudflare account
 * it owns — there is no wrangler binary or interactive login on a server.
 * Source 3 is what keeps the local UX unchanged: users still run
 * `wrangler login`, but nothing shells out to the wrangler CLI to deploy.
 */

import Cloudflare from "cloudflare";
import { CloudflareDeployService } from "./cloudflare-deploy";
import { decrypt } from "./encryption";
import { readWranglerToken } from "./wrangler-credentials";
import { refreshWranglerAuth } from "./wrangler";
import {
  getCfToken as getStoredToken,
  getCfAccountId as getStoredAccountId,
  setCfAccountId as setStoredAccountId,
} from "./store";

export interface CloudflareCredentials {
  apiToken: string;
  accountId: string;
  /** Where the token came from, for error messages. */
  source: "env" | "stored" | "wrangler";
}

/**
 * Tokens saved before encryption was added are plaintext. Decrypt only when
 * the value has the "iv:tag:ciphertext" shape written by encrypt().
 */
function readStoredToken(): string | null {
  const raw = getStoredToken();
  if (!raw) return null;
  if (raw.split(":").length !== 3) return raw;

  try {
    return decrypt(raw);
  } catch {
    return null;
  }
}

/**
 * Account IDs are not part of wrangler's stored config, so the first
 * wrangler-backed call resolves one from the API and caches it.
 */
async function resolveAccountId(
  apiToken: string,
  useCache = true
): Promise<string | null> {
  // The cache is not keyed by token, so a token from a different source could
  // otherwise inherit an account id belonging to another one.
  const cached = useCache ? getStoredAccountId() : null;
  if (cached) return cached;

  try {
    // accounts.list accepts both API tokens and wrangler's OAuth tokens.
    // CloudflareDeployService.validateToken cannot be used here: it calls
    // user.tokens.verify(), which rejects OAuth tokens with "Invalid API Token".
    const accounts = await new Cloudflare({ apiToken }).accounts.list({
      per_page: 1,
    });
    const id = accounts.result?.[0]?.id;
    if (!id) return null;

    setStoredAccountId(id);
    return id;
  } catch {
    return null;
  }
}

/**
 * Resolve usable Cloudflare credentials, or null if none are available.
 */
export async function getCredentials(): Promise<CloudflareCredentials | null> {
  // Environment wins. This is how a hosted deployment supplies the single
  // account it owns, where there is no wrangler binary and no interactive
  // login. Also covers headless self-hosting and CI.
  const envToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (envToken) {
    const envAccount =
      process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ||
      (await resolveAccountId(envToken, false));
    if (envAccount) {
      return { apiToken: envToken, accountId: envAccount, source: "env" };
    }
  }

  const storedToken = readStoredToken();
  if (storedToken) {
    const accountId = await resolveAccountId(storedToken);
    if (accountId) {
      return { apiToken: storedToken, accountId, source: "stored" };
    }
  }

  // Wrangler's access tokens expire hourly. When the stored one is stale, let
  // wrangler exchange its refresh token, then re-read — otherwise local users
  // would have to re-run `wrangler login` every hour.
  let wrangler = readWranglerToken();
  if (wrangler?.expired && refreshWranglerAuth()) {
    wrangler = readWranglerToken();
  }

  if (wrangler && !wrangler.expired) {
    const accountId = await resolveAccountId(wrangler.token);
    if (accountId) {
      return { apiToken: wrangler.token, accountId, source: "wrangler" };
    }
  }

  return null;
}

/**
 * Build a deploy service from whatever credentials are available.
 * Throws with actionable guidance rather than returning null, since every
 * caller needs credentials to do anything useful.
 */
export async function getDeployService(): Promise<CloudflareDeployService> {
  const creds = await getCredentials();
  if (!creds) {
    throw new Error(
      "Not logged in to Cloudflare. Run `npx wrangler login` first, or add an API token on the Settings page."
    );
  }
  return new CloudflareDeployService(creds.apiToken, creds.accountId);
}

/**
 * Check if Cloudflare is configured.
 */
export async function isCfConfigured(): Promise<boolean> {
  return (await getCredentials()) !== null;
}

/**
 * Get Cloudflare API token.
 */
export async function getCfToken(): Promise<string | null> {
  return (await getCredentials())?.apiToken ?? null;
}

/**
 * Get Cloudflare account ID.
 */
export async function getCfAccountId(): Promise<string | null> {
  return (await getCredentials())?.accountId ?? null;
}
