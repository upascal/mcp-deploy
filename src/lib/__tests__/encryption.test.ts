import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("encryption", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.ENCRYPTION_KEY;
    // Set a test key so we don't write to .env.local during tests
    process.env.ENCRYPTION_KEY = "test-key-for-unit-tests-0123456789ab";
    // Clear module cache so encryption picks up the new env
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
    vi.resetModules();
  });

  it("should encrypt and decrypt a string", async () => {
    const { encrypt, decrypt } = await import("../encryption");

    const plaintext = "my-secret-bearer-token-12345";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
    expect(encrypted).not.toBe(plaintext);
  });

  it("should produce different ciphertexts for the same input (random IV)", async () => {
    const { encrypt } = await import("../encryption");

    const plaintext = "same-input-different-output";
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
  });

  it("should produce output in iv:authTag:ciphertext format", async () => {
    const { encrypt } = await import("../encryption");

    const encrypted = encrypt("test");
    const parts = encrypted.split(":");

    expect(parts).toHaveLength(3);
    // IV is 16 bytes = 32 hex chars
    expect(parts[0]).toHaveLength(32);
    // Auth tag is 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Ciphertext should be non-empty hex
    expect(parts[2].length).toBeGreaterThan(0);
    expect(/^[0-9a-f]+$/.test(parts[2])).toBe(true);
  });

  it("should throw on invalid encrypted text format", async () => {
    const { decrypt } = await import("../encryption");

    expect(() => decrypt("not-valid")).toThrow("Invalid encrypted text format");
    expect(() => decrypt("a:b")).toThrow("Invalid encrypted text format");
    expect(() => decrypt("")).toThrow("Invalid encrypted text format");
  });

  it("should fail to decrypt with wrong key", async () => {
    const { encrypt } = await import("../encryption");
    const encrypted = encrypt("secret-data");

    // Change the key
    process.env.ENCRYPTION_KEY = "different-key-abcdefghijklmnopqrst";
    vi.resetModules();

    const { decrypt } = await import("../encryption");

    expect(() => decrypt(encrypted)).toThrow();
  });

  it("should handle empty string encryption", async () => {
    const { encrypt, decrypt } = await import("../encryption");

    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe("");
  });

  it("should handle unicode strings", async () => {
    const { encrypt, decrypt } = await import("../encryption");

    const plaintext = "Hello 世界 🌍 émojis";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("should handle long strings", async () => {
    const { encrypt, decrypt } = await import("../encryption");

    const plaintext = "a".repeat(10000);
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });
});
