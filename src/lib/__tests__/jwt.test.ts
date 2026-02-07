import { describe, it, expect } from "vitest";
import { signJWT, verifyJWT, generateJWTSecret, generateTokenId } from "../oauth/jwt";
import type { AccessTokenClaims } from "../oauth/types";

const TEST_SECRET = "test-secret-key-for-jwt-signing";

function makeClaims(overrides?: Partial<AccessTokenClaims>): AccessTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "http://localhost:3000",
    sub: "mcp-user",
    aud: "https://my-worker.workers.dev",
    scope: "mcp",
    iat: now,
    exp: now + 3600,
    jti: "test-token-id",
    ...overrides,
  };
}

describe("signJWT", () => {
  it("should produce a three-part token", () => {
    const token = signJWT(makeClaims(), TEST_SECRET);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
  });

  it("should encode claims in the payload", () => {
    const claims = makeClaims({ sub: "custom-subject" });
    const token = signJWT(claims, TEST_SECRET);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    );
    expect(payload.sub).toBe("custom-subject");
    expect(payload.iss).toBe("http://localhost:3000");
  });

  it("should produce different signatures for different secrets", () => {
    const claims = makeClaims();
    const token1 = signJWT(claims, "secret-one");
    const token2 = signJWT(claims, "secret-two");
    expect(token1.split(".")[2]).not.toBe(token2.split(".")[2]);
  });
});

describe("verifyJWT", () => {
  it("should verify a valid token", () => {
    const claims = makeClaims();
    const token = signJWT(claims, TEST_SECRET);
    const result = verifyJWT(token, TEST_SECRET);
    expect(result).not.toBeNull();
    expect(result!.sub).toBe("mcp-user");
    expect(result!.aud).toBe("https://my-worker.workers.dev");
  });

  it("should reject token with wrong secret", () => {
    const token = signJWT(makeClaims(), TEST_SECRET);
    const result = verifyJWT(token, "wrong-secret");
    expect(result).toBeNull();
  });

  it("should reject expired token", () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = makeClaims({ exp: now - 100 });
    const token = signJWT(claims, TEST_SECRET);
    const result = verifyJWT(token, TEST_SECRET);
    expect(result).toBeNull();
  });

  it("should accept token without exp field", () => {
    const claims = makeClaims();
    delete (claims as any).exp;
    const token = signJWT(claims, TEST_SECRET);
    const result = verifyJWT(token, TEST_SECRET);
    expect(result).not.toBeNull();
  });

  it("should reject malformed token (not 3 parts)", () => {
    expect(verifyJWT("invalid", TEST_SECRET)).toBeNull();
    expect(verifyJWT("a.b", TEST_SECRET)).toBeNull();
    expect(verifyJWT("a.b.c.d", TEST_SECRET)).toBeNull();
  });

  it("should reject tampered payload", () => {
    const token = signJWT(makeClaims(), TEST_SECRET);
    const parts = token.split(".");
    // Tamper with the payload
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    payload.sub = "hacker";
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const tampered = parts.join(".");
    expect(verifyJWT(tampered, TEST_SECRET)).toBeNull();
  });
});

describe("generateJWTSecret", () => {
  it("should return a 128-character hex string", () => {
    const secret = generateJWTSecret();
    expect(secret).toMatch(/^[0-9a-f]{128}$/);
  });

  it("should produce unique values", () => {
    const a = generateJWTSecret();
    const b = generateJWTSecret();
    expect(a).not.toBe(b);
  });
});

describe("generateTokenId", () => {
  it("should return a 32-character hex string", () => {
    const id = generateTokenId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("should produce unique values", () => {
    const a = generateTokenId();
    const b = generateTokenId();
    expect(a).not.toBe(b);
  });
});
