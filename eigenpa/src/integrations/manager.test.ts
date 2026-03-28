import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBRouter } from "../db/router.js";
import {
  enableIntegration,
  disableIntegration,
  removeIntegration,
  getEnabledIntegrations,
  assembleIntegrationTools,
} from "./manager.js";
import type { SessionCredentials } from "./manager.js";
import { randomBytes } from "node:crypto";

function randomHexKey(): string {
  return randomBytes(32).toString("hex");
}

function randomAddress(): string {
  return "0xIntTest" + randomBytes(4).toString("hex");
}

describe("integration manager", () => {
  let router: DBRouter;
  let address: string;

  beforeEach(() => {
    router = new DBRouter({ skipEncryption: true });
    address = randomAddress();
  });

  afterEach(() => {
    router.deleteUser(address);
  });

  describe("enableIntegration", () => {
    it("inserts a new integration row", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "google-calendar", {
        calendar_id: "primary",
      });

      const rows = await getEnabledIntegrations(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].integration_id).toBe("google-calendar");
      expect(rows[0].enabled).toBe(1);
      expect(JSON.parse(rows[0].config)).toEqual({
        calendar_id: "primary",
      });
    });

    it("upserts on duplicate integration_id", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "gmail", { version: 1 });
      await enableIntegration(db, "gmail", { version: 2 });

      const rows = await getEnabledIntegrations(db);
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0].config)).toEqual({ version: 2 });
    });

    it("re-enables a previously disabled integration", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "gmail");
      await disableIntegration(db, "gmail");
      await enableIntegration(db, "gmail");

      const rows = await getEnabledIntegrations(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].enabled).toBe(1);
    });
  });

  describe("disableIntegration", () => {
    it("sets enabled = 0 but keeps the row", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "google-calendar");
      await disableIntegration(db, "google-calendar");

      const enabled = await getEnabledIntegrations(db);
      expect(enabled).toHaveLength(0);

      // Row still exists
      const all = (await db
        .prepare("SELECT * FROM integrations")
        .all()) as Array<{ enabled: number }>;
      expect(all).toHaveLength(1);
      expect(all[0].enabled).toBe(0);
    });
  });

  describe("removeIntegration", () => {
    it("deletes the row entirely", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "gmail");
      await removeIntegration(db, "gmail");

      const all = (await db
        .prepare("SELECT * FROM integrations")
        .all()) as Array<unknown>;
      expect(all).toHaveLength(0);
    });
  });

  describe("assembleIntegrationTools", () => {
    it("returns empty object when no integrations enabled", async () => {
      const db = await router.getConnection(address, randomHexKey());
      const tools = await assembleIntegrationTools(db, {});
      expect(Object.keys(tools)).toHaveLength(0);
    });

    it("returns empty object when integration enabled but no credentials", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "google-calendar");

      const tools = await assembleIntegrationTools(db, {});
      expect(Object.keys(tools)).toHaveLength(0);
    });

    it("returns tools when integration is enabled and has credentials", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "google-calendar");

      const creds: SessionCredentials = {
        "google-calendar": {
          access_token: "fake-token",
          refresh_token: "fake-refresh",
        },
      };

      const tools = await assembleIntegrationTools(db, creds);
      expect(tools).toHaveProperty("calendar_list_events");
      expect(tools).toHaveProperty("calendar_create_event");
    });

    it("assembles tools from multiple integrations", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "google-calendar");
      await enableIntegration(db, "gmail");

      const creds: SessionCredentials = {
        "google-calendar": { access_token: "t1", refresh_token: "r1" },
        gmail: { access_token: "t2", refresh_token: "r2" },
      };

      const tools = await assembleIntegrationTools(db, creds);
      expect(tools).toHaveProperty("calendar_list_events");
      expect(tools).toHaveProperty("calendar_create_event");
      expect(tools).toHaveProperty("gmail_list_messages");
      expect(tools).toHaveProperty("gmail_send_message");
    });

    it("skips disabled integrations even with credentials", async () => {
      const db = await router.getConnection(address, randomHexKey());
      await enableIntegration(db, "gmail");
      await disableIntegration(db, "gmail");

      const creds: SessionCredentials = {
        gmail: { access_token: "t", refresh_token: "r" },
      };

      const tools = await assembleIntegrationTools(db, creds);
      expect(Object.keys(tools)).toHaveLength(0);
    });

    it("skips unknown integrations in the DB", async () => {
      const db = await router.getConnection(address, randomHexKey());
      // Manually insert a row for an integration that doesn't exist in the registry
      await db
        .prepare(
          "INSERT INTO integrations (integration_id, enabled, config) VALUES (?, 1, '{}')"
        )
        .run("nonexistent-integration");

      const creds: SessionCredentials = {
        "nonexistent-integration": { token: "x" },
      };

      const tools = await assembleIntegrationTools(db, creds);
      expect(Object.keys(tools)).toHaveLength(0);
    });
  });
});
