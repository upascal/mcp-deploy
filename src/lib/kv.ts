import { kv } from "@vercel/kv";
import { encrypt, decrypt } from "./encryption";
import type { DeploymentRecord, McpSecretsRecord, StoredMcpEntry } from "./types";

// ─── Cloudflare Token ───

export async function getCfToken(): Promise<string | null> {
  const encrypted = await kv.get<string>("cf:token");
  if (!encrypted) return null;
  return decrypt(encrypted);
}

export async function setCfToken(token: string): Promise<void> {
  await kv.set("cf:token", encrypt(token));
}

export async function getCfAccountId(): Promise<string | null> {
  return kv.get<string>("cf:accountId");
}

export async function setCfAccountId(accountId: string): Promise<void> {
  await kv.set("cf:accountId", accountId);
}

export async function isCfConfigured(): Promise<boolean> {
  const [token, accountId] = await Promise.all([
    kv.get("cf:token"),
    kv.get("cf:accountId"),
  ]);
  return !!token && !!accountId;
}

// ─── Deployment Records ───

export async function getDeployment(
  slug: string,
): Promise<DeploymentRecord | null> {
  return kv.get<DeploymentRecord>(`mcp:${slug}`);
}

export async function setDeployment(record: DeploymentRecord): Promise<void> {
  await kv.set(`mcp:${record.slug}`, record);
}

// ─── MCP Secrets ───

export async function getMcpSecrets(
  slug: string,
): Promise<McpSecretsRecord | null> {
  const encrypted = await kv.get<McpSecretsRecord>(`secrets:${slug}`);
  if (!encrypted) return null;

  const decrypted: McpSecretsRecord = {};
  for (const [key, val] of Object.entries(encrypted)) {
    decrypted[key] = decrypt(val);
  }
  return decrypted;
}

export async function setMcpSecrets(
  slug: string,
  secrets: Record<string, string>,
): Promise<void> {
  const encrypted: McpSecretsRecord = {};
  for (const [key, val] of Object.entries(secrets)) {
    if (val) {
      encrypted[key] = encrypt(val);
    }
  }
  await kv.set(`secrets:${slug}`, encrypted);
}

/**
 * Get the decrypted bearer token for a deployed MCP.
 */
export async function getMcpBearerToken(slug: string): Promise<string | null> {
  const deployment = await getDeployment(slug);
  if (!deployment?.bearerToken) return null;
  return decrypt(deployment.bearerToken);
}

// ─── MCP Registry (stored in KV) ───

export async function getMcps(): Promise<StoredMcpEntry[]> {
  const data = await kv.get<StoredMcpEntry[]>("mcps");
  return data ?? [];
}

export async function setMcps(mcps: StoredMcpEntry[]): Promise<void> {
  await kv.set("mcps", mcps);
}

export async function addMcp(entry: StoredMcpEntry): Promise<void> {
  const existing = await getMcps();

  // Check for duplicate slug
  if (existing.some((m) => m.slug === entry.slug)) {
    throw new Error(`MCP with slug "${entry.slug}" already exists`);
  }

  await setMcps([...existing, entry]);
}

export async function removeMcp(slug: string): Promise<void> {
  const existing = await getMcps();
  await setMcps(existing.filter((m) => m.slug !== slug));
}

// ─── Seeding ───

export async function hasSeededDefaults(): Promise<boolean> {
  return (await kv.get<boolean>("seeded-defaults")) ?? false;
}

export async function markSeededDefaults(): Promise<void> {
  await kv.set("seeded-defaults", true);
}

export async function resetSeededDefaults(): Promise<void> {
  await kv.set("seeded-defaults", false);
}
