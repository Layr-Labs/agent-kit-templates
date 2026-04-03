import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBRouter } from "./router.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TEST_DATA_DIR } from "../test/setup.js";
import { randomBytes } from "node:crypto";

function randomHexKey(): string {
  return randomBytes(32).toString("hex");
}

function randomAddress(): string {
  return "0xRouterTest" + randomBytes(4).toString("hex");
}

describe("DBRouter", () => {
  let router: DBRouter;
  let addresses: string[] = [];

  beforeEach(() => {
    router = new DBRouter({ skipEncryption: true });
    addresses = [];
  });

  afterEach(() => {
    for (const addr of addresses) {
      try {
        router.deleteUser(addr);
      } catch {}
    }
  });

  function trackAddress(addr: string) {
    addresses.push(addr);
    return addr;
  }

  it("creates a new encrypted database file on first connection", async () => {
    const addr = trackAddress(randomAddress());
    const key = randomHexKey();
    const db = await router.getConnection(addr, key);
    expect(db).toBeDefined();

    const dbPath = join(TEST_DATA_DIR, `${addr.toLowerCase()}.db`);
    expect(existsSync(dbPath)).toBe(true);
  });

  it("lowercases the address for the filename", async () => {
    const addr = trackAddress("0xABCDEF" + randomBytes(2).toString("hex"));
    const key = randomHexKey();
    await router.getConnection(addr, key);

    const dbPath = join(TEST_DATA_DIR, `${addr.toLowerCase()}.db`);
    expect(existsSync(dbPath)).toBe(true);
  });

  it("returns the same connection for the same address", async () => {
    const addr = trackAddress(randomAddress());
    const key = randomHexKey();
    const db1 = await router.getConnection(addr, key);
    const db2 = await router.getConnection(addr, key);
    expect(db1).toBe(db2);
  });

  it("returns different connections for different addresses", async () => {
    const addr1 = trackAddress(randomAddress());
    const addr2 = trackAddress(randomAddress());
    const db1 = await router.getConnection(addr1, randomHexKey());
    const db2 = await router.getConnection(addr2, randomHexKey());
    expect(db1).not.toBe(db2);
  });

  it("initializes schema on new database", async () => {
    const addr = trackAddress(randomAddress());
    const db = await router.getConnection(addr, randomHexKey());

    const tables = (await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()) as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("conversations");
    expect(tableNames).toContain("embeddings");
    expect(tableNames).toContain("memories");
  });

  it("closeConnection removes from cache but keeps file", async () => {
    const addr = trackAddress(randomAddress());
    const key = randomHexKey();
    await router.getConnection(addr, key);
    const dbPath = join(TEST_DATA_DIR, `${addr.toLowerCase()}.db`);

    router.closeConnection(addr);
    expect(existsSync(dbPath)).toBe(true);

    const db2 = await router.getConnection(addr, key);
    expect(db2).toBeDefined();
  });

  it("deleteUser removes file and cache", async () => {
    const addr = randomAddress(); // don't track — will be deleted
    const key = randomHexKey();
    await router.getConnection(addr, key);
    const dbPath = join(TEST_DATA_DIR, `${addr.toLowerCase()}.db`);

    router.deleteUser(addr);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("handles deleteUser for nonexistent user without error", () => {
    expect(() => router.deleteUser("0xNonExistent")).not.toThrow();
  });

  it("memories table supports upsert", async () => {
    const addr = trackAddress(randomAddress());
    const db = await router.getConnection(addr, randomHexKey());

    await db
      .prepare("INSERT INTO memories (key, value) VALUES (?, ?)")
      .run("name", "Alice");

    await db
      .prepare(
        `INSERT INTO memories (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE
         SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run("name", "Bob");

    const rows = (await db
      .prepare("SELECT value FROM memories WHERE key = ?")
      .all("name")) as Array<{ value: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("Bob");
  });

  it("conversations table enforces role constraint", async () => {
    const addr = trackAddress(randomAddress());
    const db = await router.getConnection(addr, randomHexKey());

    // Valid roles should work
    await db
      .prepare(
        "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
      )
      .run("sess1", "user", "hello");

    await db
      .prepare(
        "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
      )
      .run("sess1", "assistant", "hi there");

    // Invalid role should fail
    await expect(
      db
        .prepare(
          "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
        )
        .run("sess1", "invalid_role", "nope")
    ).rejects.toThrow();
  });
});
