import type { SessionCredentials } from "../integrations/index.js";

/**
 * Material held in the vault for a single user.
 * Stored only in TEE-resident memory — never written to disk.
 */
export interface VaultEntry {
  /** Database encryption key (32-byte hex) */
  encKey: string;
  /** Per-integration credentials */
  integrationCredentials: SessionCredentials;
  /** Timestamp when the delegation was created */
  delegatedAt: number;
}

/**
 * TEE-resident in-memory key vault.
 *
 * Holds delegation keys and integration credentials for users who have
 * opted into background task execution. Keys are:
 *  - Only in memory (hardware-encrypted by the TEE)
 *  - Evicted on TEE restart (users must re-authorize)
 *  - Invisible to the host OS and cloud operator
 */
export class KeyVault {
  private entries = new Map<string, VaultEntry>();

  /** Store delegation material for a user. Overwrites any existing entry. */
  store(address: string, entry: VaultEntry): void {
    this.entries.set(address.toLowerCase(), entry);
  }

  /** Retrieve a user's delegation material. */
  get(address: string): VaultEntry | undefined {
    return this.entries.get(address.toLowerCase());
  }

  /** Check if a user has an active delegation. */
  has(address: string): boolean {
    return this.entries.has(address.toLowerCase());
  }

  /** Revoke a user's delegation — removes keys from memory. */
  delete(address: string): boolean {
    return this.entries.delete(address.toLowerCase());
  }

  /** List all addresses with active delegations. */
  listDelegatedAddresses(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Number of active delegations. */
  get size(): number {
    return this.entries.size;
  }

  /** Clear all entries (e.g., on shutdown). */
  clear(): void {
    this.entries.clear();
  }
}

/** Singleton vault instance — lives for the lifetime of the process. */
export const keyVault = new KeyVault();
