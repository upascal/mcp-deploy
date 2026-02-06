import Cloudflare from "cloudflare";
import { randomBytes } from "crypto";
import type { ResolvedMcpEntry } from "./types";

export class CloudflareDeployService {
  private client: Cloudflare;
  private accountId: string;
  private apiToken: string;

  constructor(apiToken: string, accountId: string) {
    this.client = new Cloudflare({ apiToken });
    this.accountId = accountId;
    this.apiToken = apiToken;
  }

  /**
   * Validate a Cloudflare API token and return the first account ID.
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
      const accounts = await client.accounts.list();

      const first = accounts.result?.[0];
      if (!first) {
        return { valid: false, error: "No accounts found for this token." };
      }

      return {
        valid: true,
        accountId: first.id,
        accountName: first.name,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { valid: false, error: message };
    }
  }

  /**
   * Generate a cryptographically random bearer token.
   */
  static generateBearerToken(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * Deploy a worker to Cloudflare using the Scripts Upload API.
   * Uses multipart form data with the bundled JS + metadata.
   *
   * When an OAuth wrapper is provided, uploads two modules:
   *   - `index.mjs` (the OAuth wrapper, set as main_module)
   *   - `original.mjs` (the actual MCP worker code)
   *
   * @param entry - The resolved MCP entry with all metadata
   * @param bundleContent - The worker script content
   * @param oauthWrapper - Optional OAuth wrapper module code
   */
  async deployWorker(
    entry: ResolvedMcpEntry,
    bundleContent: string,
    oauthWrapper?: string
  ): Promise<{ url: string }> {
    const workerName = entry.workerName;

    // Check if worker already exists to determine migration strategy
    const exists = await this.workerExists(workerName);
    console.log(
      `[CloudflareDeployService] Worker ${workerName} exists: ${exists}`
    );

    // Build the metadata for Cloudflare
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

    // Only include migrations for NEW workers
    // Existing workers already have the migration applied — don't touch it
    if (!exists) {
      metadata.migrations = {
        new_tag: entry.migrationTag,
        new_sqlite_classes: [entry.durableObjectClassName],
      };
      console.log(`[CloudflareDeployService] New worker, including migrations`);
    } else {
      console.log(
        `[CloudflareDeployService] Existing worker, skipping migrations`
      );
    }

    // Upload via multipart form data
    const formData = new FormData();

    if (oauthWrapper) {
      // Two-module deployment: OAuth wrapper as entry + original worker
      formData.append(
        "index.mjs",
        new Blob([oauthWrapper], { type: "application/javascript+module" }),
        "index.mjs"
      );
      formData.append(
        "original.mjs",
        new Blob([bundleContent], { type: "application/javascript+module" }),
        "original.mjs"
      );
      console.log(
        `[CloudflareDeployService] Deploying with OAuth wrapper (two modules)`
      );
    } else {
      // Single-module deployment (legacy)
      formData.append(
        "index.mjs",
        new Blob([bundleContent], { type: "application/javascript+module" }),
        "index.mjs"
      );
    }

    formData.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${workerName}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.getApiToken()}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to deploy worker: ${response.status} ${response.statusText}\n${body}`
      );
    }

    // Enable the workers.dev subdomain
    await this.enableWorkersDevSubdomain(workerName);

    const url = `https://${workerName}.${await this.getSubdomain()}.workers.dev`;
    return { url };
  }

  /**
   * Check if a worker exists on Cloudflare.
   * Uses GET instead of HEAD for more reliable detection.
   */
  private async workerExists(workerName: string): Promise<boolean> {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${workerName}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.getApiToken()}`,
          },
        }
      );

      // A 200 means the worker exists
      // A 404 means it doesn't exist
      // Other errors we'll treat as "doesn't exist" to be safe
      if (response.ok) {
        console.log(
          `[CloudflareDeployService] Worker ${workerName} found via GET`
        );
        return true;
      }

      console.log(
        `[CloudflareDeployService] Worker ${workerName} check returned ${response.status}`
      );
      return false;
    } catch (err) {
      console.log(
        `[CloudflareDeployService] Worker ${workerName} check failed:`,
        err
      );
      return false;
    }
  }

  /**
   * Set secrets on a deployed worker.
   */
  async setSecrets(
    workerName: string,
    secrets: Record<string, string>
  ): Promise<void> {
    for (const [name, value] of Object.entries(secrets)) {
      if (!value) continue;

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${workerName}/secrets`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.getApiToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            text: value,
            type: "secret_text",
          }),
        }
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Failed to set secret ${name}: ${response.status}\n${body}`
        );
      }
    }
  }

  /**
   * Delete a secret from a deployed worker.
   */
  async deleteSecret(workerName: string, secretName: string): Promise<void> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${workerName}/secrets/${secretName}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.getApiToken()}`,
        },
      }
    );

    // 404 is fine - secret might not exist
    if (!response.ok && response.status !== 404) {
      const body = await response.text();
      throw new Error(
        `Failed to delete secret ${secretName}: ${response.status}\n${body}`
      );
    }
  }

  /**
   * Check if a deployed worker is healthy by hitting its root endpoint.
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

  /**
   * Delete a worker from Cloudflare.
   */
  async deleteWorker(workerName: string): Promise<void> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${workerName}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.getApiToken()}`,
        },
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to delete worker: ${response.status}\n${body}`);
    }
  }

  /**
   * Enable the workers.dev subdomain for a worker.
   */
  private async enableWorkersDevSubdomain(workerName: string): Promise<void> {
    try {
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${workerName}/subdomain`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.getApiToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ enabled: true }),
        }
      );
    } catch {
      // Not critical if this fails — subdomain may already be enabled
    }
  }

  /**
   * Get the workers.dev subdomain for this account.
   */
  private async getSubdomain(): Promise<string> {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/subdomain`,
        {
          headers: {
            Authorization: `Bearer ${this.getApiToken()}`,
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

  private getApiToken(): string {
    return this.apiToken;
  }
}
