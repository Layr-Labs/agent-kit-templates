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

    return {
      calendar_list_calendars: tool({
        description:
          "List all calendars the user has access to. Use this first to discover which calendars to query — " +
          "events may be spread across multiple calendars (work, personal, shared, etc.).",
        inputSchema: z.object({}),
        execute: async () => {
          const res = await fetch(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
            { headers }
          );
          if (!res.ok)
            return `Calendar API error: request failed (${res.status})`;
          const data = await res.json();
          const calendars = (data.items ?? []) as Array<{
            id: string;
            summary: string;
            primary?: boolean;
            accessRole: string;
          }>;
          if (!calendars.length) return "No calendars found.";
          return calendars
            .map(
              (c) =>
                `- ${c.summary}${c.primary ? " (primary)" : ""} [${c.accessRole}] id: ${c.id}`
            )
            .join("\n");
        },
      }),

      calendar_list_events: tool({
        description:
          "List events from a Google Calendar within a time range. " +
          "IMPORTANT: Always set both timeMin and timeMax to get accurate results for a specific day or range. " +
          "For example, to check tomorrow, set timeMin to tomorrow 00:00 and timeMax to tomorrow 23:59. " +
          "Use calendarId 'primary' for the user's main calendar, or a specific calendar ID from calendar_list_calendars.",
        inputSchema: z.object({
          calendarId: z
            .string()
            .optional()
            .default("primary")
            .describe(
              "Calendar ID to query. Use 'primary' for the main calendar or a specific ID."
            ),
          maxResults: z
            .number()
            .optional()
            .default(25)
            .describe("Maximum number of events to return"),
          timeMin: z
            .string()
            .describe(
              "Start of time range (ISO 8601). Required — e.g., '2026-03-28T00:00:00-05:00'"
            ),
          timeMax: z
            .string()
            .optional()
            .describe(
              "End of time range (ISO 8601). Strongly recommended — e.g., '2026-03-28T23:59:59-05:00'"
            ),
        }),
        execute: async ({ calendarId, maxResults, timeMin, timeMax }) => {
          const url = new URL(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
          );
          url.searchParams.set("maxResults", String(maxResults));
          url.searchParams.set("timeMin", timeMin);
          if (timeMax) url.searchParams.set("timeMax", timeMax);
          url.searchParams.set("singleEvents", "true");
          url.searchParams.set("orderBy", "startTime");

          const res = await fetch(url.toString(), { headers });
          if (!res.ok)
            return `Calendar API error: request failed (${res.status})`;
          const data = await res.json();
          const items = (data.items ?? []) as Array<{
            summary?: string;
            start?: { dateTime?: string; date?: string };
            end?: { dateTime?: string; date?: string };
            location?: string;
            description?: string;
          }>;
          if (!items.length) return "No events found in this time range.";
          return items
            .map((e) => {
              const start = e.start?.dateTime ?? e.start?.date ?? "?";
              const end = e.end?.dateTime ?? e.end?.date ?? "?";
              let line = `- **${e.summary ?? "(no title)"}**: ${start} → ${end}`;
              if (e.location) line += ` | Location: ${e.location}`;
              return line;
            })
            .join("\n");
        },
      }),

      calendar_create_event: tool({
        description: "Create a new event on the user's Google Calendar",
        inputSchema: z.object({
          calendarId: z
            .string()
            .optional()
            .default("primary")
            .describe("Calendar ID to create the event on"),
          summary: z.string().describe("Event title"),
          startTime: z
            .string()
            .describe("Start time in ISO 8601 format"),
          endTime: z.string().describe("End time in ISO 8601 format"),
          description: z
            .string()
            .optional()
            .describe("Event description"),
          location: z
            .string()
            .optional()
            .describe("Event location"),
        }),
        execute: async ({
          calendarId,
          summary,
          startTime,
          endTime,
          description,
          location,
        }) => {
          const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
          const body: any = {
            summary,
            start: { dateTime: startTime },
            end: { dateTime: endTime },
          };
          if (description) body.description = description;
          if (location) body.location = location;

          const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });
          if (!res.ok)
            return `Calendar API error: request failed (${res.status})`;
          const event = await res.json();
          return `Created event "${event.summary}" (${event.htmlLink})`;
        },
      }),
    };
  },
};
