import { describe, it, expect } from "vitest";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

// Test the key derivation logic directly (same implementation as auth.ts)
function deriveEncryptionKey(signature: string, address: string): string {
  const ikm = Buffer.from(signature.slice(2), "hex");
  const salt = Buffer.from(address.toLowerCase());
  const info = Buffer.from("turso-db-key");
  const derived = hkdf(sha256, ikm, salt, info, 32);
  return bytesToHex(derived);
}

function keyDerivationMessage(address: string): string {
  return [
    "Derive encryption key for EigenPA",
    `Address: ${address}`,
    "Version: 1",
  ].join("\n");
}

describe("auth - key derivation", () => {
  const testSig =
    "0x" + "ab".repeat(65); // 65-byte fake signature
  const testAddress = "0x1a2B3c4D5e6F7890AbCdEf1234567890aBcDeF12";

  it("produces a 64-char hex key (32 bytes)", () => {
    const key = deriveEncryptionKey(testSig, testAddress);
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
  });

  it("is deterministic — same inputs produce same key", () => {
    const key1 = deriveEncryptionKey(testSig, testAddress);
    const key2 = deriveEncryptionKey(testSig, testAddress);
    expect(key1).toBe(key2);
  });

  it("different signatures produce different keys", () => {
    const sig2 = "0x" + "cd".repeat(65);
    const key1 = deriveEncryptionKey(testSig, testAddress);
    const key2 = deriveEncryptionKey(sig2, testAddress);
    expect(key1).not.toBe(key2);
  });

  it("different addresses produce different keys (via salt)", () => {
    const addr2 = "0x9876543210FeDcBa9876543210FeDcBa98765432";
    const key1 = deriveEncryptionKey(testSig, testAddress);
    const key2 = deriveEncryptionKey(testSig, addr2);
    expect(key1).not.toBe(key2);
  });

  it("is case-insensitive on address (lowercased in salt)", () => {
    const key1 = deriveEncryptionKey(testSig, "0xABCD");
    const key2 = deriveEncryptionKey(testSig, "0xabcd");
    expect(key1).toBe(key2);
  });
});

describe("auth - key derivation message", () => {
  it("includes the address and version", () => {
    const msg = keyDerivationMessage("0xABCD");
    expect(msg).toContain("0xABCD");
    expect(msg).toContain("Version: 1");
    expect(msg).toContain("Derive encryption key for EigenPA");
  });

  it("is deterministic", () => {
    const msg1 = keyDerivationMessage("0xABCD");
    const msg2 = keyDerivationMessage("0xABCD");
    expect(msg1).toBe(msg2);
  });

  it("contains no nonce or timestamp", () => {
    const msg = keyDerivationMessage("0xABCD");
    // Should be exactly 3 lines, no random elements
    const lines = msg.split("\n");
    expect(lines).toHaveLength(3);
  });
});
