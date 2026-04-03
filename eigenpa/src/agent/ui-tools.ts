import { tool } from "ai";
import { z } from "zod";
import type { Database } from "@tursodatabase/database";
import { listIntegrations, getEnabledIntegrations } from "../integrations/index.js";
import type { SessionCredentials } from "../integrations/index.js";
import { keyVault } from "../vault/keyvault.js";
import type { ScheduledTaskRow } from "../scheduler/index.js";

/**
 * Tools that produce structured data for client-side component rendering.
 * The agent calls these tools; the frontend maps tool names → React components.
 */
export function makeUITools(db: Database, address?: string, sessionCredentials?: SessionCredentials) {
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
        const enabledInDb = rows.some((r) => r.integration_id === integrationId);
        const hasCredentials = !!(sessionCredentials?.[integrationId]);

        // Only report "already_enabled" if the integration is enabled AND
        // we actually have credentials in the session. If the session expired
        // or the server restarted, credentials may be gone even though the
        // DB still says "enabled" — in that case, prompt for re-auth.
        if (enabledInDb && hasCredentials) {
          return { type: "already_enabled" as const, integrationId };
        }
        const definition = listIntegrations().find((i) => i.id === integrationId);
        return {
          type: "oauth_prompt" as const,
          integrationId,
          name: definition?.name ?? integrationId,
          reason: enabledInDb
            ? `${reason} (session expired — please re-authorize)`
            : reason,
          oauthUrl: `/api/integrations/oauth/${integrationId}/start`,
        };
      },
    }),

    request_location: tool({
      description:
        "Request the user's current location via their browser. " +
        "Use this when you need the user's geographic location (e.g., for weather, local recommendations, timezone).",
      inputSchema: z.object({
        reason: z
          .string()
          .describe("Brief explanation of why you need the location"),
      }),
      execute: async ({ reason }) => ({
        type: "location_request" as const,
        reason,
      }),
    }),

    show_calendar_agenda: tool({
      description:
        "Display a rich daily agenda view of calendar events. " +
        "Use this to present a day's schedule as a visual timeline.",
      inputSchema: z.object({
        date: z.string().describe("The date label (e.g., 'Tomorrow — Friday, March 28')"),
        events: z.array(
          z.object({
            title: z.string(),
            start: z.string().describe("Start time (ISO 8601)"),
            end: z.string().describe("End time (ISO 8601)"),
            location: z.string().optional(),
            description: z.string().optional(),
          })
        ),
      }),
      execute: async ({ date, events }) => ({
        type: "calendar_agenda" as const,
        date,
        events,
      }),
    }),

    show_email_inbox: tool({
      description:
        "Display an inbox-style list of emails with sender, subject, date, and preview snippet. " +
        "Use this to present search results or recent emails visually.",
      inputSchema: z.object({
        emails: z.array(
          z.object({
            id: z.string().describe("Message ID"),
            from: z.string(),
            subject: z.string(),
            date: z.string(),
            snippet: z.string().optional(),
            unread: z.boolean().optional(),
          })
        ),
      }),
      execute: async ({ emails }) => ({
        type: "email_inbox" as const,
        emails,
      }),
    }),

    show_email_detail: tool({
      description:
        "Display the full content of a single email with headers and body. " +
        "Use this when the user wants to read a specific email.",
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        subject: z.string(),
        date: z.string(),
        body: z.string(),
        attachments: z.array(z.string()).optional(),
      }),
      execute: async ({ from, to, subject, date, body, attachments }) => ({
        type: "email_detail" as const,
        from,
        to,
        subject,
        date,
        body,
        attachments,
      }),
    }),

    show_github_repos: tool({
      description:
        "Display a list of GitHub repositories with language, stars, and description. " +
        "Use this to present repository search results or a user's repos.",
      inputSchema: z.object({
        repos: z.array(
          z.object({
            name: z.string(),
            fullName: z.string(),
            description: z.string().optional(),
            language: z.string().optional(),
            stars: z.number(),
            forks: z.number().optional(),
            isPrivate: z.boolean().optional(),
          })
        ),
      }),
      execute: async ({ repos }) => ({
        type: "github_repos" as const,
        repos,
      }),
    }),

    show_github_issues: tool({
      description:
        "Display a list of GitHub issues or pull requests for a repository. " +
        "Use this to present issues, PRs, or search results.",
      inputSchema: z.object({
        repo: z.string().describe("Repository full name (owner/repo)"),
        issues: z.array(
          z.object({
            number: z.number(),
            title: z.string(),
            state: z.string(),
            author: z.string(),
            labels: z.array(z.string()).optional(),
            comments: z.number().optional(),
            isPR: z.boolean().optional(),
            draft: z.boolean().optional(),
          })
        ),
      }),
      execute: async ({ repo, issues }) => ({
        type: "github_issues" as const,
        repo,
        issues,
      }),
    }),

    show_scheduled_tasks: tool({
      description:
        "Display the user's scheduled recurring tasks with status, cron schedule, and timing info. " +
        "Use this when the user asks about their scheduled tasks or automation.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = (await db
          .prepare("SELECT * FROM scheduled_tasks ORDER BY id")
          .all()) as ScheduledTaskRow[];

        const delegated = address ? keyVault.has(address) : false;

        return {
          type: "scheduled_tasks" as const,
          delegated,
          tasks: rows.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            cron: t.cron,
            enabled: !!t.enabled,
            nextRun: t.next_run_at ?? undefined,
            lastRun: t.last_run_at ?? undefined,
          })),
        };
      },
    }),
  };
}
