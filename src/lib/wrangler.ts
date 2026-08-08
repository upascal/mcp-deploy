/**
 * Wrangler CLI wrapper — authentication only.
 *
 * Deploys, secrets and KV all run through CloudflareDeployService over the
 * REST API now. What remains here is the part wrangler is genuinely better
 * at: the interactive OAuth login, and refreshing the token it stores.
 *
 * Resolves the wrangler binary once and caches the path to avoid repeated
 * npx resolution overhead (~10s per call).
 */

import { execSync, exec } from "child_process";

// ─── Wrangler binary resolution ───

let _wranglerCmd: string | null = null;

/**
 * Resolve the wrangler binary path once, then cache it.
 * Tries `which wrangler` first (instant if globally installed),
 * falls back to the npx-resolved path.
 */
function getWranglerCmd(): string {
  if (_wranglerCmd) return _wranglerCmd;

  // Try global / npm-linked wrangler first
  try {
    const path = execSync("which wrangler 2>/dev/null", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (path) {
      _wranglerCmd = path;
      return _wranglerCmd;
    }
  } catch {
    // not found globally
  }

  // Try local node_modules/.bin
  try {
    const path = execSync("npx -y which wrangler 2>/dev/null", {
      encoding: "utf-8",
      timeout: 15000,
    }).trim();
    if (path) {
      _wranglerCmd = path;
      return _wranglerCmd;
    }
  } catch {
    // not found via npx which
  }

  // Fallback: use npx -y wrangler (slower but always works)
  _wranglerCmd = "npx -y wrangler";
  return _wranglerCmd;
}

/** @internal For testing only. */
export function _setWranglerCmd(cmd: string | null): void {
  _wranglerCmd = cmd;
}

/** Build a shell command string using the resolved wrangler binary. */
function wranglerExec(args: string): string {
  return `${getWranglerCmd()} ${args}`;
}

// ─── Auth ───

const LOGIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _loginCache: {
  result: { loggedIn: boolean; account?: string };
  timestamp: number;
} | null = null;

/** @internal For testing only. */
export function _setLoginCache(
  cache: { result: { loggedIn: boolean; account?: string }; timestamp: number } | null
): void {
  _loginCache = cache;
}

/** Clear the login cache (called before wranglerLogin to force re-check). */
export function invalidateLoginCache(): void {
  _loginCache = null;
}

/**
 * Check if wrangler is logged in to Cloudflare.
 * Results are cached for 5 minutes to avoid blocking page loads.
 */
export function checkWranglerLogin(): {
  loggedIn: boolean;
  account?: string;
} {
  if (_loginCache && Date.now() - _loginCache.timestamp < LOGIN_CACHE_TTL_MS) {
    return _loginCache.result;
  }

  try {
    const output = execSync(wranglerExec("whoami 2>&1"), {
      encoding: "utf-8",
      timeout: 15000,
    });

    if (
      output.includes("You are logged in") ||
      output.includes("associated with")
    ) {
      // Try to extract email
      const emailMatch = output.match(
        /associated with the email ([^\s!]+)/
      );
      const account = emailMatch ? emailMatch[1] : undefined;
      const result = { loggedIn: true, account };
      _loginCache = { result, timestamp: Date.now() };
      return result;
    }

    const result = { loggedIn: false };
    _loginCache = { result, timestamp: Date.now() };
    return result;
  } catch {
    const result = { loggedIn: false };
    _loginCache = { result, timestamp: Date.now() };
    return result;
  }
}

/**
 * Nudge wrangler into refreshing its stored OAuth token.
 *
 * Wrangler's access tokens last an hour, and it silently exchanges the stored
 * refresh token on any command. Running the cheapest one keeps the local
 * "just run `wrangler login`" experience without routing actual deploys
 * through the CLI. Returns false if wrangler is unavailable or logged out.
 */
export function refreshWranglerAuth(): boolean {
  invalidateLoginCache();
  try {
    execSync(wranglerExec("whoami"), {
      encoding: "utf-8",
      timeout: 60000,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run wrangler login (opens browser for OAuth).
 */
export async function wranglerLogin(): Promise<{
  success: boolean;
  error?: string;
}> {
  invalidateLoginCache();
  return new Promise((resolve) => {
    const child = exec(wranglerExec("login"), {
      timeout: 120000,
    });

    let output = "";
    child.stdout?.on("data", (data: string) => (output += data));
    child.stderr?.on("data", (data: string) => (output += data));

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: "Cloudflare login failed. Please try again.",
        });
      }
    });

    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

// ─── Worker Deployment ───

// ─── Secrets ───

// ─── KV Namespace Management ───

// ─── Health Check ───

// ─── Worker Management ───
