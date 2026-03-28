import { describe, it, expect } from "vitest";
import { SCHEMA } from "./schema.js";

describe("schema", () => {
  it("exports an array of SQL statements", () => {
    expect(Array.isArray(SCHEMA)).toBe(true);
    expect(SCHEMA.length).toBe(5);
  });

  it("contains CREATE TABLE IF NOT EXISTS for all required tables", () => {
    const tables = ["memories", "conversations", "embeddings", "integrations", "scheduled_tasks"];
    for (const table of tables) {
      const found = SCHEMA.some(
        (stmt) =>
          stmt.includes("CREATE TABLE IF NOT EXISTS") &&
          stmt.includes(table)
      );
      expect(found, `missing schema for table: ${table}`).toBe(true);
    }
  });

  it("memories table has UNIQUE constraint on key", () => {
    const memoriesStmt = SCHEMA.find((s) => s.includes("memories"));
    expect(memoriesStmt).toContain("UNIQUE");
  });

  it("conversations table has role CHECK constraint", () => {
    const convStmt = SCHEMA.find((s) => s.includes("conversations"));
    expect(convStmt).toContain("CHECK");
    expect(convStmt).toContain("user");
    expect(convStmt).toContain("assistant");
    expect(convStmt).toContain("system");
    expect(convStmt).toContain("tool");
  });

  it("all tables have created_at with default datetime", () => {
    for (const stmt of SCHEMA) {
      expect(stmt).toContain("created_at");
      expect(stmt).toContain("datetime('now')");
    }
  });
});
