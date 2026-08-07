import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();
const mockCreate = vi.fn();

vi.mock("cloudflare", () => ({
  default: class {
    kv = { namespaces: { list: mockList, create: mockCreate } };
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
