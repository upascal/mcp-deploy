import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mcp-registry", () => ({
  getStoredMcp: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getDeployment: vi.fn(),
}));

vi.mock("@/lib/wrangler", () => ({
  checkHealth: vi.fn(),
}));

vi.mock("@/lib/validation", () => ({
  isValidSlug: vi.fn((slug: string) => /^[a-z0-9-]+$/.test(slug)),
}));

import { GET as statusHandler } from "../[slug]/status/route";
import { getStoredMcp } from "@/lib/mcp-registry";
import { getDeployment } from "@/lib/store";
import { checkHealth } from "@/lib/wrangler";

const mockEntry = {
  slug: "test-mcp",
  githubRepo: "owner/test-mcp-remote",
  releaseTag: "latest",
  addedAt: "2024-01-01",
};

function makeRequest() {
  return new Request("http://localhost:3000/api/mcps/test-mcp/status", {
    method: "GET",
  });
}

describe("GET /api/mcps/[slug]/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return not_deployed status for undeployed MCP", async () => {
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
    vi.mocked(getDeployment).mockReturnValue(null);

    const res = await statusHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.slug).toBe("test-mcp");
    expect(body.status).toBe("not_deployed");
    expect(body.healthy).toBe(false);
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it("should return deployed status with health check", async () => {
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
    vi.mocked(getDeployment).mockReturnValue({
      slug: "test-mcp",
      status: "deployed",
      workerUrl: "https://test-mcp-worker.user.workers.dev",
      bearerToken: null,
      oauthPassword: null,
      authMode: "bearer",
      deployedAt: "2024-01-01T00:00:00.000Z",
      version: "v0.1.0",
    });
    vi.mocked(checkHealth).mockResolvedValue({
      healthy: true,
      status: 200,
    });

    const res = await statusHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.slug).toBe("test-mcp");
    // Note: ...health spread overwrites status with health.status (200)
    expect(body.status).toBe(200);
    expect(body.workerUrl).toBe("https://test-mcp-worker.user.workers.dev");
    expect(body.deployedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(body.healthy).toBe(true);
    expect(checkHealth).toHaveBeenCalledWith("https://test-mcp-worker.user.workers.dev");
  });

  it("should return unhealthy status when health check fails", async () => {
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
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
    vi.mocked(checkHealth).mockResolvedValue({
      healthy: false,
      status: 500,
      error: "Worker unavailable",
    });

    const res = await statusHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.healthy).toBe(false);
    // Note: ...health spread overwrites status with health.status (500)
    expect(body.status).toBe(500);
    expect(body.error).toBe("Worker unavailable");
  });

  it("should return 404 for non-existent MCP", async () => {
    vi.mocked(getStoredMcp).mockResolvedValue(undefined);

    const res = await statusHandler(makeRequest(), {
      params: Promise.resolve({ slug: "unknown-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("MCP not found");
  });

  it("should return 400 for invalid slug format", async () => {
    const res = await statusHandler(makeRequest(), {
      params: Promise.resolve({ slug: "Invalid_Slug!" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid slug format");
    expect(getStoredMcp).not.toHaveBeenCalled();
  });

  it("should return 400 for empty slug", async () => {
    const res = await statusHandler(makeRequest(), {
      params: Promise.resolve({ slug: "" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid slug format");
  });

  it("should return not_deployed when deployment exists but has no workerUrl", async () => {
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
    vi.mocked(getDeployment).mockReturnValue({
      slug: "test-mcp",
      status: "failed",
      workerUrl: null,
      bearerToken: null,
      oauthPassword: null,
      authMode: "bearer",
      deployedAt: "2024-01-01",
      version: null,
    });

    const res = await statusHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("not_deployed");
    expect(body.healthy).toBe(false);
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it("should return 500 on health check error", async () => {
    vi.mocked(getStoredMcp).mockResolvedValue(mockEntry);
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
    vi.mocked(checkHealth).mockRejectedValue(new Error("Network timeout"));

    const res = await statusHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Network timeout");
  });

  it("should return 500 on unexpected error", async () => {
    vi.mocked(getStoredMcp).mockImplementation(() => {
      throw new Error("Database connection failed");
    });

    const res = await statusHandler(makeRequest(), {
      params: Promise.resolve({ slug: "test-mcp" }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Database connection failed");
  });
});
