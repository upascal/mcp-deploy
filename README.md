# MCP Deploy

A Next.js dashboard for deploying and managing MCP (Model Context Protocol) servers on Cloudflare Workers.

## What it does

1. Connect your Cloudflare account (via API token)
2. Configure your MCP servers (API keys, platform selection)
3. Deploy to Cloudflare Workers with one click
4. Get Claude Desktop/Code config snippets
5. Update secrets without redeploying
6. Monitor health of deployed workers

## Managed MCPs

- **Paper Search MCP** — Search academic papers across Semantic Scholar, CrossRef, arXiv, PubMed, bioRxiv, medRxiv
- **Zotero Assistant MCP** — Manage your Zotero library with 20+ tools

## Setup

```bash
# Install dependencies
npm install

# Bundle the MCP worker scripts from sibling repos
npm run bundle

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your ENCRYPTION_KEY and Vercel KV credentials

# Run dev server
npm run dev

# Kill the server 
kill -9 $(pgrep -f '^next-server')
```

### Environment Variables

```
ENCRYPTION_KEY=<64-char-hex-string>   # Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
KV_REST_API_URL=<vercel-kv-url>
KV_REST_API_TOKEN=<vercel-kv-token>
```

### Cloudflare API Token

Create a token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with:
- **Permissions:** Workers Scripts: Edit, Account Settings: Read
- **Account Resources:** Include your account

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
