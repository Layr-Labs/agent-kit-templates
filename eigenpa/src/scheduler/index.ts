import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { keyVault } from "../vault/keyvault.js";
import { DBRouter } from "../db/router.js";
import { loadConfig } from "../config/index.js";
import { assembleIntegrationTools } from "../integrations/index.js";
import { makeUserTools } from "../agent/tools.js";
import { cronMatches, nextRunTime } from "./cron.js";

const config = loadConfig();
const anthropic = createAnthropic();

export interface ScheduledTaskRow {
  id: number;
  name: string;
  description: string;
  cron: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

const TICK_INTERVAL_MS = 60_000; // Check every minute

/**
 * In-process scheduler that executes recurring tasks for delegated users.
 *
 * Every minute, it:
 * 1. Iterates over all users with active delegations in the KeyVault
 * 2. Opens each user's encrypted DB (using the vault's encKey)
 * 3. Reads their scheduled_tasks table
 * 4. Runs any tasks whose cron expression matches the current time
 * 5. Updates last_run_at and next_run_at
 */
export function startScheduler(dbRouter: DBRouter): () => void {
  console.log("[scheduler] Started (tick interval: 60s)");

  const timer = setInterval(() => {
    void tick(dbRouter).catch((err) => {
      console.error("[scheduler] Tick error:", err);
    });
  }, TICK_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    console.log("[scheduler] Stopped");
  };
}

async function tick(dbRouter: DBRouter): Promise<void> {
  const addresses = keyVault.listDelegatedAddresses();
  if (!addresses.length) return;

  const now = new Date();

  for (const address of addresses) {
    const entry = keyVault.get(address);
    if (!entry) continue;

    try {
      const db = await dbRouter.getConnection(address, entry.encKey);
      const tasks = (await db
        .prepare(
          "SELECT * FROM scheduled_tasks WHERE enabled = 1"
        )
        .all()) as ScheduledTaskRow[];

      for (const task of tasks) {
        if (!shouldRun(task, now)) continue;

        console.log(
          `[scheduler] Running task "${task.name}" for ${address.slice(0, 8)}...`
        );

        try {
          await executeTask(db, address, entry, task);
        } catch (err) {
          console.error(
            `[scheduler] Task "${task.name}" failed for ${address.slice(0, 8)}:`,
            err
          );
        }

        // Update timing regardless of success/failure
        const next = nextRunTime(task.cron, now);
        await db
          .prepare(
            `UPDATE scheduled_tasks
             SET last_run_at = ?, next_run_at = ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .run(now.toISOString(), next.toISOString(), task.id);
      }
    } catch (err) {
      console.error(
        `[scheduler] Failed to process user ${address.slice(0, 8)}:`,
        err
      );
    }
  }
}

function shouldRun(task: ScheduledTaskRow, now: Date): boolean {
  if (!cronMatches(task.cron, now)) return false;

  // Don't re-run if already ran this minute
  if (task.last_run_at) {
    const lastRun = new Date(task.last_run_at);
    if (
      lastRun.getFullYear() === now.getFullYear() &&
      lastRun.getMonth() === now.getMonth() &&
      lastRun.getDate() === now.getDate() &&
      lastRun.getHours() === now.getHours() &&
      lastRun.getMinutes() === now.getMinutes()
    ) {
      return false;
    }
  }

  return true;
}

async function executeTask(
  db: any,
  address: string,
  entry: { encKey: string; integrationCredentials: Record<string, Record<string, string>> },
  task: ScheduledTaskRow
): Promise<void> {
  // Assemble tools for this user
  const userTools = makeUserTools(db);
  const integrationTools = await assembleIntegrationTools(
    db,
    entry.integrationCredentials
  );
  const allTools = { ...userTools, ...integrationTools };

  // Run the task as an agent prompt
  const { text } = await generateText({
    model: anthropic(config.models.agent),
    system: [
      `You are executing a scheduled background task for the user.`,
      `Task: ${task.name}`,
      `Description: ${task.description}`,
      `Execute the task and produce a summary of what you did.`,
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: task.description,
      },
    ],
    tools: allTools,
    maxSteps: 10,
  });

  // Log the result as a conversation
  const insertConv = db.prepare(
    "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
  );
  await insertConv.run(
    `scheduled:${task.id}`,
    "system",
    `[Scheduled task: ${task.name}] ${task.description}`
  );
  await insertConv.run(`scheduled:${task.id}`, "assistant", text);
}
