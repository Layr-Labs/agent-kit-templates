import { tool } from "ai";
import { z } from "zod";
import type { IntegrationDefinition, IntegrationContext } from "./types.js";

export const googleCalendar: IntegrationDefinition = {
  id: "google-calendar",
  name: "Google Calendar",
  description: "Read and create events on your Google Calendar",
  credentialFields: [
    {
      key: "access_token",
      label: "Google OAuth Access Token",
      secret: true,
    },
    {
      key: "refresh_token",
      label: "Google OAuth Refresh Token",
      secret: true,
    },
  ],
  createTools(ctx: IntegrationContext) {
    const headers = {
      Authorization: `Bearer ${ctx.credentials.access_token}`,
      "Content-Type": "application/json",
    };
    const calendarId =
      (ctx.config.calendar_id as string) ?? "primary";

    return {
      calendar_list_events: tool({
        description:
          "List upcoming events from the user's Google Calendar",
        parameters: z.object({
          maxResults: z
            .number()
            .optional()
            .default(10)
            .describe("Maximum number of events to return"),
          timeMin: z
            .string()
            .optional()
            .describe("Start time (ISO 8601). Defaults to now."),
        }),
        execute: async ({ maxResults, timeMin }) => {
          const min = timeMin ?? new Date().toISOString();
          const url = new URL(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
          );
          url.searchParams.set("maxResults", String(maxResults));
          url.searchParams.set("timeMin", min);
          url.searchParams.set("singleEvents", "true");
          url.searchParams.set("orderBy", "startTime");

          const res = await fetch(url.toString(), { headers });
          if (!res.ok) return `Calendar API error: ${res.status} ${await res.text()}`;
          const data = await res.json();
          const items = (data.items ?? []) as Array<{
            summary?: string;
            start?: { dateTime?: string; date?: string };
            end?: { dateTime?: string; date?: string };
          }>;
          if (!items.length) return "No upcoming events found.";
          return items
            .map(
              (e) =>
                `- ${e.summary ?? "(no title)"}: ${e.start?.dateTime ?? e.start?.date ?? "?"} → ${e.end?.dateTime ?? e.end?.date ?? "?"}`
            )
            .join("\n");
        },
      }),

      calendar_create_event: tool({
        description: "Create a new event on the user's Google Calendar",
        parameters: z.object({
          summary: z.string().describe("Event title"),
          startTime: z
            .string()
            .describe("Start time in ISO 8601 format"),
          endTime: z.string().describe("End time in ISO 8601 format"),
          description: z
            .string()
            .optional()
            .describe("Event description"),
        }),
        execute: async ({ summary, startTime, endTime, description }) => {
          const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
          const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              summary,
              description,
              start: { dateTime: startTime },
              end: { dateTime: endTime },
            }),
          });
          if (!res.ok) return `Calendar API error: ${res.status} ${await res.text()}`;
          const event = await res.json();
          return `Created event "${event.summary}" (${event.htmlLink})`;
        },
      }),
    };
  },
};
