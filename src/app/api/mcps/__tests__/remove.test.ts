import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/store", () => ({
  getDeployment: vi.fn(),
  removeMcp: vi.fn(),
}));

vi.mock("@/lib/wrangler", () => ({
  deleteWorker: vi.fn(),
}));

vi.mock("@/lib/mcp-registry", () => ({
  getStoredMcp: vi.fn(),
  resolveMcpEntry: vi.fn(),
}));

vi.mock("@/lib/validation", () => ({
  isValidSlug: vi.fn((slug: string) => /^[a-z0-9-]+$/.test(slug)),
}));

import { DELETE as removeHandler } from "../[slug]/remove/route";
import { getDeployment, removeMcp } from "@/lib/store";
import { deleteWorker } from "@/lib/wrangler";
import { getStoredMcp, resolveMcpEntry } from "@/lib/mcp-registry";
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

function makeRequest() {
  return new Request("http://localhost:3000/api/mcps/test-mcp/remove", {
    method: "DELETE",
  });
}

describe("DELETE /api/mcps/[slug]/remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should remove MCP successfully without deployment", async () => {
    vi.mocked(getDeployment).mockReturnValue(null);

    const res = await removeHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(removeMcp).toHaveBeenCalledWith("test-mcp");
    expect(deleteWorker).not.toHaveBeenCalled();
  });

  it("should remove MCP and delete worker if deployed", async () => {
    vi.mocked(getDeployment).mockReturnValue({
      slug: "test-mcp",
      status: "deployed",
      workerUrl: "https://test-mcp-worker.user.workers.dev",
      bearerToken: null,
      oauthPassword: null,
      authMode: "bearer",
      deployedAt: "2024-01-01",
      version: "v0.1.0",
    });
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
    vi.mocked(resolveMcpEntry).mockResolvedValue(mockResolved);
    vi.mocked(deleteWorker).mockResolvedValue();

    const res = await removeHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deleteWorker).toHaveBeenCalledWith("test-mcp-worker");
    expect(removeMcp).toHaveBeenCalledWith("test-mcp");
  });

  it("should continue removal if worker deletion fails", async () => {
    vi.mocked(getDeployment).mockReturnValue({
      slug: "test-mcp",
      status: "deployed",
      workerUrl: "https://test-mcp-worker.user.workers.dev",
      bearerToken: null,
      oauthPassword: null,
      authMode: "bearer",
      deployedAt: "2024-01-01",
      version: "v0.1.0",
    });
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
    vi.mocked(resolveMcpEntry).mockResolvedValue(mockResolved);
    vi.mocked(deleteWorker).mockRejectedValue(new Error("Worker not found"));

    const res = await removeHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(removeMcp).toHaveBeenCalledWith("test-mcp");
  });

  it("should return 400 for invalid slug format", async () => {
    const res = await removeHandler(makeRequest(), {
      params: Promise.resolve({ slug: "Invalid_Slug!" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid slug format");
    expect(removeMcp).not.toHaveBeenCalled();
  });

  it("should return 400 for empty slug", async () => {
    const res = await removeHandler(makeRequest(), {
      params: Promise.resolve({ slug: "" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid slug format");
  });

  it("should handle missing entry gracefully", async () => {
    vi.mocked(getDeployment).mockReturnValue({
      slug: "test-mcp",
      status: "deployed",
      workerUrl: "https://test-mcp-worker.user.workers.dev",
      bearerToken: null,
      oauthPassword: null,
      authMode: "bearer",
      deployedAt: "2024-01-01",
      version: "v0.1.0",
    });
    vi.mocked(getStoredMcp).mockResolvedValue(undefined);

    const res = await removeHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deleteWorker).not.toHaveBeenCalled();
    expect(removeMcp).toHaveBeenCalledWith("test-mcp");
  });

  it("should handle resolution errors gracefully", async () => {
    vi.mocked(getDeployment).mockReturnValue({
      slug: "test-mcp",
      status: "deployed",
      workerUrl: "https://test-mcp-worker.user.workers.dev",
      bearerToken: null,
      oauthPassword: null,
      authMode: "bearer",
      deployedAt: "2024-01-01",
      version: "v0.1.0",
    });
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
    vi.mocked(resolveMcpEntry).mockRejectedValue(new Error("Resolution failed"));

    const res = await removeHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(removeMcp).toHaveBeenCalledWith("test-mcp");
  });

  it("should return 500 on unexpected errors", async () => {
    vi.mocked(getDeployment).mockImplementation(() => {
      throw new Error("Database error");
    });

    const res = await removeHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to remove MCP");
  });
});
