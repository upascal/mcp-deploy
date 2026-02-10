import { describe, it, expect } from "vitest";
import { generateOAuthWrapper } from "../worker-oauth-wrapper";

describe("generateOAuthWrapper", () => {
  const wrapper = generateOAuthWrapper("ZoteroMCP");

  it("should generate valid JavaScript", () => {
    expect(wrapper).toContain("export default");
    expect(wrapper).toContain("async fetch(request, env, ctx)");
  });

  it("should import and re-export the Durable Object class", () => {
    expect(wrapper).toContain("import OriginalWorker from './original.mjs'");
    expect(wrapper).toContain("export { ZoteroMCP } from './original.mjs'");
  });

  it("should serve OAuth Protected Resource Metadata endpoint", () => {
    expect(wrapper).toContain("/.well-known/oauth-protected-resource");
    expect(wrapper).toContain("authorization_servers");
  });

  it("should serve OAuth Authorization Server metadata endpoint", () => {
    expect(wrapper).toContain("/.well-known/oauth-authorization-server");
    expect(wrapper).toContain("authorization_endpoint");
    expect(wrapper).toContain("token_endpoint");
    expect(wrapper).toContain("registration_endpoint");
  });

  it("should include JWT verification logic", () => {
    expect(wrapper).toContain("verifyJWT");
    expect(wrapper).toContain("HMAC");
    expect(wrapper).toContain("SHA-256");
  });

  it("should check for OAUTH_JWT_SECRET env var", () => {
    expect(wrapper).toContain("env.OAUTH_JWT_SECRET");
  });

  it("should pass through to inner worker when OAuth JWT is valid", () => {
    expect(wrapper).toContain("OriginalWorker.fetch(authenticatedRequest, env, ctx)");
  });

  it("should add WWW-Authenticate header on 401/403", () => {
    expect(wrapper).toContain("WWW-Authenticate");
    expect(wrapper).toContain("resource_metadata");
  });

  it("should handle different DO class names", () => {
    const wrapper2 = generateOAuthWrapper("PaperSearchMCP");
    expect(wrapper2).toContain("export { PaperSearchMCP } from './original.mjs'");
  });

  it("should include base64url decode for Web Crypto", () => {
    expect(wrapper).toContain("base64urlDecode");
    expect(wrapper).toContain("crypto.subtle");
  });

  it("should swap in static bearer token when OAuth JWT is valid", () => {
    expect(wrapper).toContain("env.BEARER_TOKEN");
    expect(wrapper).toContain("headers.set('Authorization'");
  });
});
