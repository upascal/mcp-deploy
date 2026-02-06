# Modular MCP Architecture - Implementation Plan

## Overview

Transform mcp-deploy from a monolithic bundler to a **modular deployment platform** where:
- MCP repos own their build process and publish Wrangler-built bundles
- mcp-deploy fetches bundles + metadata at deploy time
- Custom wizards are driven by schema in each MCP repo
- Users can add any compatible MCP via a "+" button

---

## Part 1: MCP Repo Changes

### 1.1 New File: `mcp-deploy.json` (Metadata Schema)

Each MCP repo publishes this file alongside their bundle. This drives the wizard UI.

```json
{
  "$schema": "https://mcp-deploy.example.com/schema/v1.json",
  "name": "Paper Search MCP",
  "description": "Search academic papers across Semantic Scholar, CrossRef, arXiv, PubMed, bioRxiv, and medRxiv.",
  "version": "0.2.0",

  "worker": {
    "name": "paper-search-mcp",
    "durableObjectBinding": "MCP_OBJECT",
    "durableObjectClassName": "PaperSearchMCP",
    "compatibilityDate": "2025-04-01",
    "compatibilityFlags": ["nodejs_compat"],
    "migrationTag": "v1"
  },

  "secrets": [
    {
      "key": "SEMANTIC_SCHOLAR_API_KEY",
      "label": "Semantic Scholar API Key",
      "required": false,
      "type": "password",
      "helpText": "Higher rate limits.",
      "helpUrl": "https://www.semanticscholar.org/product/api#api-key",
      "testConnection": "semantic_scholar",
      "forPlatform": "semantic_scholar"
    },
    {
      "key": "PUBMED_API_KEY",
      "label": "PubMed API Key",
      "required": false,
      "type": "password",
      "helpText": "10 req/s vs 3 without.",
      "helpUrl": "https://ncbiinsights.ncbi.nlm.nih.gov/2017/11/02/new-api-keys-for-the-e-utilities/",
      "testConnection": "pubmed",
      "forPlatform": "pubmed"
    },
    {
      "key": "CONTACT_EMAIL",
      "label": "Contact Email",
      "required": false,
      "type": "email",
      "helpText": "For CrossRef polite pool (faster responses).",
      "forPlatform": "crossref"
    }
  ],

  "config": [
    {
      "key": "ENABLED_PLATFORMS",
      "label": "Enabled Platforms",
      "type": "multiselect",
      "options": [
        { "value": "semantic_scholar", "label": "Semantic Scholar" },
        { "value": "crossref", "label": "CrossRef" },
        { "value": "arxiv", "label": "arXiv" },
        { "value": "pubmed", "label": "PubMed" },
        { "value": "biorxiv", "label": "bioRxiv" },
        { "value": "medrxiv", "label": "medRxiv" }
      ],
      "default": "semantic_scholar,crossref,arxiv",
      "helpText": "Select which academic databases to search."
    }
  ],

  "autoSecrets": ["BEARER_TOKEN"]
}
```

### 1.2 GitHub Actions Workflow

Each MCP repo adds `.github/workflows/release.yml`:

```yaml
name: Build and Release MCP Bundle

on:
  release:
    types: [published]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build worker bundle
        run: |
          # Use wrangler to build (handles all compatibility)
          npx wrangler deploy --dry-run --outdir dist

          # Rename to predictable name
          mv dist/index.js dist/worker.mjs

      - name: Validate mcp-deploy.json
        run: |
          if [ ! -f mcp-deploy.json ]; then
            echo "Error: mcp-deploy.json not found"
            exit 1
          fi
          # Basic JSON validation
          cat mcp-deploy.json | jq .

      - name: Upload release assets
        uses: softprops/action-gh-release@v2
        with:
          files: |
            dist/worker.mjs
            mcp-deploy.json
```

### 1.3 Wrangler Output

When you run `wrangler deploy --dry-run --outdir dist`, Wrangler:
1. Bundles your TypeScript with esbuild
2. Applies all `nodejs_compat` polyfills
3. Outputs a single `index.js` (we rename to `worker.mjs`)
4. Handles all the compatibility that currently requires shims

