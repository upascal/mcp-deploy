/**
 * Minimal JWT implementation using Node.js crypto (no external deps).
 * Uses HMAC-SHA256 (HS256) for signing.
 */

import { createHmac, randomBytes } from "crypto";
import type { AccessTokenClaims } from "./types";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

/**
 * Sign a JWT with HMAC-SHA256.
 */
export function signJWT(payload: AccessTokenClaims, secret: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode a JWT signed with HMAC-SHA256.
 * Returns the payload if valid, null otherwise.
 */
export function verifyJWT(
  token: string,
  secret: string
): AccessTokenClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;

    // Verify signature
    const expected = createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest("base64url");

    if (signature !== expected) return null;

    // Decode payload
    const payload: AccessTokenClaims = JSON.parse(
      Buffer.from(body, "base64url").toString()
    );

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate a cryptographically random secret for JWT signing.
 */
export function generateJWTSecret(): string {
  return randomBytes(64).toString("hex");
}

/**
 * Generate a unique token ID.
 */
export function generateTokenId(): string {
  return randomBytes(16).toString("hex");
}
