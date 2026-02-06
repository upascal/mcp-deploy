/**
 * Simple encryption/decryption for storing sensitive values (bearer tokens, etc.)
 * at rest in the local JSON store.
 *
 * Uses AES-256-GCM with a key derived from the ENCRYPTION_KEY env var
 * (falls back to a machine-local default so dev works out of the box).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = "mcp-deploy-salt"; // static salt is fine — key is already high-entropy

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY ?? "mcp-deploy-local-dev-key";
  return scryptSync(secret, SALT, 32);
}

/**
 * Encrypt a plaintext string. Returns a hex-encoded string of iv:authTag:ciphertext.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a string produced by `encrypt()`.
 */
export function decrypt(encryptedText: string): string {
  const key = getKey();
  const parts = encryptedText.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format");
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
