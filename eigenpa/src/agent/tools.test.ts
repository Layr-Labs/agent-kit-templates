import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBRouter } from "../db/router.js";
import { makeUserTools } from "./tools.js";
import { randomBytes } from "node:crypto";

function randomHexKey(): string {
  return randomBytes(32).toString("hex");
}

function randomAddress(): string {
  return "0xToolTest" + randomBytes(4).toString("hex");
}

describe("agent tools", () => {
  let router: DBRouter;
  let address: string;

  beforeEach(() => {
    router = new DBRouter({ skipEncryption: true });
    address = randomAddress();
  });

  afterEach(() => {
    router.deleteUser(address);
  });

  const toolCtx = {
    toolCallId: "test",
    messages: [] as any[],
    abortSignal: undefined as any,
  };

  it("returns all expected tools", async () => {
    const db = await router.getConnection(address, randomHexKey());
    const tools = makeUserTools(db);

    expect(tools).toHaveProperty("save_memory");
    expect(tools).toHaveProperty("recall_memories");
    expect(tools).toHaveProperty("search_history");
  });

  describe("save_memory", () => {
    it("saves a new memory", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUserTools(db);

      const result = await tools.save_memory.execute(
        { key: "name", value: "Alice" },
        toolCtx
      );
      expect(result).toContain("Remembered");
      expect(result).toContain("name");
      expect(result).toContain("Alice");

      const rows = (await db
        .prepare("SELECT value FROM memories WHERE key = ?")
        .all("name")) as Array<{ value: string }>;
      expect(rows[0].value).toBe("Alice");
    });

    it("upserts an existing memory", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUserTools(db);

      await tools.save_memory.execute(
        { key: "name", value: "Alice" },
        toolCtx
      );
      await tools.save_memory.execute(
        { key: "name", value: "Bob" },
        toolCtx
      );

      const rows = (await db
        .prepare("SELECT value FROM memories WHERE key = ?")
        .all("name")) as Array<{ value: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe("Bob");
    });
  });

  describe("recall_memories", () => {
    it("returns message when no memories exist", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUserTools(db);

      const result = await tools.recall_memories.execute({}, toolCtx);
      expect(result).toBe("No memories stored yet.");
    });

    it("returns all memories formatted as a list", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUserTools(db);

      await tools.save_memory.execute(
        { key: "name", value: "Alice" },
        toolCtx
      );
      await tools.save_memory.execute(
        { key: "role", value: "engineer" },
        toolCtx
      );

      const result = await tools.recall_memories.execute({}, toolCtx);
      expect(result).toContain("- name: Alice");
      expect(result).toContain("- role: engineer");
    });
  });

  describe("search_history", () => {
    it("returns message when no matches found", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUserTools(db);

      const result = await tools.search_history.execute(
        { query: "nonexistent" },
        toolCtx
      );
      expect(result).toBe("No matching conversations found.");
    });

    it("finds matching conversations", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUserTools(db);

      await db
        .prepare(
          "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
        )
        .run("s1", "user", "Tell me about TypeScript");
      await db
        .prepare(
          "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
        )
        .run("s1", "assistant", "TypeScript is a typed superset of JavaScript");

      const result = await tools.search_history.execute(
        { query: "TypeScript" },
        toolCtx
      );

      expect(result).toContain("TypeScript");
    });

    it("respects the limit parameter", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUserTools(db);

      for (let i = 0; i < 5; i++) {
        await db
          .prepare(
            "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
          )
          .run("s1", "user", `Question ${i} about testing`);
      }

      const result = await tools.search_history.execute(
        { query: "testing", limit: 2 },
        toolCtx
      );

      const lines = result.split("\n");
      expect(lines).toHaveLength(2);
    });
  });
});
