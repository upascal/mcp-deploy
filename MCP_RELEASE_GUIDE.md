# MCP Release Guide

This guide explains how to set up your MCPs (Model Context Protocols) for use with mcp-deploy.

## What was configured

### mcp-deploy.json Files
Both MCP projects now have `mcp-deploy.json` files at their root:

1. **zotero-assistant-mcp-remote/mcp-deploy.json**
   - Defines: name, description, secrets, configuration
   - Secrets: ZOTERO_API_KEY, ZOTERO_LIBRARY_ID, BEARER_TOKEN
   - Config: (none)

2. **paper-search-mcp-remote/mcp-deploy.json**
   - Defines: name, description, secrets, configuration
   - Secrets: BEARER_TOKEN, SEMANTIC_SCHOLAR_API_KEY, PUBMED_API_KEY, CONTACT_EMAIL
   - Config: ENABLED_PLATFORMS (to choose which paper search platforms to enable)

### Build Scripts
Both projects have new npm scripts to build the worker bundle:

```bash
npm run build          # Builds worker to dist/worker.mjs
npm run release        # Builds and copies worker.mjs + mcp-deploy.json to root
```

### DEFAULT_MCPS
The mcp-deploy app now seeds the zotero-assistant MCP by default:
- `upascal/zotero-assistant-mcp-remote`

Paper Search is NOT in DEFAULT_MCPS because it's not yet on GitHub. Add it manually once it's published.

## How to Create GitHub Releases

Both projects now have GitHub Actions workflows that automatically build and upload assets to releases.

### Step 1: Push Code to GitHub (if not already)
```bash
cd zotero-assistant-mcp-remote
git push origin main
```

### Step 2: Create a Git Tag
GitHub Actions will automatically trigger when you push a tag starting with `v`:

```bash
git tag v0.3.0
git push origin v0.3.0
```

### Step 3: GitHub Actions Does the Rest
When the tag is pushed:
1. ✅ Installs dependencies
2. ✅ Builds the worker (`npm run build`)
3. ✅ Verifies `worker.mjs` and `mcp-deploy.json` exist
4. ✅ Creates a GitHub Release with both files as assets
5. ✅ Uploads assets automatically

### Step 4: Verify It Worked
Check the release:
```bash
curl https://api.github.com/repos/upascal/zotero-assistant-mcp-remote/releases/latest
```

Look for assets with names:
- `mcp-deploy.json`
- `worker.mjs`

Or visit: https://github.com/upascal/zotero-assistant-mcp-remote/releases

## File Structure

Each release must contain:

```
Release Assets:
├── mcp-deploy.json      (metadata: name, description, secrets, config)
└── worker.mjs           (compiled Cloudflare Worker code)
```

The `mcp-deploy.json` structure:
```json
{
  "name": "Human-readable name",
  "description": "What this MCP does",
  "version": "0.1.0",
  "worker": {
    "name": "worker-name",
    "durableObjectBinding": "DO_BINDING_NAME",
    "durableObjectClassName": "ClassName",
    "compatibilityDate": "2025-04-01",
    "compatibilityFlags": [],
    "migrationTag": "v1"
  },
  "secrets": [
    {
      "key": "API_KEY",
      "label": "API Key",
      "type": "password",
      "required": true,
      "helpText": "Description",
      "helpUrl": "https://..."
    }
  ],
  "config": [
    {
      "key": "SETTING_NAME",
      "label": "User-friendly name",
      "type": "text",
      "default": "default_value",
      "helpText": "What this setting does"
    }
  ],
  "autoSecrets": []
}
```

## Deploying Paper Search

Paper Search is not yet on GitHub. To add it:

1. Create a GitHub repo: `upascal/paper-search-mcp`
2. Push the code
3. Build: `npm run release`
4. Create a release with `worker.mjs` and `mcp-deploy.json`
5. Update mcp-deploy's DEFAULT_MCPS (or add manually through UI)

## Troubleshooting

**Error: "Cannot read properties of undefined"**
- Likely missing `mcp-deploy.json` in release or incomplete metadata
- Verify all required fields are present in the JSON file

**Error: "Release missing worker.mjs"**
- The release doesn't have the `worker.mjs` file
- Run `npm run release` and upload it to the GitHub release

**API returns null/undefined secrets**
- The `mcp-deploy.json` is malformed or missing from the release
- Check GitHub API response for the release assets

**Can't fetch from GitHub**
- Check that the repo is public
- Verify the repo path matches exactly: `owner/repo`
- Test with: `curl https://api.github.com/repos/owner/repo/releases/latest`

## Next Steps

### For zotero-assistant-mcp-remote:

1. Push to GitHub (if not already):
   ```bash
   cd zotero-assistant-mcp-remote
   git push origin main
   ```

2. Create a release tag:
   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```
   GitHub Actions will automatically build and create the release.

3. Wait for the workflow to complete (check Actions tab in GitHub)

4. Test that mcp-deploy can fetch it:
   - Reload mcp-deploy UI
   - Visit zotero-assistant detail page
   - Should show all secrets and config from `mcp-deploy.json`

### For paper-search-mcp-remote:

1. **Push to GitHub first** (if not already):
   ```bash
   cd paper-search-mcp-remote
   git push origin main
   ```

2. Create a release tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. Wait for the workflow to complete

4. Once the release is ready, update mcp-deploy's DEFAULT_MCPS to include:
   ```javascript
   {
     slug: "paper-search",
     githubRepo: "upascal/paper-search-mcp-remote",
   }
   ```

## Local Testing (Optional)

You can still use the local `npm run release` script for testing without creating a GitHub release:

```bash
npm run release
# Creates worker.mjs and ensures mcp-deploy.json exists in repo root
```

But this won't create a GitHub release—it's just for local verification.
