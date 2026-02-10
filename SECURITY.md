# Security Policy

## Supported Versions

We release security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

We take the security of mcp-deploy seriously. If you discover a security vulnerability, please report it responsibly.

**Please DO NOT open a public GitHub issue.**

Instead, report security vulnerabilities by:

1. **Email**: Send details to upascal@gmail.com
2. **Expected Response Time**: You should receive an initial response within 48 hours
3. **Disclosure Timeline**: We aim to release security patches within 7 days of verification

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Security Practices

### Data Protection

- **Encryption at Rest**: All sensitive data (bearer tokens, OAuth secrets, API keys) stored in SQLite are encrypted using AES-256-GCM
- **Encryption Key**: Auto-generated on first run and stored in `.env.local` (never committed to git)
- **Secrets Management**: Secrets are transmitted to Cloudflare Workers via encrypted channels and stored securely in Cloudflare's secret storage

### Input Validation

- All API endpoints validate input parameters (slugs, GitHub repos, secret keys/values)
- Slug parameters are restricted to alphanumeric characters, hyphens, and underscores
- Secret keys follow uppercase naming conventions (A-Z, 0-9, _)
- Request body size limits are enforced

### Authentication

mcp-deploy offers three authentication modes for deployed MCPs:

1. **Bearer Token**: Auto-generated cryptographically secure tokens
2. **OAuth**: Password-protected OAuth2 flow with encrypted client secrets
3. **Open**: No authentication (use only for public, read-only MCPs)

### Cloudflare Integration

- Uses official `wrangler` CLI for deployments (no direct API token handling)
- No sensitive data is logged to console
- Temporary files containing secrets are cleaned up after deployment

### Development Security

- Native dependencies (`better-sqlite3`) are properly sandboxed in Next.js
- Test databases use isolated temporary files
- GitHub API token is optional and only used for rate limit increases

## Known Limitations

- **Git History**: Earlier commits (before v0.1.0) may contain sample data. We recommend reviewing git history before forking
- **Local Storage**: The SQLite database (`data/mcp-deploy.db`) contains encrypted secrets but should still be excluded from backups sent to untrusted parties
- **Cloudflare Account Access**: mcp-deploy requires full Cloudflare Workers access via wrangler login

## Security Updates

Security updates will be announced via:
- GitHub Releases
- Security advisories on this repository

## Best Practices for Users

1. **Never commit `.env.local`** to version control
2. **Rotate secrets** periodically using the secrets management UI
3. **Use OAuth** for MCPs that access sensitive resources
4. **Review permissions** before deploying third-party MCP packages
5. **Keep mcp-deploy updated** to the latest version
6. **Backup your encryption key** from `.env.local` securely

## Vulnerability Disclosure History

None reported yet.

---

Last Updated: 2026-02-08
