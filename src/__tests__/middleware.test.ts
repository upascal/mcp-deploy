import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "../middleware";

function request(
  url: string,
  { method = "GET", origin, host }: { method?: string; origin?: string; host?: string } = {}
): NextRequest {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  headers.set("host", host ?? new URL(url).host);
  return new NextRequest(new Request(url, { method, headers }));
}

const URL_LOCAL = "http://localhost:3838/api/mcps/add";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("middleware — CSRF (Origin)", () => {
  it("blocks the cross-origin POST that a malicious page would send", () => {
    // request.json() ignores Content-Type, so a text/plain "simple request"
    // carries a full JSON payload and is never preflighted.
    const res = middleware(
      request(URL_LOCAL, { method: "POST", origin: "https://evil.example" })
    );

    expect(res.status).toBe(403);
  });

  it("allows the dashboard's own POST", () => {
    const res = middleware(
      request(URL_LOCAL, { method: "POST", origin: "http://localhost:3838" })
    );

    expect(res.status).toBe(200);
  });

  it("allows a 127.0.0.1 origin", () => {
    const res = middleware(
      request(URL_LOCAL, { method: "POST", origin: "http://127.0.0.1:3838" })
    );

    expect(res.status).toBe(200);
  });

  it("allows requests with no Origin, so curl and scripts still work", () => {
    // Browsers always send Origin on cross-origin state-changing requests,
    // so an absent Origin is not a CSRF vector.
    expect(middleware(request(URL_LOCAL, { method: "POST" })).status).toBe(200);
  });

  it.each(["PUT", "PATCH", "DELETE"])(
    "blocks cross-origin %s as well",
    (method) => {
      const res = middleware(
        request(URL_LOCAL, { method, origin: "https://evil.example" })
      );
      expect(res.status).toBe(403);
    }
  );

  it("does not block a cross-origin GET on Origin alone", () => {
    // GET is not state-changing; the Host check is what guards reads.
    const res = middleware(request(URL_LOCAL, { origin: "https://evil.example" }));
    expect(res.status).toBe(200);
  });

  it("rejects an unparseable Origin rather than trusting it", () => {
    const res = middleware(
      request(URL_LOCAL, { method: "POST", origin: "not-a-url" })
    );
    expect(res.status).toBe(403);
  });
});

describe("middleware — DNS rebinding (Host)", () => {
  it("blocks a rebound Host header", () => {
    const res = middleware(request(URL_LOCAL, { host: "evil.example" }));
    expect(res.status).toBe(403);
  });

  it("blocks a LAN Host by default", () => {
    const res = middleware(request(URL_LOCAL, { host: "192.168.1.50:3838" }));
    expect(res.status).toBe(403);
  });

  it.each(["localhost:3838", "127.0.0.1:3838", "[::1]:3838"])(
    "allows loopback host %s",
    (host) => {
      expect(middleware(request(URL_LOCAL, { host })).status).toBe(200);
    }
  );

  it("allows a LAN Host when the user opted in with -H", () => {
    vi.stubEnv("MCP_DEPLOY_ALLOW_ANY_HOST", "1");

    const res = middleware(request(URL_LOCAL, { host: "192.168.1.50:3838" }));

    expect(res.status).toBe(200);
  });

  it("still blocks cross-origin POSTs even when any host is allowed", () => {
    // Opting into network exposure must not also disable CSRF protection.
    vi.stubEnv("MCP_DEPLOY_ALLOW_ANY_HOST", "1");

    const res = middleware(
      request(URL_LOCAL, {
        method: "POST",
        host: "192.168.1.50:3838",
        origin: "https://evil.example",
      })
    );

    expect(res.status).toBe(403);
  });
});
