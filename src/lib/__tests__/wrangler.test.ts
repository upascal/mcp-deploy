import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as child_process from "child_process";
import * as fs from "fs";

vi.mock("child_process");
vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof fs;
  return {
    ...actual,
    mkdtempSync: vi.fn(() => "/tmp/mcp-deploy-test123"),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import {
  checkWranglerLogin,
  deployWorker,
  setSecrets,
  deleteSecret,
  ensureKVNamespace,
  deleteWorker,
  checkHealth,
} from "../wrangler";
import type { ResolvedMcpEntry } from "../types";

const mockEntry: ResolvedMcpEntry = {
  slug: "test-mcp",
  githubRepo: "owner/test-mcp-remote",
  name: "Test MCP",
  description: "A test MCP server",
  version: "v0.1.0",
  workerName: "test-mcp-worker",
  durableObjectBinding: "MCP_OBJECT",
  durableObjectClassName: "MyMCP",
  compatibilityDate: "2024-12-01",
  compatibilityFlags: ["nodejs_compat"],
  migrationTag: "v1",
  bundleUrl: "https://github.com/owner/test-mcp-remote/releases/download/v0.1.0/worker.mjs",
  secrets: [],
  config: [],
  autoSecrets: [],
};

describe("checkWranglerLogin", () => {
  it("should detect logged in state", () => {
    vi.spyOn(child_process, "execSync").mockReturnValue(
      "You are logged in with an OAuth Token, associated with the email test@example.com" as any
    );
    const result = checkWranglerLogin();
    expect(result.loggedIn).toBe(true);
    expect(result.account).toBe("test@example.com");
  });

  it("should detect logged out state", () => {
    vi.spyOn(child_process, "execSync").mockImplementation(() => {
      throw new Error("Not logged in");
    });
    const result = checkWranglerLogin();
    expect(result.loggedIn).toBe(false);
  });

  it("should handle different login message formats", () => {
    vi.spyOn(child_process, "execSync").mockReturnValue(
      "You are logged in" as any
    );
    const result = checkWranglerLogin();
    expect(result.loggedIn).toBe(true);
  });
});

describe("deployWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should deploy a new worker with migrations", async () => {
    const execSyncSpy = vi
      .spyOn(child_process, "execSync")
      // First call: checkWorkerExists — throws (worker doesn't exist)
      .mockImplementationOnce(() => {
        throw new Error("Worker not found");
      })
      // Second call: wrangler deploy
      .mockReturnValueOnce(
        "Published test-mcp-worker (1.0s)\nhttps://test-mcp-worker.user.workers.dev" as any
      );

    const result = await deployWorker(mockEntry, "// bundle", "// wrapper");

    expect(result.url).toBe("https://test-mcp-worker.user.workers.dev");

    // Verify wrangler.jsonc was written with migrations
    const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const configCall = writeFileCalls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("wrangler.jsonc")
    );
    expect(configCall).toBeDefined();
    const config = JSON.parse(configCall![1] as string);
    expect(config.name).toBe("test-mcp-worker");
    expect(config.migrations).toBeDefined();
    expect(config.migrations[0].new_sqlite_classes).toEqual(["MyMCP"]);
  });

  it("should deploy an existing worker without migrations", async () => {
    vi.spyOn(child_process, "execSync")
      // checkWorkerExists — returns deployment list
      .mockReturnValueOnce(
        "Deployment ID: abc123\nCreated on: 2024-01-01" as any
      )
      // wrangler deploy
      .mockReturnValueOnce(
        "Published test-mcp-worker\nhttps://test-mcp-worker.user.workers.dev" as any
      );

    await deployWorker(mockEntry, "// bundle", "// wrapper");

    const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const configCall = writeFileCalls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("wrangler.jsonc")
    );
    const config = JSON.parse(configCall![1] as string);
    expect(config.migrations).toBeUndefined();
  });

  it("should throw if URL not found in deploy output", async () => {
    vi.spyOn(child_process, "execSync")
      .mockImplementationOnce(() => {
        throw new Error("Worker not found");
      })
      .mockReturnValueOnce("Deploy succeeded but no URL" as any);

    await expect(
      deployWorker(mockEntry, "// bundle", "// wrapper")
    ).rejects.toThrow("could not find Worker URL");
  });

  it("should clean up temp dir even on failure", async () => {
    vi.spyOn(child_process, "execSync")
      .mockImplementationOnce(() => {
        throw new Error("Worker not found");
      })
      .mockImplementationOnce(() => {
        throw new Error("Deploy failed");
      });

    await expect(
      deployWorker(mockEntry, "// bundle", "// wrapper")
    ).rejects.toThrow("wrangler deploy failed");

    expect(fs.rmSync).toHaveBeenCalledWith("/tmp/mcp-deploy-test123", {
      recursive: true,
      force: true,
    });
  });

  it("should include KV namespace binding when provided", async () => {
    vi.spyOn(child_process, "execSync")
      .mockImplementationOnce(() => {
        throw new Error("Worker not found");
      })
      .mockReturnValueOnce(
        "https://test-mcp-worker.user.workers.dev" as any
      );

    await deployWorker(mockEntry, "// bundle", "// wrapper", "kv-namespace-id-123");

    const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const configCall = writeFileCalls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("wrangler.jsonc")
    );
    const config = JSON.parse(configCall![1] as string);
    expect(config.kv_namespaces).toEqual([
      { binding: "OAUTH_KV", id: "kv-namespace-id-123" },
    ]);
  });

  it("should write bundle and wrapper as separate files", async () => {
    vi.spyOn(child_process, "execSync")
      .mockImplementationOnce(() => {
        throw new Error("Worker not found");
      })
      .mockReturnValueOnce(
        "https://test-mcp-worker.user.workers.dev" as any
      );

    await deployWorker(mockEntry, "// bundle code", "// wrapper code");

    const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const indexCall = writeFileCalls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("index.mjs")
    );
    const originalCall = writeFileCalls.find(
      (c) => typeof c[0] === "string" && c[0].endsWith("original.mjs")
    );
    expect(indexCall![1]).toBe("// wrapper code");
    expect(originalCall![1]).toBe("// bundle code");
  });
});

