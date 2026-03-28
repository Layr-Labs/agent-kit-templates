import type { CoreTool } from "ai";

/**
 * Credentials for a single integration, stored in the session cookie.
 * Shape varies per integration (OAuth tokens, API keys, etc.).
 */
export type IntegrationCredentials = Record<string, string>;

/**
 * Row from the `integrations` table in the user's DB.
 */
export interface IntegrationRow {
  id: number;
  integration_id: string;
  enabled: number;
  config: string;
  created_at: string;
  updated_at: string;
}

/**
 * Parsed integration state from the DB + session.
 */
export interface EnabledIntegration {
  integrationId: string;
  config: Record<string, unknown>;
  credentials: IntegrationCredentials;
}

/**
 * Defines an available integration that users can enable.
 */
export interface IntegrationDefinition {
  /** Unique identifier (e.g., "google-calendar", "gmail") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Short description of what this integration does */
  description: string;

  /** Credential fields required to activate (displayed to user during setup) */
  credentialFields: CredentialField[];

  /**
   * Factory that produces tools for the agent.
   * Called on each request with the user's credentials and config.
   */
  createTools(ctx: IntegrationContext): Record<string, CoreTool>;
}

export interface CredentialField {
  /** Key stored in session credentials (e.g., "access_token") */
  key: string;

  /** Human-readable label (e.g., "Google OAuth Access Token") */
  label: string;

  /** Whether this field is secret (masked in UI) */
  secret: boolean;
}

/**
 * Context passed to an integration's tool factory.
 */
export interface IntegrationContext {
  /** Credentials from the session */
  credentials: IntegrationCredentials;

  /** Per-integration config from the user's DB */
  config: Record<string, unknown>;
}
