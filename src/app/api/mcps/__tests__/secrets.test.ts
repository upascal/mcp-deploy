import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mcp-registry", () => ({
  getStoredMcp: vi.fn(),
  resolveMcpEntry: vi.fn(),
}));

vi.mock("@/lib/cloudflare-config", () => ({
  isCfConfigured: vi.fn(),
}));

vi.mock("@/lib/wrangler", () => ({
  setSecrets: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getMcpSecrets: vi.fn(),
  setMcpSecrets: vi.fn(),
}));

import { GET as getSecretsHandler, PUT as putSecretsHandler } from "../../mcps/[slug]/secrets/route";
import { getStoredMcp, resolveMcpEntry } from "@/lib/mcp-registry";
import { isCfConfigured } from "@/lib/cloudflare-config";
import { setSecrets, deleteSecret } from "@/lib/wrangler";
import { getMcpSecrets, setMcpSecrets } from "@/lib/store";

const mockEntry = {
  slug: "test-mcp",
  githubRepo: "owner/test-mcp-remote",
  releaseTag: "latest",
  addedAt: "2024-01-01",
};

const mockResolved = {
  slug: "test-mcp",
  workerName: "test-mcp-worker",
  secrets: [
    { key: "API_KEY", label: "API Key", required: true },
    { key: "OPTIONAL", label: "Optional", required: false },
  ],
};

describe("GET /api/mcps/[slug]/secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
    vi.mocked(resolveMcpEntry).mockResolvedValue(mockResolved as any);
  });

  it("should return secret schema and configured keys", async () => {
    vi.mocked(getMcpSecrets).mockResolvedValue({ API_KEY: "encrypted-value" });

    const req = new Request("http://localhost:3000/api/mcps/test-mcp/secrets");
    const res = await getSecretsHandler(req, {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.slug).toBe("test-mcp");
    expect(body.schema).toHaveLength(2);
    expect(body.configuredKeys).toEqual(["API_KEY"]);
  });

  it("should return empty configuredKeys when no secrets set", async () => {
    vi.mocked(getMcpSecrets).mockResolvedValue(null);

    const req = new Request("http://localhost:3000/api/mcps/test-mcp/secrets");
    const res = await getSecretsHandler(req, {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(body.configuredKeys).toEqual([]);
  });

  it("should return 404 for unknown MCP", async () => {
    vi.mocked(getStoredMcp).mockResolvedValue(undefined);

    const req = new Request("http://localhost:3000/api/mcps/unknown/secrets");
    const res = await getSecretsHandler(req, {
      params: Promise.resolve({ slug: "unknown" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/mcps/[slug]/secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
    vi.mocked(resolveMcpEntry).mockResolvedValue(mockResolved as any);
    vi.mocked(isCfConfigured).mockResolvedValue(true);
    vi.mocked(getMcpSecrets).mockResolvedValue({ EXISTING: "old-value" });
  });

  it("should update secrets on the worker", async () => {
    const req = new Request("http://localhost:3000/api/mcps/test-mcp/secrets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secrets: { API_KEY: "new-key" } }),
    });
    const res = await putSecretsHandler(req, {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.updatedKeys).toEqual(["API_KEY"]);
    expect(setSecrets).toHaveBeenCalledWith("test-mcp-worker", { API_KEY: "new-key" });
  });

  it("should delete secrets from the worker", async () => {
    const req = new Request("http://localhost:3000/api/mcps/test-mcp/secrets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteKeys: ["EXISTING"] }),
    });
    const res = await putSecretsHandler(req, {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deletedKeys).toEqual(["EXISTING"]);
    expect(deleteSecret).toHaveBeenCalledWith("test-mcp-worker", "EXISTING");
  });

  it("should merge updated secrets and remove deleted ones from store", async () => {
    const req = new Request("http://localhost:3000/api/mcps/test-mcp/secrets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secrets: { NEW_KEY: "new-value" },
        deleteKeys: ["EXISTING"],
      }),
    });
    await putSecretsHandler(req, {
      params: Promise.resolve({ slug: "test-mcp" }),
    });

    expect(setMcpSecrets).toHaveBeenCalledWith("test-mcp", { NEW_KEY: "new-value" });
  });

  it("should return 400 when no secrets or deleteKeys provided", async () => {
    const req = new Request("http://localhost:3000/api/mcps/test-mcp/secrets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await putSecretsHandler(req, {
      params: Promise.resolve({ slug: "test-mcp" }),
    });

    expect(res.status).toBe(400);
  });

  it("should return 400 when not logged in", async () => {
    vi.mocked(isCfConfigured).mockResolvedValue(false);

    const req = new Request("http://localhost:3000/api/mcps/test-mcp/secrets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secrets: { API_KEY: "key" } }),
    });
    const res = await putSecretsHandler(req, {
      params: Promise.resolve({ slug: "test-mcp" }),
    });

    expect(res.status).toBe(400);
  });
});
