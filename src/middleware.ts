/**
 * Protects the local dashboard from the browser.
 *
 * The dashboard has no login, by design — it is a single-user tool on your own
 * machine. That makes it reachable by any web page you happen to visit, since
 * localhost is reachable from your browser. Two defences:
 *
 * 1. Origin check (CSRF). `request.json()` parses a body regardless of
 *    Content-Type, so a cross-origin `fetch` sent as a CORS "simple request"
 *    (text/plain) carries a full JSON payload and is never preflighted. That
 *    would let a malicious page add an MCP from a repo it controls and deploy
 *    it into your Cloudflare account.
 *
 * 2. Host check (DNS rebinding). An attacker domain that re-resolves to
 *    127.0.0.1 becomes same-origin with the dashboard, defeating the Origin
 *    check and letting the page read responses — including secrets.
 *
 * Requests with no Origin at all are allowed: browsers always send it on
 * cross-origin state-changing requests, so an absent Origin means a non-browser
 * client such as curl, which is not a CSRF vector.
 */

import { NextResponse, type NextRequest } from "next/server";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/** "[::1]:3000" -> "::1", "localhost:3838" -> "localhost" */
function hostnameOf(hostHeader: string): string {
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]");
    return end === -1 ? hostHeader : hostHeader.slice(1, end);
  }
  return hostHeader.split(":")[0];
}

function originHostname(origin: string): string | null {
  try {
    return new URL(origin).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

function forbidden(reason: string): NextResponse {
  return NextResponse.json({ error: `Forbidden: ${reason}` }, { status: 403 });
}

export function middleware(request: NextRequest): NextResponse {
  // Set by `mcp-deploy gui -H <addr>` when the user deliberately exposes the
  // dashboard on a non-loopback interface.
  const allowAnyHost = process.env.MCP_DEPLOY_ALLOW_ANY_HOST === "1";

  if (!allowAnyHost) {
    const host = request.headers.get("host");
    if (!host || !LOOPBACK.has(hostnameOf(host))) {
      return forbidden("unexpected Host header");
    }
  }

  if (STATE_CHANGING.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      const hostname = originHostname(origin);
      if (!hostname || !LOOPBACK.has(hostname)) {
        return forbidden("cross-origin request");
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
