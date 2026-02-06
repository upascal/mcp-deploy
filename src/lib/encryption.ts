/**
 * AES-256-GCM encryption for storing sensitive values (bearer tokens, JWT secrets)
 * at rest in SQLite.
 *
 * On first run, auto-generates a random encryption key and persists it in .env.local.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT = "mcp-deploy-salt"; // static salt is fine — key is already high-entropy

const ENV_LOCAL_PATH = join(process.cwd(), ".env.local");

/**
 * Ensure ENCRYPTION_KEY exists in .env.local.
 * If not, generate a random 32-byte hex key and write it.
 */
function ensureEncryptionKey(): string {
  // Check env var first (may already be loaded by Next.js)
  if (process.env.ENCRYPTION_KEY) {
    return process.env.ENCRYPTION_KEY;
  }

  // Check .env.local file directly
  if (existsSync(ENV_LOCAL_PATH)) {
    const content = readFileSync(ENV_LOCAL_PATH, "utf-8");
    const match = content.match(/^ENCRYPTION_KEY=(.+)$/m);
    if (match) {
      const key = match[1].trim();
      process.env.ENCRYPTION_KEY = key;
      return key;
    }
  }

  // Generate a new key
  const newKey = randomBytes(32).toString("hex");

  if (existsSync(ENV_LOCAL_PATH)) {
    appendFileSync(ENV_LOCAL_PATH, `\nENCRYPTION_KEY=${newKey}\n`);
  } else {
    writeFileSync(ENV_LOCAL_PATH, `ENCRYPTION_KEY=${newKey}\n`);
  }

  process.env.ENCRYPTION_KEY = newKey;
  console.log(
    "[mcp-deploy] Generated encryption key in .env.local"
  );
  return newKey;
}

function getKey(): Buffer {
  const secret = ensureEncryptionKey();
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
