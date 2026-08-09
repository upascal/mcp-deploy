import { describe, it, expect, afterEach } from "vitest";
import { getStore, setStore, getDeployment, getMcps } from "../store";
import { SqliteStore } from "../sqlite-store";
import type { Store } from "../store-types";

/**
 * Verifies the injection seam the hosted app relies on: setStore() swaps the
 * backend, and the free-function facade delegates to whatever is active.
 */

const original = getStore();

afterEach(() => {
  setStore(original);
});

/** A trivial in-memory Store double — no better-sqlite3, no filesystem. */
function fakeStore(): Store & { calls: string[] } {
  const calls: string[] = [];
  const rec = (name: string) => calls.push(name);
  return {
    calls,
    async getDeployment() {
      rec("getDeployment");
      return null;
    },
    async setDeployment() {
      rec("setDeployment");
    },
    async getMcpSecrets() {
      return null;
    },
    async setMcpSecrets() {},
    async getMcpBearerToken() {
      return null;
    },
    async getMcps() {
      rec("getMcps");
      return [{ slug: "injected", githubRepo: "x/y", releaseTag: "latest", addedAt: "" }];
    },
    async setMcps() {},
    async addMcp() {},
    async undeployMcp() {},
    async removeMcp() {},
    async hasSeededDefaults() {
      return true;
    },
    async markSeededDefaults() {},
    async resetSeededDefaults() {},
    async getCfToken() {
      return null;
    },
    async setCfToken() {},
    async getCfAccountId() {
      return null;
    },
    async setCfAccountId() {},
    async isCfConfigured() {
      return false;
    },
    async getCachedMetadata() {
      return null;
    },
    async getCachedMetadataForDisplay() {
      return null;
    },
    async setCachedMetadata() {},
    async deleteCachedMetadata() {},
    async getLatestVersionCache() {
      return null;
    },
    async setLatestVersionCache() {},
  };
}

describe("store seam", () => {
  it("defaults to the SqliteStore backend", () => {
    expect(getStore()).toBeInstanceOf(SqliteStore);
  });

  it("routes the free-function facade through the injected store", async () => {
    const fake = fakeStore();
    setStore(fake);

    const mcps = await getMcps();

    expect(mcps).toEqual([
      { slug: "injected", githubRepo: "x/y", releaseTag: "latest", addedAt: "" },
    ]);
    expect(fake.calls).toContain("getMcps");
  });

  it("a swapped backend needs no better-sqlite3 — the point of the seam", async () => {
    const fake = fakeStore();
    setStore(fake);

    // This call would touch the filesystem/native addon under SqliteStore;
    // under the fake it must not.
    expect(await getDeployment("anything")).toBeNull();
    expect(fake.calls).toContain("getDeployment");
  });
});
