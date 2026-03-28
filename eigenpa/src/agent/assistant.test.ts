import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBRouter } from "../db/router.js";
import { randomBytes } from "node:crypto";

function randomHexKey(): string {
  return randomBytes(32).toString("hex");
}

function randomAddress(): string {
  return "0xAsstTest" + randomBytes(4).toString("hex");
}

describe("PersonalAssistant", () => {
  let router: DBRouter;
  let address: string;

  beforeEach(() => {
    router = new DBRouter({ skipEncryption: true });
    address = randomAddress();
  });

  afterEach(() => {
    router.deleteUser(address);
  });

  it("can initialize a database and write/read memories for the agent", async () => {
    const db = await router.getConnection(address, randomHexKey());

    await db
      .prepare("INSERT INTO memories (key, value) VALUES (?, ?)")
      .run("name", "TestUser");

    const memories = (await db
      .prepare("SELECT key, value FROM memories")
      .all()) as Array<{ key: string; value: string }>;

    expect(memories).toHaveLength(1);
    expect(memories[0]).toEqual({ key: "name", value: "TestUser" });
  });

  it("persists conversation turns correctly", async () => {
    const db = await router.getConnection(address, randomHexKey());

    const insertConv = db.prepare(
      "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
    );
    await insertConv.run(address, "user", "Hello");
    await insertConv.run(address, "assistant", "Hi there!");

    const rows = (await db
      .prepare(
        `SELECT role, content FROM conversations
         WHERE session_id = ?
         ORDER BY created_at`
      )
      .all(address)) as Array<{ role: string; content: string }>;

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ role: "user", content: "Hello" });
    expect(rows[1]).toEqual({ role: "assistant", content: "Hi there!" });
  });

  it("loads only the last N messages for conversation history", async () => {
    const db = await router.getConnection(address, randomHexKey());

    const insertConv = db.prepare(
      "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
    );
    for (let i = 0; i < 25; i++) {
      await insertConv.run(
        address,
        i % 2 === 0 ? "user" : "assistant",
        `msg-${i}`
      );
    }

    const historyRows = (await db
      .prepare(
        `SELECT role, content FROM conversations
         WHERE session_id = ?
         ORDER BY id DESC LIMIT 20`
      )
      .all(address)) as Array<{ role: string; content: string }>;

    expect(historyRows).toHaveLength(20);
    expect(historyRows[0].content).toBe("msg-24");
  });

  it("SOUL.md and constitution.md files exist and are non-empty", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const soul = readFileSync(join(__dirname, "../../SOUL.md"), "utf-8");
    const constitution = readFileSync(
      join(__dirname, "../../constitution.md"),
      "utf-8"
    );

    expect(soul.length).toBeGreaterThan(0);
    expect(soul).toContain("EigenPA");
    expect(constitution.length).toBeGreaterThan(0);
    expect(constitution).toContain("Constitution");
  });

  it("system prompt is assembled correctly from parts", () => {
    const soul = "# EigenPA\nYou are helpful.";
    const constitution = "# Constitution\nBe safe.";
    const memoryText = "- name: Alice";
    const semanticText = "- Past: discussed TypeScript";

    const systemPrompt = [
      soul,
      "",
      "## Constitution",
      constitution,
      "",
      "## Known facts about this user",
      memoryText,
      "",
      "## Relevant past context",
      semanticText,
    ].join("\n");

    expect(systemPrompt).toContain("EigenPA");
    expect(systemPrompt).toContain("Constitution");
    expect(systemPrompt).toContain("name: Alice");
    expect(systemPrompt).toContain("discussed TypeScript");
  });
});
