/**
 * Wrangler CLI wrapper for Cloudflare operations.
 *
 * Shells out to `npx wrangler` for all Cloudflare interactions:
 * - Login/auth (wrangler login, wrangler whoami)
 * - Worker deployment (wrangler deploy from temp dir)
 * - Secret management (wrangler secret bulk)
 * - KV namespace management (wrangler kv namespace)
 * - KV key management (wrangler kv key put)
 *
 * Pattern based on zotero-assistant-mcp-remote/packages/deploy/setup/server.ts
 */

import { execSync, exec } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ResolvedMcpEntry } from "./types";

// ─── Auth ───

/**
 * Check if wrangler is logged in to Cloudflare.
 */
export function checkWranglerLogin(): {
  loggedIn: boolean;
  account?: string;
} {
  try {
    const output = execSync("npx wrangler whoami 2>&1", {
      encoding: "utf-8",
      timeout: 15000,
    });

    if (
      output.includes("You are logged in") ||
      output.includes("associated with")
    ) {
      // Try to extract email
      const emailMatch = output.match(
        /associated with the email ([^\s!]+)/
      );
      const account = emailMatch ? emailMatch[1] : undefined;
      return { loggedIn: true, account };
    }

    return { loggedIn: false };
  } catch {
    return { loggedIn: false };
  }
}

/**
 * Run wrangler login (opens browser for OAuth).
 */
export async function wranglerLogin(): Promise<{
  success: boolean;
  error?: string;
}> {
  return new Promise((resolve) => {
    const child = exec("npx wrangler login", {
      timeout: 120000,
    });

    let output = "";
    child.stdout?.on("data", (data: string) => (output += data));
    child.stderr?.on("data", (data: string) => (output += data));

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: "Cloudflare login failed. Please try again.",
        });
      }
    });

    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

// ─── Worker Deployment ───

/**
 * Deploy a worker to Cloudflare using wrangler.
 *
 * Creates a temp directory with wrangler.jsonc + worker modules,
 * runs `wrangler deploy`, and parses the URL from output.
 */
