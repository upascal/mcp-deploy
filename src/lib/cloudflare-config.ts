import { checkWranglerLogin } from "./wrangler";

/**
 * Check if Cloudflare is configured (wrangler is logged in).
 */
export async function isCfConfigured(): Promise<boolean> {
    const { loggedIn } = checkWranglerLogin();
    return loggedIn;
}

/**
 * Get Cloudflare API token.
 * Since we use wrangler, this returns a placeholder.
 * Wrangler handles auth internally via its config.
 */
export async function getCfToken(): Promise<string | null> {
    const { loggedIn } = checkWranglerLogin();
    return loggedIn ? "wrangler-managed" : null;
}

/**
 * Get Cloudflare account ID.
 * Since we use wrangler, this returns a placeholder.
 * Wrangler handles account selection internally.
 */
export async function getCfAccountId(): Promise<string | null> {
    const { loggedIn } = checkWranglerLogin();
    return loggedIn ? "wrangler-managed" : null;
}
