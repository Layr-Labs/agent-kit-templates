import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Config {
  models: {
    agent: string;
    embed: string;
  };
  server: {
    port: number;
  };
  session: {
    cookie_name: string;
    ttl_hours: number;
  };
  encryption: {
    cipher: string;
  };
  data: {
    dir: string;
  };
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;

  // Support base64-encoded config via env var (for containerized deployments)
  const b64 = process.env.CONFIG_TOML_B64;
  let raw: string;
  if (b64) {
    raw = Buffer.from(b64, "base64").toString("utf-8");
  } else {
    const configPath = join(__dirname, "../../config.toml");
    raw = readFileSync(configPath, "utf-8");
  }

  cached = parse(raw) as unknown as Config;

  // Allow env var overrides for data dir
  if (process.env.DATA_DIR) {
    cached.data.dir = process.env.DATA_DIR;
  }

  return cached;
}

/** Reset cached config — used in tests. */
export function resetConfig(): void {
  cached = null;
}
