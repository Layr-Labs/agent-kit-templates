import { describe, it, expect } from "vitest";
import { listIntegrations, getIntegration } from "./registry.js";

describe("integration registry", () => {
  it("lists all available integrations", () => {
    const all = listIntegrations();
    expect(all.length).toBeGreaterThanOrEqual(2);

    const ids = all.map((i) => i.id);
    expect(ids).toContain("google-calendar");
    expect(ids).toContain("gmail");
  });

  it("each integration has required fields", () => {
    for (const integration of listIntegrations()) {
      expect(integration.id).toBeTypeOf("string");
      expect(integration.name).toBeTypeOf("string");
      expect(integration.description).toBeTypeOf("string");
      expect(Array.isArray(integration.credentialFields)).toBe(true);
      expect(integration.createTools).toBeTypeOf("function");
    }
  });

  it("getIntegration returns the correct definition by id", () => {
    const gcal = getIntegration("google-calendar");
    expect(gcal).toBeDefined();
    expect(gcal!.name).toBe("Google Calendar");

    const gmail = getIntegration("gmail");
    expect(gmail).toBeDefined();
    expect(gmail!.name).toBe("Gmail");
  });

  it("getIntegration returns undefined for unknown ids", () => {
    expect(getIntegration("nonexistent")).toBeUndefined();
  });

  it("credential fields have key, label, and secret", () => {
    for (const integration of listIntegrations()) {
      for (const field of integration.credentialFields) {
        expect(field.key).toBeTypeOf("string");
        expect(field.label).toBeTypeOf("string");
        expect(field.secret).toBeTypeOf("boolean");
      }
    }
  });

  it("createTools returns an object of tools when given credentials", () => {
    const gcal = getIntegration("google-calendar")!;
    const tools = gcal.createTools({
      credentials: { access_token: "fake-token", refresh_token: "fake" },
      config: {},
    });

    expect(tools).toHaveProperty("calendar_list_events");
    expect(tools).toHaveProperty("calendar_create_event");
  });

  it("gmail createTools returns email tools", () => {
    const gmail = getIntegration("gmail")!;
    const tools = gmail.createTools({
      credentials: { access_token: "fake-token", refresh_token: "fake" },
      config: {},
    });

    expect(tools).toHaveProperty("gmail_list_messages");
    expect(tools).toHaveProperty("gmail_send_message");
  });
});
