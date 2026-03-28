import { tool } from "ai";
import { z } from "zod";
import type { Database } from "@tursodatabase/database";
import { nextRunTime } from "../scheduler/cron.js";
import { keyVault } from "../vault/keyvault.js";
import type { ScheduledTaskRow } from "../scheduler/index.js";

/**
 * Tools the agent uses to manage recurring scheduled tasks.
 * The agent creates/modifies schedules conversationally when users
 * request things like "check my email every morning" or "send me a
 * daily agenda summary at 8am".
 */
export function makeScheduleTools(db: Database, address: string) {
  return {
    create_scheduled_task: tool({
      description:
        "Create a new recurring scheduled task. Use this when the user wants something done automatically " +
        "on a regular basis (e.g., 'check my email every morning', 'summarize my calendar every day at 8am'). " +
        "IMPORTANT: The user must have background tasks enabled (delegated) for scheduled tasks to run.",
      inputSchema: z.object({
        name: z
          .string()
          .describe("Short name for the task (e.g., 'Morning email check')"),
        description: z
          .string()
          .describe(
            "Detailed instructions for what the task should do. Be specific — this is the prompt " +
            "that will be executed on schedule."
          ),
        cron: z
          .string()
          .describe(
            "Cron expression (5 fields: minute hour day-of-month month day-of-week). " +
            "Examples: '0 8 * * *' = daily at 8am, '0 8 * * 1-5' = weekdays at 8am, '*/30 * * * *' = every 30 min"
          ),
      }),
      execute: async ({ name, description, cron }) => {
        // Validate cron
        try {
          nextRunTime(cron, new Date());
        } catch {
          return `Invalid cron expression: "${cron}". Use 5 fields: minute hour day-of-month month day-of-week`;
        }

        if (!keyVault.has(address)) {
          return (
            "Background tasks are not enabled. The user needs to delegate access first " +
            "(enable background tasks in settings) before scheduled tasks can run."
          );
        }

        const next = nextRunTime(cron, new Date());
        await db
          .prepare(
            `INSERT INTO scheduled_tasks (name, description, cron, next_run_at)
             VALUES (?, ?, ?, ?)`
          )
          .run(name, description, cron, next.toISOString());

        return `Scheduled task "${name}" created. Next run: ${next.toISOString()}`;
      },
    }),

    list_scheduled_tasks: tool({
      description:
        "List all scheduled tasks for the user, showing their status and next run time.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = (await db
          .prepare("SELECT * FROM scheduled_tasks ORDER BY id")
          .all()) as ScheduledTaskRow[];

        if (!rows.length) return "No scheduled tasks.";

        const delegated = keyVault.has(address);

        return [
          delegated
            ? "Background tasks: ACTIVE"
            : "Background tasks: INACTIVE (tasks won't run until delegation is enabled)",
          "",
          ...rows.map(
            (t) =>
              `- #${t.id} "${t.name}" [${t.enabled ? "enabled" : "disabled"}]\n` +
              `  Cron: ${t.cron}\n` +
              `  Next: ${t.next_run_at ?? "not scheduled"}\n` +
              `  Last: ${t.last_run_at ?? "never"}`
          ),
        ].join("\n");
      },
    }),

    update_scheduled_task: tool({
      description:
        "Update an existing scheduled task's name, description, cron expression, or enabled state.",
      inputSchema: z.object({
        taskId: z.number().describe("ID of the task to update"),
        name: z.string().optional().describe("New name"),
        description: z.string().optional().describe("New description/instructions"),
        cron: z.string().optional().describe("New cron expression"),
        enabled: z.boolean().optional().describe("Enable or disable the task"),
      }),
      execute: async ({ taskId, name, description, cron, enabled }) => {
        const existing = (await db
          .prepare("SELECT * FROM scheduled_tasks WHERE id = ?")
          .all(taskId)) as ScheduledTaskRow[];

        if (!existing.length) return `Task #${taskId} not found.`;

        const updates: string[] = [];
        const values: any[] = [];

        if (name !== undefined) {
          updates.push("name = ?");
          values.push(name);
        }
        if (description !== undefined) {
          updates.push("description = ?");
          values.push(description);
        }
        if (cron !== undefined) {
          try {
            nextRunTime(cron, new Date());
          } catch {
            return `Invalid cron expression: "${cron}"`;
          }
          updates.push("cron = ?");
          values.push(cron);
          updates.push("next_run_at = ?");
          values.push(nextRunTime(cron, new Date()).toISOString());
        }
        if (enabled !== undefined) {
          updates.push("enabled = ?");
          values.push(enabled ? 1 : 0);
        }

        if (!updates.length) return "Nothing to update.";

        updates.push("updated_at = datetime('now')");
        values.push(taskId);

        await db
          .prepare(
            `UPDATE scheduled_tasks SET ${updates.join(", ")} WHERE id = ?`
          )
          .run(...values);

        return `Task #${taskId} updated.`;
      },
    }),

    delete_scheduled_task: tool({
      description: "Permanently delete a scheduled task.",
      inputSchema: z.object({
        taskId: z.number().describe("ID of the task to delete"),
      }),
      execute: async ({ taskId }) => {
        const existing = (await db
          .prepare("SELECT * FROM scheduled_tasks WHERE id = ?")
          .all(taskId)) as ScheduledTaskRow[];

        if (!existing.length) return `Task #${taskId} not found.`;

        await db
          .prepare("DELETE FROM scheduled_tasks WHERE id = ?")
          .run(taskId);

        return `Task #${taskId} "${existing[0].name}" deleted.`;
      },
    }),
  };
}