export async function deployWorker(
  entry: ResolvedMcpEntry,
  bundleContent: string,
  wrapperContent: string,
  kvNamespaceId?: string
): Promise<{ url: string }> {
  const tempDir = mkdtempSync(join(tmpdir(), "mcp-deploy-"));

  try {
    // Check if worker already exists (determines whether to include migrations)
    const workerExists = checkWorkerExists(entry.workerName);

    // Build wrangler.jsonc
    const wranglerConfig: Record<string, unknown> = {
      name: entry.workerName,
      main: "index.mjs",
      compatibility_date: entry.compatibilityDate,
      compatibility_flags: entry.compatibilityFlags,
      durable_objects: {
        bindings: [
          {
            name: entry.durableObjectBinding,
            class_name: entry.durableObjectClassName,
          },
        ],
      },
      ...(kvNamespaceId && {
        kv_namespaces: [
          {
            binding: "OAUTH_KV",
            id: kvNamespaceId,
          },
        ],
      }),
    };

    // Only include migrations for new workers
    if (!workerExists) {
      wranglerConfig.migrations = [
        {
          tag: entry.migrationTag,
          new_sqlite_classes: [entry.durableObjectClassName],
        },
      ];
      console.log("[wrangler] New worker, including migrations");
    } else {
      console.log("[wrangler] Existing worker, skipping migrations");
    }

    // Write files to temp dir
    writeFileSync(
      join(tempDir, "wrangler.jsonc"),
      JSON.stringify(wranglerConfig, null, 2)
    );
    writeFileSync(join(tempDir, "index.mjs"), wrapperContent);
    writeFileSync(join(tempDir, "original.mjs"), bundleContent);

    // Run wrangler deploy
    console.log(`[wrangler] Deploying ${entry.workerName} from ${tempDir}...`);
    const deployOutput = execSync("npx wrangler deploy 2>&1", {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 120000,
    });
    console.log("[wrangler] Deploy output:", deployOutput);

    // Parse URL from output
    const urlMatch = deployOutput.match(/https:\/\/[^\s]+\.workers\.dev/);
    if (!urlMatch) {
      throw new Error(
        "Deployed but could not find Worker URL in output. Check wrangler output."
      );
    }

    return { url: urlMatch[0] };
  } finally {
    // Clean up temp dir
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if a worker already exists on Cloudflare.
 */
function checkWorkerExists(workerName: string): boolean {
  try {
    const output = execSync(
      `npx wrangler deployments list --name ${workerName} 2>&1`,
      {
        encoding: "utf-8",
        timeout: 15000,
      }
    );
    // If the command succeeds and shows deployments, the worker exists
    return !output.includes("no deployments") && output.includes("Created on");
  } catch {
    // Command fails if worker doesn't exist
    return false;
  }
}

// ─── Secrets ───

/**
 * Set secrets on a deployed worker via wrangler secret bulk.
 */
export async function setSecrets(
  workerName: string,
  secrets: Record<string, string>
): Promise<void> {
  // Filter out empty values
  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(secrets)) {
    if (value) {
      filtered[name] = value;
    }
  }

  if (Object.keys(filtered).length === 0) return;

  const secretsJson = JSON.stringify(filtered);

  console.log(
    `[wrangler] Setting ${Object.keys(filtered).length} secrets on ${workerName}...`
  );
  execSync(
    `echo '${secretsJson.replace(/'/g, "'\\''")}' | npx wrangler secret bulk --name ${workerName} 2>&1`,
    {
      encoding: "utf-8",
      timeout: 30000,
    }
  );
  console.log("[wrangler] Secrets set successfully");
}

/**
 * Delete a secret from a deployed worker.
 */
export async function deleteSecret(
  workerName: string,
  secretName: string
): Promise<void> {
  try {
    execSync(
      `npx wrangler secret delete ${secretName} --name ${workerName} --force 2>&1`,
      {
        encoding: "utf-8",
        timeout: 15000,
      }
    );
  } catch {
    // Ignore errors (secret might not exist)
  }
}

// ─── KV Namespace Management ───

/**
 * Ensure a KV namespace exists, creating it if needed.
 * Returns the namespace ID.
 */
export async function ensureKVNamespace(title: string): Promise<string> {
  // List existing namespaces
  try {
    const output = execSync("npx wrangler kv namespace list 2>&1", {
      encoding: "utf-8",
      timeout: 15000,
    });

    // Parse JSON output — wrangler outputs JSON array of namespaces
    // The output may have non-JSON text before the JSON array
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const namespaces = JSON.parse(jsonMatch[0]) as {
        id: string;
        title: string;
      }[];
      const found = namespaces.find((ns) => ns.title === title);
      if (found) {
        console.log(
          `[wrangler] KV namespace "${title}" already exists: ${found.id}`
        );
        return found.id;
      }
    }
  } catch {
    // If listing fails, try creating anyway
  }

  // Create the namespace
  console.log(`[wrangler] Creating KV namespace "${title}"...`);
  const createOutput = execSync(
    `npx wrangler kv namespace create "${title}" 2>&1`,
    {
      encoding: "utf-8",
      timeout: 15000,
    }
  );

  // Parse the namespace ID from output
  // wrangler outputs something like: { binding = "...", id = "abc123" }
  const idMatch = createOutput.match(/id\s*=\s*"([^"]+)"/);
  if (!idMatch) {
    throw new Error(
      `Failed to parse KV namespace ID from wrangler output: ${createOutput}`
    );
  }

  console.log(
    `[wrangler] Created KV namespace "${title}": ${idMatch[1]}`
  );
  return idMatch[1];
}

/**
 * Write a key-value pair to a KV namespace.
 * Uses --path with a temp file to avoid shell escaping issues with JSON values.
 */
export async function writeKVValue(
  namespaceId: string,
  key: string,
  value: string,
  expirationTtl?: number
): Promise<void> {
  const ttlArg = expirationTtl ? ` --ttl ${expirationTtl}` : "";

  // Write value to a temp file, then use --path to pass it to wrangler
  const tempFile = join(mkdtempSync(join(tmpdir(), "mcp-kv-")), "value.json");
  try {
    writeFileSync(tempFile, value);
    execSync(
      `npx wrangler kv key put --namespace-id ${namespaceId} "${key}" --path "${tempFile}" --remote${ttlArg} 2>&1`,
      {
        encoding: "utf-8",
        timeout: 15000,
      }
    );
  } finally {
    try {
      rmSync(tempFile, { force: true });
      rmSync(join(tempFile, ".."), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ─── Health Check ───

/**
 * Check if a deployed worker is healthy.
 */
export async function checkHealth(
  workerUrl: string
): Promise<{ healthy: boolean; status?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(workerUrl, { signal: controller.signal });
    clearTimeout(timeout);

    return { healthy: res.ok, status: res.status };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { healthy: false, error: message };
  }
}

// ─── Worker Management ───

/**
 * Delete a worker from Cloudflare.
 */
export async function deleteWorker(workerName: string): Promise<void> {
  execSync(`npx wrangler delete --name ${workerName} --force 2>&1`, {
    encoding: "utf-8",
    timeout: 30000,
  });
}
