import { describe, it, expect, vi, beforeEach } from "vitest";
import * as child_process from "child_process";

vi.mock("child_process");

import {
  checkWranglerLogin,
  refreshWranglerAuth,
  _setLoginCache,
} from "../wrangler";

describe("checkWranglerLogin", () => {
  beforeEach(() => {
    _setLoginCache(null);
    vi.clearAllMocks();
  });

  it("should detect logged in state", () => {
    vi.spyOn(child_process, "execSync").mockReturnValue(
      "You are logged in with an OAuth Token, associated with the email test@example.com" as never
    );
    const result = checkWranglerLogin();
    expect(result.loggedIn).toBe(true);
    expect(result.account).toBe("test@example.com");
  });

  it("should detect logged out state", () => {
    vi.spyOn(child_process, "execSync").mockImplementation(() => {
      throw new Error("Not logged in");
    });
    expect(checkWranglerLogin().loggedIn).toBe(false);
  });

  it("should handle different login message formats", () => {
    vi.spyOn(child_process, "execSync").mockReturnValue(
      "You are logged in" as never
    );
    expect(checkWranglerLogin().loggedIn).toBe(true);
  });
});

describe("refreshWranglerAuth", () => {
  beforeEach(() => {
    _setLoginCache(null);
    vi.clearAllMocks();
  });

  it("reports success when wrangler runs", () => {
    const spy = vi
      .spyOn(child_process, "execSync")
      .mockReturnValue("" as never);

    expect(refreshWranglerAuth()).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("reports failure when wrangler is missing or logged out", () => {
    vi.spyOn(child_process, "execSync").mockImplementation(() => {
      throw new Error("command not found: wrangler");
    });

    expect(refreshWranglerAuth()).toBe(false);
  });

  it("clears the login cache so the next check re-runs", () => {
    // Without this a stale 5-minute cache could mask a refreshed token.
    _setLoginCache({ result: { loggedIn: false }, timestamp: Date.now() });
    vi.spyOn(child_process, "execSync").mockReturnValue(
      "You are logged in with an OAuth Token, associated with the email a@b.c" as never
    );

    refreshWranglerAuth();

    expect(checkWranglerLogin().loggedIn).toBe(true);
  });
});
