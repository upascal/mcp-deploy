import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mcp-registry", () => ({
  getStoredMcp: vi.fn(),
  resolveMcpEntry: vi.fn(),
  getBundleContent: vi.fn(),
}));

vi.mock("@/lib/cloudflare-config", () => ({
  isCfConfigured: vi.fn(),
}));

vi.mock("@/lib/wrangler", () => ({
  deployWorker: vi.fn(),
  setSecrets: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  setDeployment: vi.fn(),
  setMcpSecrets: vi.fn(),
  getMcpSecrets: vi.fn(),
}));

vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn((v: string) => `encrypted:${v}`),
}));

vi.mock("@/lib/worker-bearer-wrapper", () => ({
  generateBearerTokenWrapper: vi.fn(() => "// wrapper code"),
}));

import { POST as deployHandler } from "../../mcps/[slug]/deploy/route";
import { getStoredMcp, resolveMcpEntry, getBundleContent } from "@/lib/mcp-registry";
import { isCfConfigured } from "@/lib/cloudflare-config";
import { deployWorker, setSecrets } from "@/lib/wrangler";
import { setDeployment, setMcpSecrets, getMcpSecrets } from "@/lib/store";
import type { ResolvedMcpEntry } from "@/lib/types";

const mockEntry = {
  slug: "test-mcp",
  githubRepo: "owner/test-mcp-remote",
  releaseTag: "latest",
  addedAt: "2024-01-01",
};

const mockResolved: ResolvedMcpEntry = {
  slug: "test-mcp",
  githubRepo: "owner/test-mcp-remote",
  name: "Test MCP",
  description: "A test MCP",
  version: "v0.1.0",
  workerName: "test-mcp-worker",
  durableObjectBinding: "MCP_OBJ",
  durableObjectClassName: "TestMCP",
  compatibilityDate: "2024-12-01",
  compatibilityFlags: ["nodejs_compat"],
  migrationTag: "v1",
  bundleUrl: "https://example.com/worker.mjs",
  secrets: [],
  config: [],
  autoSecrets: [],
};

function makeRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost:3000/api/mcps/test-mcp/deploy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mcps/[slug]/deploy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
    vi.mocked(isCfConfigured).mockResolvedValue(true);
    vi.mocked(resolveMcpEntry).mockResolvedValue(mockResolved);
    vi.mocked(getBundleContent).mockResolvedValue("// bundle code");
    vi.mocked(deployWorker).mockResolvedValue({ url: "https://test-mcp-worker.user.workers.dev" });
    vi.mocked(getMcpSecrets).mockResolvedValue(null);
  });

  it("should deploy successfully", async () => {
    const res = await deployHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.workerUrl).toBe("https://test-mcp-worker.user.workers.dev");
    expect(body.bearerToken).toBeDefined();
    expect(body.mcpUrl).toContain("/mcp");
    expect(body.authMode).toBe("bearer");
  });

  it("should return 404 for unknown MCP", async () => {
    vi.mocked(getStoredMcp).mockResolvedValue(undefined);

    const res = await deployHandler(makeRequest(), {
      params: Promise.resolve({ slug: "unknown" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("not found");
  });

  it("should return 400 when not logged in to Cloudflare", async () => {
    vi.mocked(isCfConfigured).mockResolvedValue(false);

    const res = await deployHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Not logged in");
  });

  it("should pass user secrets to wrangler", async () => {
    const res = await deployHandler(
      makeRequest({ secrets: { API_KEY: "my-key" } }),
      { params: Promise.resolve({ slug: "test-mcp" }) }
    );

    expect(res.status).toBe(200);
    expect(setSecrets).toHaveBeenCalledWith(
      "test-mcp-worker",
      expect.objectContaining({ API_KEY: "my-key", BEARER_TOKEN: expect.any(String) })
    );
  });

  it("should merge with existing secrets on redeploy", async () => {
    vi.mocked(getMcpSecrets).mockResolvedValue({ OLD_KEY: "old-value" });

    const res = await deployHandler(
      makeRequest({ secrets: { NEW_KEY: "new-value" } }),
      { params: Promise.resolve({ slug: "test-mcp" }) }
    );

    expect(res.status).toBe(200);
    expect(setSecrets).toHaveBeenCalledWith(
      "test-mcp-worker",
      expect.objectContaining({
        OLD_KEY: "old-value",
        NEW_KEY: "new-value",
        BEARER_TOKEN: expect.any(String),
      })
    );
  });

  it("should store deployment record on success", async () => {
    await deployHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });

    expect(setDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "test-mcp",
        status: "deployed",
        workerUrl: "https://test-mcp-worker.user.workers.dev",
        version: "v0.1.0",
      })
    );
  });

  it("should store failed deployment on error", async () => {
    vi.mocked(deployWorker).mockRejectedValue(new Error("Deploy failed"));

    const res = await deployHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Deploy failed");
    expect(setDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "test-mcp",
        status: "failed",
        error: "Deploy failed",
      })
    );
  });
});
