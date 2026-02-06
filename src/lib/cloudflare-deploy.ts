/**
 * Cloudflare Deploy Service — uses the Cloudflare REST API directly
 * (via the `cloudflare` SDK) instead of shelling out to wrangler.
 *
 * Handles:
 * - Token validation
 * - Worker deployment (multi-module upload)
 * - Secret management (bulk put / delete)
 * - Health checks
 * - Worker deletion
 */

import Cloudflare from "cloudflare";
import { randomBytes } from "crypto";
import type { ResolvedMcpEntry } from "./types";

export class CloudflareDeployService {
  private client: Cloudflare;
  private accountId: string;

  constructor(apiToken: string, accountId: string) {
    this.client = new Cloudflare({ apiToken });
    this.accountId = accountId;
  }

  // ─── Static helpers ───

  /**
   * Validate a Cloudflare API token and return the associated account.
   */
  static async validateToken(
    apiToken: string
  ): Promise<{
    valid: boolean;
    accountId?: string;
    accountName?: string;
    error?: string;
  }> {
    try {
      const client = new Cloudflare({ apiToken });
      const verify = await client.user.tokens.verify();

      if (verify.status !== "active") {
        return { valid: false, error: "Token is not active" };
      }

      // Fetch accounts to get the account ID
      const accounts = await client.accounts.list({ per_page: 1 });
      const account = accounts.result?.[0];

      if (!account) {
        return { valid: false, error: "No accounts found for this token" };
      }

      return {
        valid: true,
        accountId: account.id,
        accountName: account.name,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid token";
      return { valid: false, error: message };
    }
  }

  /**
   * Generate a random bearer token for worker authentication.
   */
  static generateBearerToken(): string {
    return randomBytes(32).toString("hex");
  }

  // ─── Worker Deployment ───

  /**
   * Deploy a worker to Cloudflare Workers using the API.
   *
   * Uploads two modules:
   *   - index.mjs  (the wrapper — main entry point)
   *   - original.mjs (the actual MCP bundle from GitHub)
   */
  async deployWorker(
    entry: ResolvedMcpEntry,
    bundleContent: string,
    wrapperContent: string
  ): Promise<{ url: string }> {
    const scriptName = entry.workerName;

    // Check if the worker already exists (to decide whether to include migrations)
    const workerExists = await this.workerExists(scriptName);

    // Build metadata
    const metadata: Record<string, unknown> = {
      main_module: "index.mjs",
      compatibility_date: entry.compatibilityDate,
      compatibility_flags: entry.compatibilityFlags,
      bindings: [
        {
          type: "durable_object_namespace",
          name: entry.durableObjectBinding,
          class_name: entry.durableObjectClassName,
        },
      ],
    };

    // Only include migrations for new workers
    if (!workerExists) {
      metadata.migrations = {
        new_tag: entry.migrationTag,
        steps: [
          {
            new_classes: [entry.durableObjectClassName],
            new_sqlite_classes: [entry.durableObjectClassName],
          },
        ],
      };
    }

    // Build the form data for multi-module upload
    const formData = new FormData();
    formData.set(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );
    formData.set(
      "index.mjs",
      new Blob([wrapperContent], { type: "application/javascript+module" }),
      "index.mjs"
    );
    formData.set(
      "original.mjs",
      new Blob([bundleContent], { type: "application/javascript+module" }),
      "original.mjs"
    );

    // Upload worker via the API
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${scriptName}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${(this.client as unknown as { apiToken: string }).apiToken ?? ""}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Worker upload failed (${response.status}): ${body}`);
    }

    // Enable the workers.dev subdomain so we get a URL
    await this.enableWorkersDev(scriptName);

    // Construct the workers.dev URL
    const subdomain = await this.getWorkersDevSubdomain();
    const url = `https://${scriptName}.${subdomain}.workers.dev`;

    return { url };
  }

  // ─── Secrets ───

  /**
   * Set multiple secrets on a worker (bulk).
   */
  async setSecrets(
    workerName: string,
    secrets: Record<string, string>
  ): Promise<void> {
    const filtered = Object.entries(secrets).filter(([, v]) => v);
    if (filtered.length === 0) return;

    // Use the bulk secrets API
    const body = filtered.map(([name, text]) => ({ name, text, type: "secret_text" }));

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${workerName}/secrets`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to set secrets (${response.status}): ${text}`);
    }
  }

  /**
   * Delete a single secret from a worker.
   */
  async deleteSecret(workerName: string, secretName: string): Promise<void> {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${workerName}/secrets/${secretName}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${this.getToken()}`,
          },
        }
      );
      // Ignore 404 — secret might not exist
      if (!response.ok && response.status !== 404) {
        const text = await response.text();
        throw new Error(`Failed to delete secret (${response.status}): ${text}`);
      }
    } catch {
      // Ignore errors (secret might not exist)
    }
  }

  // ─── Health Check ───

  /**
   * Check if a deployed worker is healthy.
   */
  async checkHealth(
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
  async deleteWorker(workerName: string): Promise<void> {
    await this.client.workers.scripts.delete(workerName, {
      account_id: this.accountId,
    });
  }

  // ─── Private Helpers ───

  private async workerExists(scriptName: string): Promise<boolean> {
    try {
      await this.client.workers.scripts.get(scriptName, {
        account_id: this.accountId,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async enableWorkersDev(scriptName: string): Promise<void> {
    try {
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${scriptName}/subdomain`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.getToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ enabled: true }),
        }
      );
    } catch {
      // Non-fatal — subdomain might already be enabled
    }
  }

  private async getWorkersDevSubdomain(): Promise<string> {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/subdomain`,
        {
          headers: {
            Authorization: `Bearer ${this.getToken()}`,
          },
        }
      );
      const data = (await response.json()) as {
        result?: { subdomain?: string };
      };
      return data.result?.subdomain ?? this.accountId;
    } catch {
      return this.accountId;
    }
  }

  private getToken(): string {
    // Extract the API token from the client. The cloudflare SDK stores it internally.
    // We also received it in the constructor, so we use a workaround.
    return (this.client as unknown as { _options: { apiToken: string } })
      ._options.apiToken;
  }
}
