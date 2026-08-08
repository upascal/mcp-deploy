import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { readWranglerToken } from "../wrangler-credentials";

/**
 * readWranglerToken() searches WRANGLER_HOME first, so pointing that at a
 * temp dir exercises the real file-reading path without touching the
 * developer's actual wrangler login.
 */
let dir: string;

function writeConfig(contents: string) {
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "config", "default.toml"), contents);
}

function isoIn(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

describe("readWranglerToken", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wrangler-creds-"));
    vi.stubEnv("WRANGLER_HOME", dir);
    // The reader deliberately falls through to platform and legacy locations,
    // so HOME and XDG_CONFIG_HOME are redirected too — otherwise a developer's
    // real `wrangler login` would satisfy the "no config" cases.
    vi.stubEnv("HOME", dir);
    vi.stubEnv("XDG_CONFIG_HOME", join(dir, "xdg"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when no config exists", () => {
    expect(readWranglerToken()).toBeNull();
  });

  it("reads a valid token and reports it as live", () => {
    writeConfig(
      `oauth_token = "abc123"\nexpiration_time = "${isoIn(30)}"\n` +
        `refresh_token = "refresh"\nscopes = [ "account:read" ]\n`
    );

    expect(readWranglerToken()).toEqual({ token: "abc123", expired: false });
  });

  it("flags a token whose expiry has passed", () => {
    writeConfig(
      `oauth_token = "stale"\nexpiration_time = "${isoIn(-1)}"\n`
    );

    // Wrangler access tokens live one hour; callers refresh when this is true.
    expect(readWranglerToken()).toEqual({ token: "stale", expired: true });
  });

  it("treats a missing expiry as live rather than expired", () => {
    writeConfig(`oauth_token = "no-expiry"\n`);

    expect(readWranglerToken()).toEqual({ token: "no-expiry", expired: false });
  });

  it("returns null when the config has no oauth_token", () => {
    writeConfig(`scopes = [ "account:read" ]\n`);

    expect(readWranglerToken()).toBeNull();
  });
});
