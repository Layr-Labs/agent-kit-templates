import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBRouter } from "../db/router.js";
import { makeScheduleTools } from "./schedule-tools.js";
import { keyVault } from "../vault/keyvault.js";
import { randomBytes } from "node:crypto";

function randomAddress(): string {
  return "0xSchedTest" + randomBytes(4).toString("hex");
}

function randomHexKey(): string {
  return randomBytes(32).toString("hex");
}

const toolCtx = {
  toolCallId: "test",
  messages: [] as any[],
  abortSignal: undefined as any,
};

describe("schedule tools", () => {
  let router: DBRouter;
  let address: string;

  beforeEach(() => {
    router = new DBRouter({ skipEncryption: true });
    address = randomAddress();
  });

  afterEach(() => {
    keyVault.delete(address);
    router.deleteUser(address);
  });

  it("returns all expected schedule tools", async () => {
    const db = await router.getConnection(address, randomHexKey());
    const tools = makeScheduleTools(db, address);

    expect(tools).toHaveProperty("create_scheduled_task");
    expect(tools).toHaveProperty("list_scheduled_tasks");
    expect(tools).toHaveProperty("update_scheduled_task");
    expect(tools).toHaveProperty("delete_scheduled_task");
  });

  describe("create_scheduled_task", () => {
    it("rejects when delegation is not active", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeScheduleTools(db, address);

      const result = await tools.create_scheduled_task.execute(
        { name: "Test", description: "test task", cron: "0 8 * * *" },
        toolCtx
      );
      expect(result).toContain("not enabled");
    });

    it("creates a task when delegated", async () => {
      keyVault.store(address, {
        encKey: "k",
        integrationCredentials: {},
        delegatedAt: Date.now(),
      });

      const db = await router.getConnection(address, randomHexKey());
      const tools = makeScheduleTools(db, address);

      const result = await tools.create_scheduled_task.execute(
        {
          name: "Morning email",
          description: "Check email and summarize",
          cron: "0 8 * * *",
        },
        toolCtx
      );
      expect(result).toContain("created");
      expect(result).toContain("Morning email");
    });

    it("rejects invalid cron", async () => {
      keyVault.store(address, {
        encKey: "k",
        integrationCredentials: {},
        delegatedAt: Date.now(),
      });

      const db = await router.getConnection(address, randomHexKey());
      const tools = makeScheduleTools(db, address);

      const result = await tools.create_scheduled_task.execute(
        { name: "Bad", description: "test", cron: "invalid" },
        toolCtx
      );
      expect(result).toContain("Invalid cron");
    });
  });

  describe("list_scheduled_tasks", () => {
    it("returns empty when no tasks", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeScheduleTools(db, address);

      const result = await tools.list_scheduled_tasks.execute({}, toolCtx);
      expect(result).toBe("No scheduled tasks.");
    });

    it("lists created tasks", async () => {
      keyVault.store(address, {
        encKey: "k",
        integrationCredentials: {},
        delegatedAt: Date.now(),
      });

      const db = await router.getConnection(address, randomHexKey());
      const tools = makeScheduleTools(db, address);

      await tools.create_scheduled_task.execute(
        { name: "Task A", description: "do A", cron: "0 8 * * *" },
        toolCtx
      );
      await tools.create_scheduled_task.execute(
        { name: "Task B", description: "do B", cron: "0 9 * * 1-5" },
        toolCtx
      );

      const result = await tools.list_scheduled_tasks.execute({}, toolCtx);
      expect(result).toContain("Task A");
      expect(result).toContain("Task B");
      expect(result).toContain("ACTIVE");
    });
  });

  describe("delete_scheduled_task", () => {
    it("deletes an existing task", async () => {
      keyVault.store(address, {
        encKey: "k",
        integrationCredentials: {},
        delegatedAt: Date.now(),
      });

      const db = await router.getConnection(address, randomHexKey());
      const tools = makeScheduleTools(db, address);

      await tools.create_scheduled_task.execute(
        { name: "Temp", description: "temp", cron: "0 8 * * *" },
        toolCtx
      );

      const result = await tools.delete_scheduled_task.execute(
        { taskId: 1 },
        toolCtx
      );
      expect(result).toContain("deleted");

      const list = await tools.list_scheduled_tasks.execute({}, toolCtx);
      expect(list).toBe("No scheduled tasks.");
    });

    it("returns not found for invalid id", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeScheduleTools(db, address);

      const result = await tools.delete_scheduled_task.execute(
        { taskId: 999 },
        toolCtx
      );
      expect(result).toContain("not found");
    });
  });
});
