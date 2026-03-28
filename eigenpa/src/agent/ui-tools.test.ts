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
    const tools = makeUITools(db);

    expect(tools).toHaveProperty("show_integration_signin");
    expect(tools).toHaveProperty("show_event_list");
    expect(tools).toHaveProperty("show_email_preview");
  });

  describe("show_integration_signin", () => {
    it("returns oauth_prompt when integration is not enabled", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUITools(db);

      const result = await tools.show_integration_signin.execute(
        { integrationId: "google-calendar", reason: "Need calendar access" },
        toolCtx
      );

      expect(result.type).toBe("oauth_prompt");
      expect(result.integrationId).toBe("google-calendar");
      expect(result.reason).toBe("Need calendar access");
      expect(result.oauthUrl).toContain("/api/integrations/oauth/google-calendar/start");
    });

    it("returns already_enabled when integration is enabled", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "google-calendar");

      const tools = makeUITools(db);
      const result = await tools.show_integration_signin.execute(
        { integrationId: "google-calendar", reason: "test" },
        toolCtx
      );

      expect(result.type).toBe("already_enabled");
      expect(result.integrationId).toBe("google-calendar");
    });
  });

  describe("show_event_list", () => {
    it("returns structured event data", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUITools(db);

      const events = [
        { title: "Standup", start: "9:00 AM", end: "9:15 AM" },
        {
          title: "Sprint Review",
          start: "2:00 PM",
          end: "3:00 PM",
          description: "Demo new features",
        },
      ];

      const result = await tools.show_event_list.execute(
        { events },
        toolCtx
      );

      expect(result.type).toBe("event_list");
      expect(result.events).toHaveLength(2);
      expect(result.events[0].title).toBe("Standup");
      expect(result.events[1].description).toBe("Demo new features");
    });
  });

  describe("show_email_preview", () => {
    it("returns structured email data", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = makeUITools(db);

      const emails = [
        {
          from: "alice@example.com",
          subject: "Meeting notes",
          date: "2026-03-27",
          snippet: "Here are the notes from today...",
        },
      ];

      const result = await tools.show_email_preview.execute(
        { emails },
        toolCtx
      );

      expect(result.type).toBe("email_preview");
      expect(result.emails).toHaveLength(1);
      expect(result.emails[0].subject).toBe("Meeting notes");
    });
  });
});
