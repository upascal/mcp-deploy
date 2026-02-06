# MCP Deploy

A Next.js dashboard for deploying and managing MCP (Model Context Protocol) servers on Cloudflare Workers.

## What it does

1. Add MCP servers from GitHub releases
2. Configure secrets (API keys, library IDs, etc.)
3. Deploy to Cloudflare Workers with one click
4. Get connection URLs with embedded bearer tokens
5. Update secrets without redeploying
6. Monitor health of deployed workers

## Managed MCPs

- **Paper Search MCP** — Search academic papers across Semantic Scholar, CrossRef, arXiv, PubMed, bioRxiv, medRxiv
- **Zotero Assistant MCP** — Manage your Zotero library with 20+ tools

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- A [Cloudflare](https://cloudflare.com) account (free tier works)

### Setup

```bash
# Clone the repo
git clone https://github.com/upascal/mcp-deploy.git
cd mcp-deploy

# Install dependencies
npm install

# Log in to Cloudflare (opens browser)
npx wrangler login

# Start the web interface
npm run dev
# OR use the CLI
node bin/mcp-deploy.js -gui
```

Open [http://localhost:3000](http://localhost:3000):

1. **Add an MCP** -- Paste a GitHub repo URL (must have releases with `mcp-deploy.json` + `worker.mjs`)
2. **Configure** -- Enter any required secrets (API keys, tokens)
3. **Deploy** -- Click Deploy. You'll get back:
   - **MCP URL** (e.g., `https://your-mcp.yoursubdomain.workers.dev/mcp`)
   - **Bearer Token** (for authentication)
   - **MCP URL with Token** (ready to paste into Claude Desktop)

## Connecting to Claude Desktop

1. Deploy an MCP using the web interface
2. Copy the **MCP URL with Token** from the deployment response
3. In Claude Desktop: **Settings > Connectors > Add custom connector**
4. Paste the URL (e.g., `https://your-mcp.workers.dev/mcp/t/{token}`)
5. Click **Connect** -- done!

No OAuth flow needed with bearer token authentication. The token is embedded in the URL.

## CLI Usage

```bash
# Start the web interface
mcp-deploy -gui

# Show help
mcp-deploy --help
```

After installing globally (`npm install -g .`), you can run `mcp-deploy -gui` from anywhere to start the web interface.

**Future CLI commands** (coming soon):
```bash
mcp-deploy deploy <github-url>    # Deploy an MCP from GitHub
mcp-deploy list                    # List deployed MCPs
mcp-deploy status <slug>           # Check MCP status
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  MCP-Deploy Dashboard (Next.js)                         │
│  - React frontend with Tailwind CSS                     │
│  - API routes for deployment orchestration              │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Pre-bundled Workers (committed to repo)                │
│  - workers/paper-search-mcp.mjs                         │
│  - workers/zotero-assistant-mcp.mjs                     │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Workers (deployed via REST API)             │
│  - Each MCP runs as a Durable Object                    │
│  - Secrets stored securely on Cloudflare                │
└─────────────────────────────────────────────────────────┘
```

### Build vs Deploy (Decoupled)

**Build time** (developer machine):
```bash
npm run bundle
```
- Reads TypeScript source from external MCP repos (sibling directories)
- Bundles with esbuild into single `.mjs` files
- Output committed to `workers/` directory

**Deploy time** (user action via dashboard):
- Reads pre-bundled `.mjs` from disk
- Uploads to Cloudflare via REST API
- Sets secrets (API keys, bearer token)
- **No external repo access needed** — fast and reliable

### Deployment Flow

```
User clicks Deploy
    ↓
Load MCP from registry → Get bundlePath
    ↓
Read bundled .mjs file from disk
    ↓
Upload to Cloudflare Workers API
    ↓
Set secrets (API keys, config, bearer token)
    ↓
Store deployment record in Vercel KV
    ↓
Return Claude Desktop config snippet
```

### Tech Stack

- **Frontend:** Next.js 15 App Router + Tailwind CSS
- **Backend:** Next.js API routes
- **Storage:** Vercel KV (Redis) for deployment records + encrypted secrets
- **Deployment:** Cloudflare REST API via `cloudflare` npm SDK
- **Bundling:** esbuild pre-bundles MCP worker scripts from sibling repos
- **Security:** AES-256-GCM encryption for secrets at rest

## Project Structure

```
src/
  app/                    # Pages + API routes
  components/             # React components
  lib/
    mcp-registry.ts       # Registry of managed MCPs
    cloudflare-deploy.ts  # Cloudflare API wrapper
    encryption.ts         # AES-256-GCM for secrets at rest
    kv.ts                 # Vercel KV helpers

scripts/
  bundle-workers.ts       # esbuild bundler for MCP workers

workers/                  # Pre-bundled worker scripts (committed)
```

## Adding a New MCP

1. **Bundle the worker** — Add entry to `scripts/bundle-workers.ts`:
   ```typescript
   { name: "my-mcp", entry: "../path/to/my-mcp/src/index.ts" }
   ```
   Then run: `npm run bundle`

2. **Add to registry** — In `src/lib/mcp-registry.ts`:
   ```typescript
   {
     slug: "my-mcp",
     name: "My MCP",
     workerName: "my-mcp",
     durableObjectClassName: "MyMCP",
     bundlePath: "workers/my-mcp.mjs",
     secrets: [...],
     config: [...],
   }
   ```

3. **Add test connection** (optional) — In `src/app/api/test-connection/route.ts`

## External Dependencies

The bundled workers come from these repos (**build-time only**):

| MCP | Source Repo |
|-----|-------------|
| Paper Search | `paper-search-mcp-remote` |
| Zotero Assistant | `zotero-assistant-mcp-remote` |

These repos are **not required at deploy time** — their code is pre-bundled into `.mjs` files.

## Roadmap

- [x] V1: Dashboard for managing 2 existing MCPs
- [ ] Add more MCPs as they're built
- [ ] Auto-analyze arbitrary MCP repos for Cloudflare compatibility
- [ ] AI-powered secret discovery from source code + README
- [ ] MCP-deploy-MCP (an MCP that helps deploy MCPs)
- [ ] Stats on deployed MCPs
