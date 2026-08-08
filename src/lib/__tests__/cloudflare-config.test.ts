import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  readWranglerToken: vi.fn(),
  refreshWranglerAuth: vi.fn(),
  accountsList: vi.fn(),
  getCfToken: vi.fn(),
  getCfAccountId: vi.fn(),
  setCfAccountId: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock("../wrangler-credentials", () => ({
  readWranglerToken: mocks.readWranglerToken,
}));

vi.mock("../wrangler", () => ({
  refreshWranglerAuth: mocks.refreshWranglerAuth,
}));

vi.mock("../store", () => ({
  getCfToken: mocks.getCfToken,
  getCfAccountId: mocks.getCfAccountId,
  setCfAccountId: mocks.setCfAccountId,
}));

vi.mock("../encryption", () => ({ decrypt: mocks.decrypt }));

vi.mock("cloudflare", () => ({
  default: class {
    accounts = { list: mocks.accountsList };
  },
}));

import { getCredentials, isCfConfigured } from "../cloudflare-config";

describe("getCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCfToken.mockReturnValue(null);
    mocks.getCfAccountId.mockReturnValue(null);
    mocks.readWranglerToken.mockReturnValue(null);
    mocks.accountsList.mockResolvedValue({ result: [{ id: "acct-1" }] });
    mocks.decrypt.mockImplementation((v: string) => v.replace("enc:", ""));
  });

  it("returns null when there is no token anywhere", async () => {
    expect(await getCredentials()).toBeNull();
    expect(await isCfConfigured()).toBe(false);
  });

  it("prefers CLOUDFLARE_API_TOKEN over every other source", async () => {
    // This is how the hosted app supplies the one account it owns.
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "env-token");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "env-acct");
    mocks.getCfToken.mockReturnValue("stored-token");
    mocks.readWranglerToken.mockReturnValue({ token: "wr", expired: false });

    expect(await getCredentials()).toEqual({
      apiToken: "env-token",
      accountId: "env-acct",
      source: "env",
    });
    expect(mocks.accountsList).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("resolves the account for an env token without reusing the cache", async () => {
    // The cached id may belong to a different token, so it must not be trusted.
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "env-token");
    mocks.getCfAccountId.mockReturnValue("someone-elses-acct");
    mocks.accountsList.mockResolvedValue({ result: [{ id: "real-acct" }] });

    expect((await getCredentials())?.accountId).toBe("real-acct");
    vi.unstubAllEnvs();
  });

  it("prefers a stored API token over wrangler", async () => {
    mocks.getCfToken.mockReturnValue("api-token");
    mocks.readWranglerToken.mockReturnValue({ token: "wr", expired: false });

    expect(await getCredentials()).toEqual({
      apiToken: "api-token",
      accountId: "acct-1",
      source: "stored",
    });
  });

  it("decrypts stored tokens that were written encrypted", async () => {
    // encrypt() emits exactly "iv:authTag:ciphertext"; anything else is a
    // plaintext token saved before encryption was added.
    mocks.getCfToken.mockReturnValue("aabb:ccdd:eeff");
    mocks.decrypt.mockReturnValue("secret-token");

    expect((await getCredentials())?.apiToken).toBe("secret-token");
    expect(mocks.decrypt).toHaveBeenCalledWith("aabb:ccdd:eeff");
  });

  it("passes through legacy plaintext tokens without decrypting", async () => {
    mocks.getCfToken.mockReturnValue("plain-token");

    expect((await getCredentials())?.apiToken).toBe("plain-token");
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("falls back to wrangler's token when nothing is stored", async () => {
    mocks.readWranglerToken.mockReturnValue({ token: "wr-token", expired: false });

    expect(await getCredentials()).toEqual({
      apiToken: "wr-token",
      accountId: "acct-1",
      source: "wrangler",
    });
    expect(mocks.refreshWranglerAuth).not.toHaveBeenCalled();
  });

  it("refreshes an expired wrangler token and re-reads it", async () => {
    // Wrangler access tokens last an hour; without this a local user would
    // have to re-run `wrangler login` every hour.
    mocks.readWranglerToken
      .mockReturnValueOnce({ token: "stale", expired: true })
      .mockReturnValueOnce({ token: "fresh", expired: false });
    mocks.refreshWranglerAuth.mockReturnValue(true);

    expect((await getCredentials())?.apiToken).toBe("fresh");
    expect(mocks.refreshWranglerAuth).toHaveBeenCalledOnce();
  });

  it("gives up when the refresh fails", async () => {
    mocks.readWranglerToken.mockReturnValue({ token: "stale", expired: true });
    mocks.refreshWranglerAuth.mockReturnValue(false);

    expect(await getCredentials()).toBeNull();
  });

  it("caches the resolved account id instead of re-querying", async () => {
    mocks.getCfAccountId.mockReturnValue("cached-acct");
    mocks.readWranglerToken.mockReturnValue({ token: "wr", expired: false });

    expect((await getCredentials())?.accountId).toBe("cached-acct");
    expect(mocks.accountsList).not.toHaveBeenCalled();
    expect(mocks.setCfAccountId).not.toHaveBeenCalled();
  });

  it("returns null when the token resolves no accounts", async () => {
    mocks.readWranglerToken.mockReturnValue({ token: "wr", expired: false });
    mocks.accountsList.mockResolvedValue({ result: [] });

    expect(await getCredentials()).toBeNull();
  });
});