**This eliminates the need for mcp-deploy's shim system entirely.**

---

## Part 2: mcp-deploy Changes

### 2.1 Updated Type Definitions

**`src/lib/types.ts`** - Add remote MCP support:

```typescript
export interface SecretField {
  key: string;
  label: string;
  required: boolean;
  type?: "text" | "password" | "email";
  placeholder?: string;
  helpText?: string;
  helpUrl?: string;
  testConnection?: string;
  forPlatform?: string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "select" | "multiselect";
  options?: { value: string; label: string }[];
  default?: string;
  helpText?: string;
}

// Worker-specific metadata (from mcp-deploy.json)
export interface WorkerConfig {
  name: string;
  durableObjectBinding: string;
  durableObjectClassName: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
  migrationTag: string;
}

// Remote MCP metadata schema (fetched from GitHub releases)
export interface McpMetadata {
  name: string;
  description: string;
  version: string;
  worker: WorkerConfig;
  secrets: SecretField[];
  config: ConfigField[];
  autoSecrets: string[];
}

// Registry entry - can be local (bundled) or remote (GitHub)
export interface McpRegistryEntry {
  slug: string;
  source: "builtin" | "github";

  // For builtin MCPs (backwards compatibility)
  name?: string;
  description?: string;
  version?: string;
  bundlePath?: string;
  workerName?: string;
  durableObjectBinding?: string;
  durableObjectClassName?: string;
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  migrationTag?: string;
  secrets?: SecretField[];
  config?: ConfigField[];
  autoSecrets?: string[];

  // For GitHub MCPs
  githubRepo?: string;  // e.g., "upascal/paper-search-mcp-remote"
  releaseTag?: string;  // e.g., "v0.2.0" or "latest"

  // Cached metadata (fetched at runtime)
  _metadata?: McpMetadata;
  _bundleUrl?: string;
  _metadataUrl?: string;
}

// User-added MCP (stored in KV)
export interface UserMcpEntry {
  slug: string;
  githubRepo: string;
  releaseTag: string;
  addedAt: string;
}
```

### 2.2 GitHub Release Fetcher

**New file: `src/lib/github-releases.ts`**

```typescript
interface GitHubRelease {
  tag_name: string;
  assets: {
    name: string;
    browser_download_url: string;
  }[];
}

export async function getLatestRelease(repo: string): Promise<GitHubRelease> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github.v3+json",
        // Add token if rate limited: Authorization: `token ${process.env.GITHUB_TOKEN}`
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch release: ${response.status}`);
  }

  return response.json();
}

export async function getRelease(repo: string, tag: string): Promise<GitHubRelease> {
  if (tag === "latest") {
    return getLatestRelease(repo);
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    {
      headers: { Accept: "application/vnd.github.v3+json" },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch release ${tag}: ${response.status}`);
  }

  return response.json();
}

export async function fetchMcpMetadata(repo: string, tag: string = "latest"): Promise<{
  metadata: McpMetadata;
  bundleUrl: string;
  metadataUrl: string;
  version: string;
}> {
  const release = await getRelease(repo, tag);

  const metadataAsset = release.assets.find(a => a.name === "mcp-deploy.json");
  const bundleAsset = release.assets.find(a => a.name === "worker.mjs");

  if (!metadataAsset) {
    throw new Error(`Release ${release.tag_name} missing mcp-deploy.json`);
  }
  if (!bundleAsset) {
    throw new Error(`Release ${release.tag_name} missing worker.mjs`);
  }

  // Fetch and parse metadata
  const metadataResponse = await fetch(metadataAsset.browser_download_url);
  const metadata: McpMetadata = await metadataResponse.json();

  return {
    metadata,
    bundleUrl: bundleAsset.browser_download_url,
    metadataUrl: metadataAsset.browser_download_url,
    version: release.tag_name,
  };
}

export async function fetchWorkerBundle(bundleUrl: string): Promise<string> {
  const response = await fetch(bundleUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch bundle: ${response.status}`);
  }
  return response.text();
}

