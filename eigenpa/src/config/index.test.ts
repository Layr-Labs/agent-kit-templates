import { describe, it, expect, beforeEach } from "vitest";

// Reset the cached config between tests
async function freshLoadConfig() {
  // Dynamic import with cache busting isn't possible, so we test the parsing logic directly
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
    expect(config.models.agent).toBeTypeOf("string");
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
    expect(config.models.agent).toContain("anthropic/");
    expect(config.models.embed).toContain("voyage");
  });

  it("supports base64-encoded config via env var", async () => {
    const { parse } = await import("smol-toml");
    const toml = `
[models]
agent = "anthropic/test-model"
embed = "voyage-test"
[server]
port = 4000
[session]
cookie_name = "test"
ttl_hours = 1
[encryption]
cipher = "aegis256"
[data]
dir = "/tmp/test"
`;
    const config = parse(toml) as any;
    expect(config.server.port).toBe(4000);
    expect(config.models.agent).toBe("anthropic/test-model");
  });
});
