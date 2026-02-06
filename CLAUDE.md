# mcp-deploy

## Dev Server
- The Next.js dev server hot-reloads file changes automatically (Turbopack).
- Before starting `npm run dev`, check if one is already running: `curl -s http://localhost:3000/api/cloudflare/status`
- If it responds, use the existing server. Do NOT kill it or start a new one.
- Only start a new dev server if nothing is running on port 3000.
