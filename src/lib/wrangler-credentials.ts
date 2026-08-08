/**
 * Reads the OAuth token that `wrangler login` stores on disk.
 *
 * This is what lets the REST deploy path keep wrangler's login UX: users still
 * run `wrangler login`, and we reuse the resulting token as a bearer token
 * instead of shelling out to the wrangler CLI for every operation.
 *
 * The granted scopes include account:read, workers_scripts:write and
 * workers_kv:write, which covers everything CloudflareDeployService needs.
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface WranglerToken {
  token: string;
  /** True when expiration_time is in the past. */
  expired: boolean;
}

/**
 * Candidate locations for wrangler's config, most likely first.
 * Wrangler resolves this via xdg-app-paths, which differs per platform.
 */
function configPaths(): string[] {
  const home = homedir();
  const paths: string[] = [];

  if (process.env.WRANGLER_HOME) {
    paths.push(join(process.env.WRANGLER_HOME, "config", "default.toml"));
  }

  if (process.platform === "darwin") {
    paths.push(
      join(home, "Library", "Preferences", ".wrangler", "config", "default.toml")
    );
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      paths.push(join(appData, ".wrangler", "config", "default.toml"));
    }
  }

  const xdg = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
  paths.push(join(xdg, ".wrangler", "config", "default.toml"));

  // Legacy location used by older wrangler versions.
  paths.push(join(home, ".wrangler", "config", "default.toml"));

  return paths;
}

/**
 * Read wrangler's stored OAuth token, or null if the user has never run
 * `wrangler login` on this machine.
 *
 * The file is small and its shape is stable, so it is parsed with a regex
 * rather than pulling in a TOML dependency.
 */
export function readWranglerToken(): WranglerToken | null {
  for (const path of configPaths()) {
    if (!existsSync(path)) continue;

    let contents: string;
    try {
      contents = readFileSync(path, "utf-8");
    } catch {
      continue;
    }

    const token = contents.match(/^\s*oauth_token\s*=\s*"([^"]+)"/m)?.[1];
    if (!token) continue;

    const expiry = contents.match(
      /^\s*expiration_time\s*=\s*"([^"]+)"/m
    )?.[1];
    const expiresAt = expiry ? Date.parse(expiry) : NaN;

    return {
      token,
      expired: Number.isFinite(expiresAt) && expiresAt <= Date.now(),
    };
  }

  return null;
}
