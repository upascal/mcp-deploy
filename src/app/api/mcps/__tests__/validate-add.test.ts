import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing routes
vi.mock("@/lib/github-releases", () => ({
  fetchMcpMetadata: vi.fn(),
  parseGitHubRepo: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getMcps: vi.fn(),
  addMcp: vi.fn(),
}));

import { GET as validateHandler } from "../../mcps/validate/route";
import { POST as addHandler } from "../../mcps/add/route";
import { fetchMcpMetadata, parseGitHubRepo } from "@/lib/github-releases";
import { getMcps, addMcp } from "@/lib/store";
import { NextRequest } from "next/server";

const mockMetadata = {
  metadata: {
    name: "Test MCP",
    description: "A test MCP",
    version: "0.1.0",
    worker: {
      name: "test-mcp-worker",
      durableObjectBinding: "MCP_OBJ",
      durableObjectClassName: "TestMCP",
      compatibilityDate: "2024-12-01",
      compatibilityFlags: ["nodejs_compat"],
      migrationTag: "v1",
    },
    secrets: [],
    config: [],
    autoSecrets: [],
  },
  bundleUrl: "https://github.com/owner/repo/releases/download/v0.1.0/worker.mjs",
  version: "v0.1.0",
};

describe("GET /api/mcps/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should validate a valid repo", async () => {
    vi.mocked(parseGitHubRepo).mockReturnValue("owner/test-mcp-remote");
    vi.mocked(fetchMcpMetadata).mockResolvedValue(mockMetadata);

    const req = new NextRequest("http://localhost:3000/api/mcps/validate?repo=owner/test-mcp-remote");
    const res = await validateHandler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.name).toBe("Test MCP");
    expect(body.slug).toBe("test-mcp-worker");
    expect(body.version).toBe("v0.1.0");
  });

  it("should return 400 for missing repo param", async () => {
    const req = new NextRequest("http://localhost:3000/api/mcps/validate");
    const res = await validateHandler(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.valid).toBe(false);
    expect(body.error).toContain("Missing repo");
  });

  it("should return 400 for invalid repo format", async () => {
    vi.mocked(parseGitHubRepo).mockReturnValue(null);

    const req = new NextRequest("http://localhost:3000/api/mcps/validate?repo=invalid");
    const res = await validateHandler(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.valid).toBe(false);
  });

  it("should handle missing releases gracefully", async () => {
    vi.mocked(parseGitHubRepo).mockReturnValue("owner/repo");
    vi.mocked(fetchMcpMetadata).mockRejectedValue(new Error("Repository has no releases"));

    const req = new NextRequest("http://localhost:3000/api/mcps/validate?repo=owner/repo");
    const res = await validateHandler(req);
    const body = await res.json();

    expect(body.valid).toBe(false);
    expect(body.error).toContain("no releases");
  });
});

describe("POST /api/mcps/add", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMcps).mockResolvedValue([]);
  });

  it("should add a new MCP", async () => {
    vi.mocked(parseGitHubRepo).mockReturnValue("owner/test-mcp-remote");
    vi.mocked(fetchMcpMetadata).mockResolvedValue(mockMetadata);

    const req = new NextRequest("http://localhost:3000/api/mcps/add", {
      method: "POST",
      body: JSON.stringify({ githubRepo: "owner/test-mcp-remote" }),
    });
    const res = await addHandler(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.slug).toBe("test-mcp-worker");
    expect(body.name).toBe("Test MCP");
    expect(addMcp).toHaveBeenCalledOnce();
  });

  it("should return 400 for missing githubRepo", async () => {
    const req = new NextRequest("http://localhost:3000/api/mcps/add", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await addHandler(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Missing githubRepo");
  });

  it("should return 409 for duplicate repo", async () => {
    vi.mocked(parseGitHubRepo).mockReturnValue("owner/test-mcp-remote");
    vi.mocked(getMcps).mockResolvedValue([
      {
        slug: "existing",
        githubRepo: "owner/test-mcp-remote",
        releaseTag: "latest",
        addedAt: "2024-01-01",
      },
    ]);

    const req = new NextRequest("http://localhost:3000/api/mcps/add", {
      method: "POST",
      body: JSON.stringify({ githubRepo: "owner/test-mcp-remote" }),
    });
    const res = await addHandler(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("already added");
  });

  it("should return 409 for duplicate prevalidated slug", async () => {
    vi.mocked(parseGitHubRepo).mockReturnValue("owner/new-repo");
    vi.mocked(getMcps).mockResolvedValue([
      {
        slug: "test-mcp-worker",
        githubRepo: "owner/other-repo",
        releaseTag: "latest",
        addedAt: "2024-01-01",
      },
    ]);

    const req = new NextRequest("http://localhost:3000/api/mcps/add", {
      method: "POST",
      body: JSON.stringify({
        githubRepo: "owner/new-repo",
        slug: "test-mcp-worker",
      }),
    });
    const res = await addHandler(req);
    const body = await res.json();

    expect(res.status).toBe(409);
  });

  it("should pass releaseTag to fetchMcpMetadata", async () => {
    vi.mocked(parseGitHubRepo).mockReturnValue("owner/test-mcp-remote");
    vi.mocked(fetchMcpMetadata).mockResolvedValue(mockMetadata);

    const req = new NextRequest("http://localhost:3000/api/mcps/add", {
      method: "POST",
      body: JSON.stringify({
        githubRepo: "owner/test-mcp-remote",
        releaseTag: "v0.2.0",
      }),
    });
    await addHandler(req);

    expect(fetchMcpMetadata).toHaveBeenCalledWith("owner/test-mcp-remote", "v0.2.0");
  });
});
