import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBRouter } from "../db/router.js";
import { makeUITools } from "./ui-tools.js";
import { enableIntegration } from "../integrations/index.js";
import { randomBytes } from "node:crypto";

function randomAddress(): string {
  return "0xUITest" + randomBytes(4).toString("hex");
}

function randomHexKey(): string {
  return randomBytes(32).toString("hex");
}

const toolCtx = {
  toolCallId: "test",
  messages: [] as any[],
  abortSignal: undefined as any,
};

describe("UI tools", () => {
  let router: DBRouter;
  let address: string;

  beforeEach(() => {
    router = new DBRouter({ skipEncryption: true });
    address = randomAddress();
  });

  afterEach(() => {
    router.deleteUser(address);
  });

  it("returns all expected UI tools", async () => {
    const db = await router.getConnection(address, randomHexKey());
    const tools = makeUITools(db, address);

    expect(tools).toHaveProperty("show_integration_signin");
    expect(tools).toHaveProperty("request_location");
    expect(tools).toHaveProperty("show_calendar_agenda");
    expect(tools).toHaveProperty("show_email_inbox");
    expect(tools).toHaveProperty("show_email_detail");
    expect(tools).toHaveProperty("show_github_repos");
    expect(tools).toHaveProperty("show_github_issues");
    expect(tools).toHaveProperty("show_scheduled_tasks");
  });

  describe("show_integration_signin", () => {
    it("returns oauth_prompt when integration is not enabled", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUITools(db, address);

      const result = (await tools.show_integration_signin.execute!(
        { integrationId: "google-calendar", reason: "Need calendar access" },
        toolCtx
      )) as any;

      expect(result.type).toBe("oauth_prompt");
      expect(result.integrationId).toBe("google-calendar");
    });

    it("returns already_enabled when integration is enabled", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "google-calendar");

      const tools = makeUITools(db, address);
      const result = (await tools.show_integration_signin.execute!(
        { integrationId: "google-calendar", reason: "test" },
        toolCtx
      )) as any;

      expect(result.type).toBe("already_enabled");
    });
  });

  describe("show_calendar_agenda", () => {
    it("returns structured agenda data", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUITools(db, address);

      const result = (await tools.show_calendar_agenda.execute!(
        {
          date: "Tomorrow — Friday",
          events: [
            { title: "Standup", start: "2026-03-28T09:00:00", end: "2026-03-28T09:15:00" },
            { title: "Sprint Review", start: "2026-03-28T14:00:00", end: "2026-03-28T15:00:00", location: "Room A", description: "Demo" },
          ],
        },
        toolCtx
      )) as any;

      expect(result.type).toBe("calendar_agenda");
      expect(result.events).toHaveLength(2);
      expect(result.date).toBe("Tomorrow — Friday");
    });
  });

  describe("show_email_inbox", () => {
    it("returns structured inbox data", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUITools(db, address);

      const result = (await tools.show_email_inbox.execute!(
        {
          emails: [
            { id: "msg1", from: "alice@example.com", subject: "Hi", date: "2026-03-27", unread: true },
          ],
        },
        toolCtx
      )) as any;

      expect(result.type).toBe("email_inbox");
      expect(result.emails).toHaveLength(1);
      expect(result.emails[0].unread).toBe(true);
    });
  });

  describe("show_scheduled_tasks", () => {
    it("returns tasks and delegation status", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUITools(db, address);

      const result = (await tools.show_scheduled_tasks.execute!(
        {},
        toolCtx
      )) as any;

      expect(result.type).toBe("scheduled_tasks");
      expect(result.delegated).toBe(false);
      expect(result.tasks).toEqual([]);
    });
  });
});