export async function validateGitHubRepo(repo: string): Promise<{
  valid: boolean;
  hasReleases: boolean;
  hasMcpDeployJson: boolean;
  latestVersion?: string;
  error?: string;
}> {
  try {
    const release = await getLatestRelease(repo);

    const hasMetadata = release.assets.some(a => a.name === "mcp-deploy.json");
    const hasBundle = release.assets.some(a => a.name === "worker.mjs");

    return {
      valid: hasMetadata && hasBundle,
      hasReleases: true,
      hasMcpDeployJson: hasMetadata,
      latestVersion: release.tag_name,
      error: !hasMetadata
        ? "Release missing mcp-deploy.json"
        : !hasBundle
          ? "Release missing worker.mjs"
          : undefined,
    };
  } catch (err) {
    return {
      valid: false,
      hasReleases: false,
      hasMcpDeployJson: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
```

### 2.3 Updated Registry

**`src/lib/mcp-registry.ts`** - Hybrid local + remote:

```typescript
import { McpRegistryEntry, UserMcpEntry } from "./types";
import { getMcpDeployKV } from "./kv";

// Built-in MCPs (can migrate to remote over time)
export const BUILTIN_MCPS: McpRegistryEntry[] = [
  {
    slug: "paper-search",
    source: "github",
    githubRepo: "upascal/paper-search-mcp-remote",
    releaseTag: "latest",
  },
  {
    slug: "zotero-assistant",
    source: "github",
    githubRepo: "upascal/zotero-assistant-mcp-remote",
    releaseTag: "latest",
  },
];

// Get user-added MCPs from KV
export async function getUserMcps(): Promise<UserMcpEntry[]> {
  const kv = getMcpDeployKV();
  const data = await kv.get<UserMcpEntry[]>("user-mcps");
  return data ?? [];
}

// Add a user MCP
export async function addUserMcp(entry: UserMcpEntry): Promise<void> {
  const kv = getMcpDeployKV();
  const existing = await getUserMcps();

  // Check for duplicate slug
  if (existing.some(m => m.slug === entry.slug)) {
    throw new Error(`MCP with slug "${entry.slug}" already exists`);
  }

  await kv.set("user-mcps", [...existing, entry]);
}

// Remove a user MCP
export async function removeUserMcp(slug: string): Promise<void> {
  const kv = getMcpDeployKV();
  const existing = await getUserMcps();
  await kv.set("user-mcps", existing.filter(m => m.slug !== slug));
}

// Get all MCPs (builtin + user)
export async function getAllMcps(): Promise<McpRegistryEntry[]> {
  const userMcps = await getUserMcps();

  const userEntries: McpRegistryEntry[] = userMcps.map(u => ({
    slug: u.slug,
    source: "github" as const,
    githubRepo: u.githubRepo,
    releaseTag: u.releaseTag,
  }));

  return [...BUILTIN_MCPS, ...userEntries];
}

// Get a specific MCP by slug
export async function getRegistryEntry(slug: string): Promise<McpRegistryEntry | undefined> {
  const all = await getAllMcps();
  return all.find(m => m.slug === slug);
}
```

### 2.4 Updated Deploy Service

**`src/lib/cloudflare-deploy.ts`** - Accept bundle content instead of path:

```typescript
// Change deployWorker signature to accept bundle content
async deployWorker(
  metadata: McpMetadata,
  bundleContent: string,
): Promise<{ url: string }> {
  const workerName = metadata.worker.name;

  // Check if worker already exists
  const exists = await this.workerExists(workerName);

  // Build Cloudflare metadata
  const cfMetadata: Record<string, unknown> = {
    main_module: "index.mjs",
    compatibility_date: metadata.worker.compatibilityDate,
    compatibility_flags: metadata.worker.compatibilityFlags,
    bindings: [
      {
        type: "durable_object_namespace",
        name: metadata.worker.durableObjectBinding,
        class_name: metadata.worker.durableObjectClassName,
      },
    ],
  };

  if (!exists) {
    cfMetadata.migrations = {
      new_tag: metadata.worker.migrationTag,
      new_sqlite_classes: [metadata.worker.durableObjectClassName],
    };
  }

  // Upload via multipart form data
  const formData = new FormData();
  formData.append(
    "index.mjs",
    new Blob([bundleContent], { type: "application/javascript+module" }),
    "index.mjs"
  );
  formData.append(
    "metadata",
    new Blob([JSON.stringify(cfMetadata)], { type: "application/json" })
  );

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/workers/scripts/${workerName}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.getApiToken()}` },
      body: formData,
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to deploy worker: ${response.status}\n${body}`);
  }

  await this.enableWorkersDevSubdomain(workerName);

  const url = `https://${workerName}.${await this.getSubdomain()}.workers.dev`;
  return { url };
}
```

### 2.5 Updated Deploy API Route

**`src/app/api/mcps/[slug]/deploy/route.ts`**:

```typescript
import { fetchMcpMetadata, fetchWorkerBundle } from "@/lib/github-releases";
import { getRegistryEntry } from "@/lib/mcp-registry";

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const { slug } = params;
  const entry = await getRegistryEntry(slug);

  if (!entry) {
    return Response.json({ error: "MCP not found" }, { status: 404 });
  }

  // Fetch metadata and bundle from GitHub
  const { metadata, bundleUrl } = await fetchMcpMetadata(
    entry.githubRepo!,
    entry.releaseTag
  );

  const bundleContent = await fetchWorkerBundle(bundleUrl);

  // Deploy to Cloudflare
  const service = new CloudflareDeployService(apiToken, accountId);
  const { url } = await service.deployWorker(metadata, bundleContent);

  // Set secrets (unchanged)
  const allSecrets = { ...userSecrets, BEARER_TOKEN: bearerToken };
  await service.setSecrets(metadata.worker.name, allSecrets);

  // ... rest of response handling
}
```

### 2.6 New API Routes

**`src/app/api/mcps/add/route.ts`** - Add a new MCP:

```typescript
import { validateGitHubRepo, fetchMcpMetadata } from "@/lib/github-releases";
import { addUserMcp, getUserMcps } from "@/lib/mcp-registry";

