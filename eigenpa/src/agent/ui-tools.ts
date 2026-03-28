import { tool } from "ai";
import { z } from "zod";
import type { Database } from "@tursodatabase/database";
import { listIntegrations, getEnabledIntegrations } from "../integrations/index.js";

/**
 * Tools that produce structured data for client-side component rendering.
 * The agent calls these tools; the frontend maps tool names → React components.
 */
export function makeUITools(db: Database) {
  const integrationIds = listIntegrations().map((i) => i.id);

  return {
    show_integration_signin: tool({
      description:
        "Prompt the user to sign in to an integration they haven't connected yet. " +
        "Use this when you need access to a service (calendar, email, etc.) that the user hasn't enabled. " +
        "The UI will render a sign-in button inline in the chat.",
      inputSchema: z.object({
        integrationId: z
          .string()
          .describe(
            `Which integration to prompt for. Available: ${integrationIds.join(", ")}`
          ),
        reason: z
          .string()
          .describe("Brief explanation of why you need this access — shown to the user"),
      }),
      execute: async ({ integrationId, reason }) => {
        const rows = await getEnabledIntegrations(db);
        const enabled = rows.some((r) => r.integration_id === integrationId);
        if (enabled) {
          return {
            type: "already_enabled" as const,
            integrationId,
          };
        }
        const definition = listIntegrations().find((i) => i.id === integrationId);
        return {
          type: "oauth_prompt" as const,
          integrationId,
          name: definition?.name ?? integrationId,
          reason,
          oauthUrl: `/api/integrations/oauth/${integrationId}/start`,
        };
      },
    }),

    show_event_list: tool({
      description:
        "Display a rich visual list of calendar events to the user. " +
        "Use this after fetching events via calendar_list_events to present them nicely.",
      inputSchema: z.object({
        events: z.array(
          z.object({
            title: z.string(),
            start: z.string().describe("Start time (human-readable or ISO)"),
            end: z.string().describe("End time (human-readable or ISO)"),
            description: z.string().optional(),
          })
        ),
      }),
      execute: async ({ events }) => ({
        type: "event_list" as const,
        events,
      }),
    }),

    show_email_preview: tool({
      description:
        "Display a rich preview of emails to the user. " +
        "Use this after fetching emails via gmail_list_messages to present them visually.",
      inputSchema: z.object({
        emails: z.array(
          z.object({
            from: z.string(),
            subject: z.string(),
            date: z.string(),
            snippet: z.string().optional(),
          })
        ),
      }),
      execute: async ({ emails }) => ({
        type: "email_preview" as const,
        emails,
      }),
    }),
  };
}