describe("setSecrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should write secrets to temp file and pass to wrangler secret bulk", async () => {
    const execSyncSpy = vi
      .spyOn(child_process, "execSync")
      .mockReturnValue("" as any);

    await setSecrets("my-worker", { API_KEY: "secret123", TOKEN: "tok456" });

    // Should write secrets JSON to a temp file
    const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const secretsFileCall = writeFileCalls.find(
      (c) => typeof c[0] === "string" && c[0].includes("secrets.json")
    );
    expect(secretsFileCall).toBeDefined();
    const writtenJson = JSON.parse(secretsFileCall![1] as string);
    expect(writtenJson.API_KEY).toBe("secret123");
    expect(writtenJson.TOKEN).toBe("tok456");

    // Should call wrangler with temp file path
    expect(execSyncSpy).toHaveBeenCalledTimes(1);
    const cmd = execSyncSpy.mock.calls[0][0] as string;
    expect(cmd).toContain("wrangler secret bulk");
    expect(cmd).toContain("--name my-worker");
    expect(cmd).not.toContain("echo");
  });

  it("should skip empty secret values", async () => {
    vi.spyOn(child_process, "execSync").mockReturnValue("" as any);

    await setSecrets("my-worker", { API_KEY: "secret", EMPTY: "" });

    const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const secretsFileCall = writeFileCalls.find(
      (c) => typeof c[0] === "string" && c[0].includes("secrets.json")
    );
    const writtenJson = JSON.parse(secretsFileCall![1] as string);
    expect(writtenJson.API_KEY).toBe("secret");
    expect(writtenJson.EMPTY).toBeUndefined();
  });

  it("should not call wrangler when all values are empty", async () => {
    const execSyncSpy = vi
      .spyOn(child_process, "execSync")
      .mockReturnValue("" as any);

    await setSecrets("my-worker", { EMPTY1: "", EMPTY2: "" });

    expect(execSyncSpy).not.toHaveBeenCalled();
  });

  it("should reject invalid worker names", async () => {
    await expect(
      setSecrets("my worker; rm -rf /", { KEY: "val" })
    ).rejects.toThrow("Invalid worker name");
  });
});

