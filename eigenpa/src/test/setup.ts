import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TEST_DATA_DIR = join(__dirname, "../../.test-data");

// Set env vars for tests before any module loads config
process.env.SESSION_SECRET =
  "test-secret-that-is-at-least-32-characters-long!!";
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.VOYAGEAI_API_KEY = "test-key";

// Ensure clean test data directory
rmSync(TEST_DATA_DIR, { recursive: true, force: true });
mkdirSync(TEST_DATA_DIR, { recursive: true });
