import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { DeploymentRecord, McpSecretsRecord, StoredMcpEntry } from "./types";

// ─── Local JSON Store ───
// Replaces Vercel KV with a simple local JSON file.
// Data lives at <project>/data/store.json (gitignored).

const DATA_DIR = join(process.cwd(), "data");
const STORE_PATH = join(DATA_DIR, "store.json");

interface Store {
  mcps: StoredMcpEntry[];
  deployments: Record<string, DeploymentRecord>;
  secrets: Record<string, Record<string, string>>;
  seededDefaults: boolean;
  cfToken?: string;
  cfAccountId?: string;
}

const EMPTY_STORE: Store = {
  mcps: [],
  deployments: {},
  secrets: {},
  seededDefaults: false,
};

function readStore(): Store {
  try {
    if (!existsSync(STORE_PATH)) {
      return { ...EMPTY_STORE };
    }
    const raw = readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw) as Store;
  } catch {
    return { ...EMPTY_STORE };
  }
}

function writeStore(store: Store): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// ─── Deployment Records ───

export async function getDeployment(
  slug: string
): Promise<DeploymentRecord | null> {
  const store = readStore();
  return store.deployments[slug] ?? null;
}

export async function setDeployment(record: DeploymentRecord): Promise<void> {
  const store = readStore();
  store.deployments[record.slug] = record;
  writeStore(store);
}

// ─── MCP Secrets ───

export async function getMcpSecrets(
  slug: string
): Promise<McpSecretsRecord | null> {
  const store = readStore();
  return store.secrets[slug] ?? null;
}

export async function setMcpSecrets(
  slug: string,
  secrets: Record<string, string>
): Promise<void> {
  const store = readStore();
  const cleaned: McpSecretsRecord = {};
  for (const [key, val] of Object.entries(secrets)) {
    if (val) {
      cleaned[key] = val;
    }
  }
  store.secrets[slug] = cleaned;
  writeStore(store);
}

/**
 * Get the bearer token for a deployed MCP.
 */
export async function getMcpBearerToken(
  slug: string
): Promise<string | null> {
  const deployment = await getDeployment(slug);
  return deployment?.bearerToken ?? null;
}

// ─── MCP Registry ───

export async function getMcps(): Promise<StoredMcpEntry[]> {
  const store = readStore();
  return store.mcps;
}

export async function setMcps(mcps: StoredMcpEntry[]): Promise<void> {
  const store = readStore();
  store.mcps = mcps;
  writeStore(store);
}

export async function addMcp(entry: StoredMcpEntry): Promise<void> {
  const existing = await getMcps();

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
  const store = readStore();
  return store.seededDefaults;
}

export async function markSeededDefaults(): Promise<void> {
  const store = readStore();
  store.seededDefaults = true;
  writeStore(store);
}

export async function resetSeededDefaults(): Promise<void> {
  const store = readStore();
  store.seededDefaults = false;
  writeStore(store);
}

// ─── Cloudflare Config ───

export async function getCfToken(): Promise<string | null> {
  const store = readStore();
  return store.cfToken ?? null;
}

export async function setCfToken(token: string): Promise<void> {
  const store = readStore();
  store.cfToken = token;
  writeStore(store);
}

export async function getCfAccountId(): Promise<string | null> {
  const store = readStore();
  return store.cfAccountId ?? null;
}

export async function setCfAccountId(accountId: string): Promise<void> {
  const store = readStore();
  store.cfAccountId = accountId;
  writeStore(store);
}

export async function isCfConfigured(): Promise<boolean> {
  const store = readStore();
  return !!(store.cfToken && store.cfAccountId);
}
