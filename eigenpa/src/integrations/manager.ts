import type { Database } from "@tursodatabase/database";
import type { CoreTool } from "ai";
import type {
  IntegrationCredentials,
  IntegrationRow,
  EnabledIntegration,
} from "./types.js";
import { getIntegration } from "./registry.js";

/**
 * Credentials map stored in the session: { integrationId: { key: value } }
 */
export type SessionCredentials = Record<string, IntegrationCredentials>;

/**
 * Read enabled integrations from the user's DB.
 */
export async function getEnabledIntegrations(
  db: Database
): Promise<IntegrationRow[]> {
  return (await db
    .prepare("SELECT * FROM integrations WHERE enabled = 1")
    .all()) as IntegrationRow[];
}

/**
 * Enable an integration for the user. Upserts into the integrations table.
 */
export async function enableIntegration(
  db: Database,
  integrationId: string,
  config: Record<string, unknown> = {}
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO integrations (integration_id, enabled, config, updated_at)
       VALUES (?, 1, ?, datetime('now'))
       ON CONFLICT(integration_id) DO UPDATE
       SET enabled = 1, config = excluded.config, updated_at = excluded.updated_at`
    )
    .run(integrationId, JSON.stringify(config));
}

/**
 * Disable an integration for the user (keeps the row for re-enabling).
 */
export async function disableIntegration(
  db: Database,
  integrationId: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE integrations SET enabled = 0, updated_at = datetime('now')
       WHERE integration_id = ?`
    )
    .run(integrationId);
}

/**
 * Remove an integration entirely from the user's DB.
 */
export async function removeIntegration(
  db: Database,
  integrationId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM integrations WHERE integration_id = ?")
    .run(integrationId);
}

/**
 * Assemble tools from all enabled integrations.
 *
 * For each enabled integration in the DB:
 * 1. Look up its definition in the registry
 * 2. Pull its credentials from the session
 * 3. Call createTools() to produce the tool set
 * 4. Merge all tools into a single record
 *
 * Integrations without credentials in the session are silently skipped
 * (the user hasn't completed setup yet).
 */
export async function assembleIntegrationTools(
  db: Database,
  sessionCredentials: SessionCredentials
): Promise<Record<string, CoreTool>> {
  const rows = await getEnabledIntegrations(db);
  const tools: Record<string, CoreTool> = {};

  for (const row of rows) {
    const definition = getIntegration(row.integration_id);
    if (!definition) continue;

    const credentials = sessionCredentials[row.integration_id];
    if (!credentials) continue; // No creds in session — skip silently

    const config = JSON.parse(row.config) as Record<string, unknown>;
    const integrationTools = definition.createTools({ credentials, config });

    Object.assign(tools, integrationTools);
  }

  return tools;
}
