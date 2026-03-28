import { describe, it, expect } from "vitest";

async function freshLoadConfig() {
  const { parse } = await import("smol-toml");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");

  const raw = readFileSync(join(__dirname, "../../config.toml"), "utf-8");
  return parse(raw) as any;
}

describe("config", () => {
  it("parses config.toml with all required sections", async () => {
    const config = await freshLoadConfig();

    expect(config.models).toBeDefined();
    expect(config.models.chat).toBeTypeOf("string");
    expect(config.models.task).toBeTypeOf("string");
    expect(config.models.embed).toBeTypeOf("string");

    expect(config.server).toBeDefined();
    expect(config.server.port).toBeTypeOf("number");

    expect(config.session).toBeDefined();
    expect(config.session.cookie_name).toBeTypeOf("string");
    expect(config.session.ttl_hours).toBeTypeOf("number");

    expect(config.encryption).toBeDefined();
    expect(config.encryption.cipher).toBe("aegis256");

    expect(config.data).toBeDefined();
    expect(config.data.dir).toBeTypeOf("string");
  });

  it("has valid model identifiers", async () => {
    const config = await freshLoadConfig();
    expect(config.models.chat).toContain("claude");
    expect(config.models.task).toContain("claude");
    expect(config.models.embed).toContain("voyage");
  });

  it("chat and task models can be configured independently", async () => {
    const { parse } = await import("smol-toml");
    const toml = `
[models]
chat = "claude-sonnet-4-6-20250514"
task = "claude-haiku-4-5-20251001"
embed = "voyage-3"
[server]
port = 3000
[session]
cookie_name = "test"
ttl_hours = 1
[encryption]
cipher = "aegis256"
[data]
dir = "/tmp/test"
`;
    const config = parse(toml) as any;
    expect(config.models.chat).toBe("claude-sonnet-4-6-20250514");
    expect(config.models.task).toBe("claude-haiku-4-5-20251001");
    expect(config.models.chat).not.toBe(config.models.task);
  });
});