export async function POST(req: Request) {
  const { githubRepo } = await req.json();

  // Validate the repo has proper releases
  const validation = await validateGitHubRepo(githubRepo);
  if (!validation.valid) {
    return Response.json({
      error: validation.error,
      hasReleases: validation.hasReleases,
      hasMcpDeployJson: validation.hasMcpDeployJson,
    }, { status: 400 });
  }

  // Fetch metadata to get the slug
  const { metadata, version } = await fetchMcpMetadata(githubRepo);

  // Generate slug from worker name
  const slug = metadata.worker.name;

  // Check for conflicts
  const existing = await getUserMcps();
  if (existing.some(m => m.slug === slug)) {
    return Response.json({
      error: `MCP "${metadata.name}" is already added`
    }, { status: 409 });
  }

  // Add to user MCPs
  await addUserMcp({
    slug,
    githubRepo,
    releaseTag: "latest",
    addedAt: new Date().toISOString(),
  });

  return Response.json({
    success: true,
    slug,
    name: metadata.name,
    version,
  });
}
```

**`src/app/api/mcps/[slug]/remove/route.ts`** - Remove a user-added MCP:

```typescript
import { removeUserMcp } from "@/lib/mcp-registry";
import { BUILTIN_MCPS } from "@/lib/mcp-registry";

export async function DELETE(req: Request, { params }: { params: { slug: string } }) {
  const { slug } = params;

  // Prevent removing builtin MCPs
  if (BUILTIN_MCPS.some(m => m.slug === slug)) {
    return Response.json({ error: "Cannot remove built-in MCP" }, { status: 400 });
  }

  await removeUserMcp(slug);

  return Response.json({ success: true });
}
```

### 2.7 New UI: Add MCP Modal

**`src/components/AddMcpModal.tsx`**:

```typescript
"use client";

import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: (slug: string) => void;
}

