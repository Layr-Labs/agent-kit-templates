import { describe, it, expect, beforeEach } from "vitest";
import { KeyVault } from "./keyvault.js";

describe("KeyVault", () => {
  let vault: KeyVault;

  beforeEach(() => {
    vault = new KeyVault();
  });

  const entry = {
    encKey: "abc123",
    integrationCredentials: { gmail: { access_token: "tok" } },
    delegatedAt: Date.now(),
  };

  it("stores and retrieves entries", () => {
    vault.store("0xABCD", entry);
    expect(vault.get("0xabcd")).toEqual(entry);
  });

  it("lowercases addresses", () => {
    vault.store("0xABCD", entry);
    expect(vault.has("0xabcd")).toBe(true);
    expect(vault.has("0xABCD")).toBe(true);
  });

  it("returns undefined for unknown addresses", () => {
    expect(vault.get("0xUnknown")).toBeUndefined();
  });

  it("has() returns false for unknown addresses", () => {
    expect(vault.has("0xUnknown")).toBe(false);
  });

  it("delete removes the entry", () => {
    vault.store("0xABCD", entry);
    expect(vault.delete("0xabcd")).toBe(true);
    expect(vault.has("0xabcd")).toBe(false);
  });

  it("delete returns false for unknown addresses", () => {
    expect(vault.delete("0xUnknown")).toBe(false);
  });

  it("overwrites existing entries", () => {
    vault.store("0xABCD", entry);
    const updated = { ...entry, encKey: "new-key" };
    vault.store("0xABCD", updated);
    expect(vault.get("0xabcd")!.encKey).toBe("new-key");
  });

  it("lists delegated addresses", () => {
    vault.store("0xAAA", entry);
    vault.store("0xBBB", entry);
    const addresses = vault.listDelegatedAddresses();
    expect(addresses).toContain("0xaaa");
    expect(addresses).toContain("0xbbb");
  });

  it("tracks size", () => {
    expect(vault.size).toBe(0);
    vault.store("0xAAA", entry);
    expect(vault.size).toBe(1);
    vault.store("0xBBB", entry);
    expect(vault.size).toBe(2);
    vault.delete("0xAAA");
    expect(vault.size).toBe(1);
  });

  it("clear removes all entries", () => {
    vault.store("0xAAA", entry);
    vault.store("0xBBB", entry);
    vault.clear();
    expect(vault.size).toBe(0);
  });
});
