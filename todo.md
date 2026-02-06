# mcp-deploy TODO

## High Priority

- [ ] Fix form validation and automatic credential testing
- [ ] Fix GitHub releases workflow
- [ ] CLI integration — add/manage MCPs and secrets from the terminal

## Features

- [ ] `--app` flag for PWA-like experience
- [ ] Speed up adding MCPs to the dashboard (reduce GitHub API round-trips?)
- [ ] CLI workflow to add configuration secrets

## OAuth (Big Spike)

> Important: OAuth is a deployment **option**, not a replacement for bearer auth.

- [ ] Research Cloudflare MCP SDK OAuth implementation (use Cloudflare docs MCP)
- [ ] Research Claude connectors OAuth requirements
- [ ] Review existing work on the OAuth branch
- [ ] Implement OAuth as an alternative auth mode during deploy

## Tests

- [ ] Improve overall test coverage
- [ ] Add tests for OAuth implementation

## Done

- [x] Migrate storage from JSON to SQLite
- [x] Auto-generate encryption key (remove hardcoded fallback)
- [x] Add tests for db, store, and encryption modules
- [x] Restore wrangler deployment pipeline