export function AddMcpModal({ open, onClose, onAdded }: Props) {
  const [repo, setRepo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{
    valid: boolean;
    name?: string;
    version?: string;
  } | null>(null);

  const validateRepo = async () => {
    setValidating(true);
    setError(null);

    try {
      const res = await fetch(`/api/mcps/validate?repo=${encodeURIComponent(repo)}`);
      const data = await res.json();

      if (data.valid) {
        setValidation({ valid: true, name: data.name, version: data.version });
      } else {
        setError(data.error);
        setValidation(null);
      }
    } catch {
      setError("Failed to validate repository");
    } finally {
      setValidating(false);
    }
  };

  const addMcp = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/mcps/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubRepo: repo }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      onAdded(data.slug);
      onClose();
    } catch {
      setError("Failed to add MCP");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Add MCP Server</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              GitHub Repository
            </label>
            <input
              type="text"
              value={repo}
              onChange={(e) => {
                setRepo(e.target.value);
                setValidation(null);
              }}
              placeholder="owner/repo (e.g., upascal/paper-search-mcp)"
              className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Repository must have releases with worker.mjs and mcp-deploy.json
            </p>
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-500/10 rounded-lg p-3">
              {error}
            </div>
          )}

          {validation?.valid && (
            <div className="text-green-400 text-sm bg-green-500/10 rounded-lg p-3">
              Found: {validation.name} ({validation.version})
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-gray-800 text-gray-300"
            >
              Cancel
            </button>

            {!validation?.valid ? (
              <button
                onClick={validateRepo}
                disabled={!repo || validating}
                className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50"
              >
                {validating ? "Checking..." : "Check Repository"}
              </button>
            ) : (
              <button
                onClick={addMcp}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white disabled:opacity-50"
              >
                {loading ? "Adding..." : "Add MCP"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 2.8 Updated Dashboard

**`src/app/page.tsx`** - Add the "+" button:

```typescript
// Add to imports
import { AddMcpModal } from "@/components/AddMcpModal";

// Add state
const [showAddModal, setShowAddModal] = useState(false);

// Add after the grid
<button
  onClick={() => setShowAddModal(true)}
  className="border-2 border-dashed border-gray-700 rounded-xl p-8 flex flex-col items-center justify-center hover:border-gray-500 transition-colors"
>
  <span className="text-3xl text-gray-500">+</span>
  <span className="text-sm text-gray-500 mt-2">Add MCP Server</span>
</button>

<AddMcpModal
  open={showAddModal}
  onClose={() => setShowAddModal(false)}
  onAdded={(slug) => {
    // Refresh the list
    window.location.reload();
  }}
/>
```

---

## Part 3: Migration Path

### Phase 1: Add Remote Support (Non-Breaking)
1. Add `github-releases.ts` for fetching
2. Update types to support both local and remote
3. Update deploy route to handle remote bundles
4. Keep existing builtin MCPs working with local bundles

### Phase 2: Migrate Builtins to Remote
1. Add `mcp-deploy.json` to paper-search-mcp-remote
2. Add GitHub Actions workflow
3. Create a release with bundle + metadata
4. Update BUILTIN_MCPS to use `source: "github"`
5. Remove local bundle from workers/

### Phase 3: Add User MCPs
1. Add KV storage for user MCPs
2. Add `/api/mcps/add` and `/api/mcps/remove` routes
3. Add AddMcpModal component
4. Update dashboard with "+" button

### Phase 4: Cleanup
1. Remove `scripts/bundle-workers.ts`
2. Remove `workers/.shims/`
3. Remove `workers/*.mjs` files
4. Update documentation

---

## Part 4: Benefits

| Before | After |
|--------|-------|
| mcp-deploy bundles everything | Each MCP bundles itself |
| Shims needed for Node.js compat | Wrangler handles compat |
| 70k+ line bundles in git | Bundles fetched at deploy |
| Hardcoded MCP list | Dynamic + user-addable |
| Must edit mcp-deploy to add MCP | Just paste GitHub URL |

## Part 5: Considerations

### Rate Limiting
- GitHub API has rate limits (60 req/hour unauthenticated)
- Consider caching metadata in KV
- Consider adding `GITHUB_TOKEN` for higher limits

### Versioning
- Default to "latest" but allow pinning to specific tags
- Show available versions in UI
- Support updating to newer versions

### Security
- Only fetch from GitHub (trusted source)
- Validate mcp-deploy.json schema
- Could add allowlist for repos if needed

### Wizard Customization
- Test specs are declarative in the schema (no code in mcp-deploy)
- Tests can reference other fields via `{{FIELD_KEY}}` syntax
- Unknown test specs gracefully degrade (no test button shown)

---

## Part 6: Schema-Driven API Testing

### Design Principles

1. **Tests validate external APIs, not the MCP** - The wizard helps users configure their API keys correctly before deploy
2. **Tests are declarative** - Defined in `mcp-deploy.json`, not hardcoded in mcp-deploy
3. **Tests can reference other fields** - Use `{{FIELD_KEY}}` to substitute values from earlier form fields
4. **Tests are optional** - If no `test` field, no test button shown (graceful degradation)

### Updated SecretField Schema

```typescript
export interface TestSpec {
  url: string;                    // URL to test, can include {{FIELD_KEY}} placeholders
  method: "GET" | "POST";         // HTTP method
  headers?: Record<string, string>; // Headers, can include {{value}} for current field
  body?: string;                  // Optional body for POST requests
  success: number[];              // HTTP status codes that indicate success
  errors?: Record<number, string>; // Custom error messages by status code
}

export interface SecretField {
  key: string;
  label: string;
  required: boolean;
  type?: "text" | "password" | "email";
  placeholder?: string;
  helpText?: string;
  helpUrl?: string;
  forPlatform?: string;
  test?: TestSpec;  // Replaces testConnection string
}
```

### Example: Paper Search MCP

```json
{
  "secrets": [
    {
      "key": "SEMANTIC_SCHOLAR_API_KEY",
      "label": "Semantic Scholar API Key",
      "required": false,
      "type": "password",
      "helpText": "Higher rate limits.",
      "helpUrl": "https://www.semanticscholar.org/product/api#api-key",
      "forPlatform": "semantic_scholar",
      "test": {
        "url": "https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1",
        "method": "GET",
        "headers": {
          "x-api-key": "{{value}}"
        },
        "success": [200],
        "errors": {
          "401": "Invalid API key",
          "403": "Invalid API key"
        }
      }
    },
    {
      "key": "PUBMED_API_KEY",
      "label": "PubMed API Key",
      "required": false,
      "type": "password",
      "helpText": "10 req/s vs 3 without.",
      "helpUrl": "https://ncbiinsights.ncbi.nlm.nih.gov/2017/11/02/new-api-keys-for-the-e-utilities/",
      "forPlatform": "pubmed",
      "test": {
        "url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=test&retmax=1&api_key={{value}}&retmode=json",
        "method": "GET",
        "success": [200],
        "errors": {
          "400": "Invalid API key format",
          "401": "Invalid API key"
        }
      }
    },
    {
      "key": "CONTACT_EMAIL",
      "label": "Contact Email",
      "required": false,
      "type": "email",
      "helpText": "For CrossRef polite pool (faster responses).",
      "forPlatform": "crossref"
    }
  ]
}
```

### Example: Zotero MCP (Multi-Field Dependency)

Library ID comes first, API key second. The test on API key validates both together.

```json
{
  "secrets": [
    {
      "key": "ZOTERO_LIBRARY_ID",
      "label": "Zotero Library ID",
      "required": true,
      "type": "text",
      "helpText": "Your numeric user ID (shown on the API keys page).",
      "helpUrl": "https://www.zotero.org/settings/keys"
    },
    {
      "key": "ZOTERO_API_KEY",
      "label": "Zotero API Key",
      "required": true,
      "type": "password",
      "helpText": "Create at zotero.org/settings/keys with read/write access.",
      "helpUrl": "https://www.zotero.org/settings/keys",
      "test": {
        "url": "https://api.zotero.org/users/{{ZOTERO_LIBRARY_ID}}/collections?limit=1",
        "method": "GET",
        "headers": {
          "Zotero-API-Key": "{{value}}"
        },
        "success": [200],
        "errors": {
          "401": "Invalid API key",
          "403": "API key doesn't have access to this library",
          "404": "Library not found - check your library ID"
        }
      }
    }
  ]
}
```

### Generic Test Runner

**New file: `src/lib/test-runner.ts`**

```typescript
import { TestSpec } from "./types";

interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Run a test spec against an external API.
 *
 * @param spec - The test specification from mcp-deploy.json
 * @param value - The current field's value (substituted for {{value}})
 * @param allValues - All form values (for {{FIELD_KEY}} substitution)
 */
export async function runTest(
  spec: TestSpec,
  value: string,
  allValues: Record<string, string>
): Promise<TestResult> {
  try {
    // Substitute placeholders in URL
    let url = spec.url.replace("{{value}}", encodeURIComponent(value));
    for (const [key, val] of Object.entries(allValues)) {
      url = url.replace(`{{${key}}}`, encodeURIComponent(val));
    }

    // Substitute placeholders in headers
    const headers: Record<string, string> = {};
    if (spec.headers) {
      for (const [headerKey, headerVal] of Object.entries(spec.headers)) {
        let substituted = headerVal.replace("{{value}}", value);
        for (const [key, val] of Object.entries(allValues)) {
          substituted = substituted.replace(`{{${key}}}`, val);
        }
        headers[headerKey] = substituted;
      }
    }

    // Make the request
    const response = await fetch(url, {
      method: spec.method,
      headers,
      body: spec.body,
    });

    // Check for success
    if (spec.success.includes(response.status)) {
      return { success: true, message: "Connection successful" };
    }

    // Check for known error
    const errorMessage = spec.errors?.[response.status];
    if (errorMessage) {
      return { success: false, error: errorMessage };
    }

    // Unknown error
    return { success: false, error: `API returned status ${response.status}` };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed"
    };
  }
}
```

### Updated Test API Route

**`src/app/api/test-connection/route.ts`** - Now generic:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { runTest } from "@/lib/test-runner";
import { TestSpec } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const { spec, value, allValues } = await request.json();

    if (!spec || !value) {
      return NextResponse.json(
        { success: false, error: "Missing spec or value" },
        { status: 400 }
      );
    }

    const result = await runTest(spec as TestSpec, value, allValues ?? {});
    return NextResponse.json(result);
  } catch (error) {
    console.error("Test connection error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to test connection" },
      { status: 500 }
    );
  }
}
```

### Updated SecretForm Component

The form now reads `test` from the field schema and calls the generic endpoint:

```typescript
// In SecretForm.tsx

const testConnection = async (field: SecretField, value: string) => {
  if (!field.test) return;

  setTestingField(field.key);

  try {
    const res = await fetch("/api/test-connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spec: field.test,
        value,
        allValues: formValues,  // All current form values for {{FIELD_KEY}} substitution
      }),
    });

    const result = await res.json();
    setTestResults(prev => ({ ...prev, [field.key]: result }));
  } catch {
    setTestResults(prev => ({
      ...prev,
      [field.key]: { success: false, error: "Test failed" }
    }));
  } finally {
    setTestingField(null);
  }
};

// Only show test button if field has a test spec
{field.test && (
  <button onClick={() => testConnection(field, value)}>
    Test
  </button>
)}
```

### Migration from Old Format

The old `testConnection: "semantic_scholar"` format is replaced by the full `test` object. During migration:

1. Update `mcp-deploy.json` in each MCP repo with the new `test` format
2. Remove the hardcoded switch statement in `src/app/api/test-connection/route.ts`
3. Update SecretForm to use the new schema

### Benefits

| Before | After |
|--------|-------|
| Hardcoded test functions per service | Declarative test specs in schema |
| Must modify mcp-deploy for new services | MCP authors define their own tests |
| Complex multi-field logic in code | `{{FIELD_KEY}}` substitution handles dependencies |
| All-or-nothing (test works or doesn't exist) | Graceful degradation (no test = no button) |
