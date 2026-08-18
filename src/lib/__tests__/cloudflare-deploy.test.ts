import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();
const mockCreate = vi.fn();

const mockScriptsGet = vi.fn();

vi.mock("cloudflare", () => ({
  default: class {
    kv = { namespaces: { list: mockList, create: mockCreate } };
    workers = { scripts: { get: mockScriptsGet, delete: vi.fn() } };
    _options = { apiToken: "test-token" };
  },
}));

import { CloudflareDeployService } from "../cloudflare-deploy";

/** The SDK returns an async-iterable page object; emulate that. */
function page(namespaces: { id: string; title: string }[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const ns of namespaces) yield ns;
    },
  };
}

describe("CloudflareDeployService.ensureKVNamespace", () => {
  let service: CloudflareDeployService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CloudflareDeployService("token", "acct-123");
  });

  it("returns the existing namespace ID without creating", async () => {
    mockList.mockReturnValue(
      page([
        { id: "other-id", title: "something-else" },
        { id: "619f3627", title: "mcp-deploy-oauth" },
      ])
    );

    const id = await service.ensureKVNamespace("mcp-deploy-oauth");

    expect(id).toBe("619f3627");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockList).toHaveBeenCalledWith({ account_id: "acct-123" });
  });

  it("creates the namespace when none matches", async () => {
    mockList.mockReturnValue(page([{ id: "other-id", title: "unrelated" }]));
    mockCreate.mockResolvedValue({ id: "new-id", title: "mcp-deploy-oauth" });

    const id = await service.ensureKVNamespace("mcp-deploy-oauth");

    expect(id).toBe("new-id");
    expect(mockCreate).toHaveBeenCalledWith({
      account_id: "acct-123",
      title: "mcp-deploy-oauth",
    });
  });

  it("creates the namespace when the account has none", async () => {
    mockList.mockReturnValue(page([]));
    mockCreate.mockResolvedValue({ id: "first-id", title: "mcp-deploy-oauth" });

    expect(await service.ensureKVNamespace("mcp-deploy-oauth")).toBe("first-id");
  });

  it("finds a namespace beyond the first page", async () => {
    // Cloudflare paginates namespace listings; a match on a later page must
    // still be found, or create() would fail with a duplicate-title 400.
    const many = Array.from({ length: 45 }, (_, i) => ({
      id: `id-${i}`,
      title: `filler-${i}`,
    }));
    many.push({ id: "deep-id", title: "mcp-deploy-oauth" });
    mockList.mockReturnValue(page(many));

    expect(await service.ensureKVNamespace("mcp-deploy-oauth")).toBe("deep-id");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("matches titles exactly rather than by prefix", async () => {
    mockList.mockReturnValue(
      page([{ id: "prefix-id", title: "mcp-deploy-oauth-staging" }])
    );
    mockCreate.mockResolvedValue({ id: "exact-id", title: "mcp-deploy-oauth" });

    expect(await service.ensureKVNamespace("mcp-deploy-oauth")).toBe("exact-id");
  });
});

describe("CloudflareDeployService.deployWorker migrations", () => {
  const entry = {
    slug: "paper-search-mcp",
    githubRepo: "o/r",
    name: "Paper Search",
    description: "d",
    version: "0.1.0",
    workerName: "paper-search-mcp-upascal",
    durableObjectBinding: "MCP_OBJECT",
    durableObjectClassName: "PaperSearchMCP",
    compatibilityDate: "2024-12-01",
    compatibilityFlags: ["nodejs_compat"],
    migrationTag: "v1",
    bundleUrl: "https://x/worker.mjs",
    secrets: [],
    config: [],
    autoSecrets: [],
  };

  it("declares the DO class in new_sqlite_classes only (API error 10021)", async () => {
    // New worker: the exists-probe must fail.
    mockScriptsGet.mockRejectedValue(new Error("not found"));

    const uploads: Array<{ url: string; metadata: unknown }> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (init?.method === "PUT") {
          const form = init.body as FormData;
          const blob = form.get("metadata") as Blob;
          uploads.push({ url, metadata: JSON.parse(await blob.text()) });
        }
        return new Response(
          JSON.stringify({ success: true, result: { subdomain: "acct" } }),
          { status: 200 }
        );
      });

    const service = new CloudflareDeployService("token", "acct-123");
    const { url } = await service.deployWorker(entry, "// bundle", "// wrapper");

    expect(url).toBe("https://paper-search-mcp-upascal.acct.workers.dev");
    expect(uploads).toHaveLength(1);
    const migrations = (uploads[0].metadata as {
      migrations: { new_tag: string; steps: Record<string, unknown>[] };
    }).migrations;
    expect(migrations.new_tag).toBe("v1");
    // The class may appear in exactly one migration list — both new_classes
    // and new_sqlite_classes together is rejected by Cloudflare (10021).
    expect(migrations.steps[0]).toEqual({
      new_sqlite_classes: ["PaperSearchMCP"],
    });

    fetchMock.mockRestore();
  });

  it("omits migrations entirely when the worker already exists", async () => {
    mockScriptsGet.mockResolvedValue({ id: "exists" });

    const uploads: Array<Record<string, unknown>> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") {
          const form = init.body as FormData;
          const blob = form.get("metadata") as Blob;
          uploads.push(JSON.parse(await blob.text()));
        }
        return new Response(
          JSON.stringify({ success: true, result: { subdomain: "acct" } }),
          { status: 200 }
        );
      });

    const service = new CloudflareDeployService("token", "acct-123");
    await service.deployWorker(entry, "// bundle", "// wrapper");

    expect(uploads[0]).not.toHaveProperty("migrations");
    fetchMock.mockRestore();
  });
});
