import { connect, type Database } from "@tursodatabase/database";
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config/index.js";
import { SCHEMA } from "./schema.js";

export interface DBRouterOptions {
  /** Skip encryption (for testing). Default: false. */
  skipEncryption?: boolean;
}

export class DBRouter {
  private connections = new Map<string, Database>();
  private dataDir: string;
  private skipEncryption: boolean;

  constructor(opts?: DBRouterOptions) {
    const config = loadConfig();
    this.dataDir = config.data.dir;
    this.skipEncryption = opts?.skipEncryption ?? false;
    mkdirSync(this.dataDir, { recursive: true });
  }

  /**
   * Open (or create) the user's encrypted database.
   * @param address - Ethereum address (used as filename)
   * @param encKey  - 32-byte hex encryption key derived from wallet signature
   */
  async getConnection(address: string, encKey: string): Promise<Database> {
    const cacheKey = address.toLowerCase();
    const existing = this.connections.get(cacheKey);
    if (existing) return existing;

    const dbPath = join(this.dataDir, `${cacheKey}.db`);

    let db: Database;
    if (!this.skipEncryption) {
      const config = loadConfig();
      db = await connect(
        `file:${dbPath}?cipher=${config.encryption.cipher}&hexkey=${encKey}`
      );
    } else {
      db = await connect(dbPath);
    }

    for (const stmt of SCHEMA) {
      await db.exec(stmt);
    }

    this.connections.set(cacheKey, db);
    return db;
  }

  /** Close a connection (e.g., on logout). DB remains encrypted on disk. */
  closeConnection(address: string): void {
    const key = address.toLowerCase();
    this.connections.get(key)?.close();
    this.connections.delete(key);
  }

  /** Delete a user's encrypted database entirely. */
  deleteUser(address: string): void {
    this.closeConnection(address);
    const dbPath = join(this.dataDir, `${address.toLowerCase()}.db`);
    if (existsSync(dbPath)) unlinkSync(dbPath);
  }
}
