import { tool } from "ai";
import { z } from "zod";
import type { Database } from "@tursodatabase/database";

export function makeUserTools(db: Database) {
  return {
    save_memory: tool({
      description:
        "Save or update a fact about the user (name, preferences, role, goals, etc.)",
      inputSchema: z.object({
        key: z.string().describe("Short label for the fact"),
        value: z.string().describe("The fact to remember"),
      }),
      execute: async ({ key, value }) => {
        db.prepare(
          `INSERT INTO memories (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE
           SET value = excluded.value, updated_at = excluded.updated_at`
        ).run(key, value);
        return `Remembered: ${key} = ${value}`;
      },
    }),

    recall_memories: tool({
      description: "Retrieve all stored facts about the user",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = (await db
          .prepare("SELECT key, value FROM memories ORDER BY key")
          .all()) as Array<{ key: string; value: string }>;
        if (!rows.length) return "No memories stored yet.";
        return rows.map((r) => `- ${r.key}: ${r.value}`).join("\n");
      },
    }),

    search_history: tool({
      description:
        "Search past conversation history for relevant context on a topic",
      inputSchema: z.object({
        query: z.string().describe("What to search for in past conversations"),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Max number of results"),
      }),
      execute: async ({ query, limit = 10 }) => {
        const effectiveLimit = Math.max(1, Math.min(limit, 100));
        const rows = (await db
          .prepare(
            `SELECT role, content, created_at FROM conversations
             WHERE content LIKE '%' || ? || '%'
             ORDER BY id DESC
             LIMIT ${effectiveLimit}`
          )
          .all(query)) as Array<{
          role: string;
          content: string;
          created_at: string;
        }>;
        if (!rows.length) return "No matching conversations found.";
        return rows
          .map((r) => `[${r.created_at}] ${r.role}: ${r.content}`)
          .join("\n");
      },
    }),
  };
}