describe("deleteSecret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call wrangler secret delete with --force", async () => {
    const execSyncSpy = vi
      .spyOn(child_process, "execSync")
      .mockReturnValue("" as any);

    await deleteSecret("my-worker", "API_KEY");

    expect(execSyncSpy).toHaveBeenCalledTimes(1);
    const cmd = execSyncSpy.mock.calls[0][0] as string;
    expect(cmd).toContain("wrangler secret delete API_KEY");
    expect(cmd).toContain("--name my-worker");
    expect(cmd).toContain("--force");
  });

  it("should not throw when secret does not exist", async () => {
    vi.spyOn(child_process, "execSync").mockImplementation(() => {
      throw new Error("Secret not found");
    });

    await expect(deleteSecret("my-worker", "MISSING")).resolves.toBeUndefined();
  });

  it("should reject invalid worker names", async () => {
    await expect(
      deleteSecret("bad worker", "KEY")
    ).rejects.toThrow("Invalid worker name");
  });

  it("should reject invalid secret names", async () => {
    await expect(
      deleteSecret("my-worker", "BAD-KEY")
    ).rejects.toThrow("Invalid secret name");
  });
});

describe("ensureKVNamespace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return existing namespace ID if found", async () => {
    vi.spyOn(child_process, "execSync").mockReturnValue(
      '[{"id":"ns-abc123","title":"my-kv"}]' as any
    );

    const id = await ensureKVNamespace("my-kv");
    expect(id).toBe("ns-abc123");
  });

  it("should create namespace when not found", async () => {
    vi.spyOn(child_process, "execSync")
      // list returns empty array
      .mockReturnValueOnce("[]" as any)
      // create returns ID
      .mockReturnValueOnce('{ binding = "MY_KV", id = "ns-new456" }' as any);

    const id = await ensureKVNamespace("my-kv");
    expect(id).toBe("ns-new456");
  });

  it("should throw if create output has no ID", async () => {
    vi.spyOn(child_process, "execSync")
      .mockReturnValueOnce("[]" as any)
      .mockReturnValueOnce("Created namespace" as any);

    await expect(ensureKVNamespace("my-kv")).rejects.toThrow(
      "Failed to parse KV namespace ID"
    );
  });
});

describe("deleteWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call wrangler delete with --force", async () => {
    const execSyncSpy = vi
      .spyOn(child_process, "execSync")
      .mockReturnValue("" as any);

    await deleteWorker("my-worker");

    const cmd = execSyncSpy.mock.calls[0][0] as string;
    expect(cmd).toContain("wrangler delete");
    expect(cmd).toContain("--name my-worker");
    expect(cmd).toContain("--force");
  });

  it("should reject invalid worker names", async () => {
    await expect(
      deleteWorker("$(evil-cmd)")
    ).rejects.toThrow("Invalid worker name");
  });
});

describe("checkHealth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return healthy for OK response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 })
    );

    const result = await checkHealth("https://my-worker.workers.dev");
    expect(result.healthy).toBe(true);
    expect(result.status).toBe(200);
  });

  it("should return unhealthy for error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Error", { status: 500 })
    );

    const result = await checkHealth("https://my-worker.workers.dev");
    expect(result.healthy).toBe(false);
    expect(result.status).toBe(500);
  });

  it("should return error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network error")
    );

    const result = await checkHealth("https://my-worker.workers.dev");
    expect(result.healthy).toBe(false);
    expect(result.error).toBe("Network error");
  });
});
