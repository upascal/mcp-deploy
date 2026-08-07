# mcp-deploy TODO

## UI
- [x] Use a more consistent visual design language throughout
- [x] Add loading state or success message to update buttons (currently too fast, looks like nothing happened)
- [x] Show a success message after OAuth password setup

- [x] Oauth password (after deploy) should show instructions for how to use it to configure OAuth in Claude Desktop
- [x] OAuth consent dialog shows success interstitial before redirecting

- [x] add a visible/invisible toggle for oauth password
- [x] ablity to rotate / change oauth password (like bearer token)

## Privacy/Security
- [x] Audit how secrets are stored/moved in transit (encrypted in SQLite, but what about Cloudflare Worker secrets?)
- [ ] Should users be able to create their own OAuth passwords?
- [x] Are OAuth passwords and bearer tokens sufficiently random?

## Integrations
- [ ] Update READMEs of paper-search-mcp and zotero-assistant-mcp with mcp-deploy deployment instructions

## Reach
- [ ] `--app` flag for PWA-like experience (manifest.json, service worker)
- [ ] Verify MCP compatibility with ChatGPT UI custom connectors and Codex MCP
- [ ] Does OpenAI connector support password-protected remote MCPs?


## premium features
- [ ] use your own domain for MCPs