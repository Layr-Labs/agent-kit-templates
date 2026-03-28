import { tool } from "ai";
import { z } from "zod";
import type { IntegrationDefinition, IntegrationContext } from "./types.js";

export const gmail: IntegrationDefinition = {
  id: "gmail",
  name: "Gmail",
  description: "Read and send emails through your Gmail account",
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
      gmail_list_messages: tool({
        description:
          "List recent emails from the user's Gmail inbox",
        inputSchema: z.object({
          query: z
            .string()
            .optional()
            .default("")
            .describe("Gmail search query (e.g., 'from:boss subject:meeting')"),
          maxResults: z
            .number()
            .optional()
            .default(10)
            .describe("Maximum number of messages to return"),
        }),
        execute: async ({ query, maxResults }) => {
          const url = new URL(
            "https://www.googleapis.com/gmail/v1/users/me/messages"
          );
          if (query) url.searchParams.set("q", query);
          url.searchParams.set("maxResults", String(maxResults));

          const listRes = await fetch(url.toString(), { headers });
          if (!listRes.ok)
            return `Gmail API error: request failed (${listRes.status})`;
          const listData = await listRes.json();
          const messageIds = (listData.messages ?? []) as Array<{ id: string }>;
          if (!messageIds.length) return "No messages found.";

          // Fetch metadata for each message
          const messages = await Promise.all(
            messageIds.slice(0, maxResults).map(async (m) => {
              const res = await fetch(
                `https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
                { headers }
              );
              if (!res.ok) return null;
              const msg = await res.json();
              const hdrs = (msg.payload?.headers ?? []) as Array<{
                name: string;
                value: string;
              }>;
              const get = (name: string) =>
                hdrs.find((h) => h.name === name)?.value ?? "";
              return `- [${get("Date")}] From: ${get("From")} — ${get("Subject")}`;
            })
          );

          return messages.filter(Boolean).join("\n") || "No messages found.";
        },
      }),

      gmail_send_message: tool({
        description: "Send an email from the user's Gmail account",
        inputSchema: z.object({
          to: z.string().describe("Recipient email address"),
          subject: z.string().describe("Email subject"),
          body: z.string().describe("Email body (plain text)"),
        }),
        execute: async ({ to, subject, body }) => {
          // Build RFC 2822 message
          const rawMessage = [
            `To: ${to}`,
            `Subject: ${subject}`,
            "Content-Type: text/plain; charset=utf-8",
            "",
            body,
          ].join("\r\n");
          const encoded = Buffer.from(rawMessage)
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");

          const res = await fetch(
            "https://www.googleapis.com/gmail/v1/users/me/messages/send",
            {
              method: "POST",
              headers,
              body: JSON.stringify({ raw: encoded }),
            }
          );
          if (!res.ok) return `Gmail API error: request failed (${res.status})`;
          const sent = await res.json();
          return `Email sent to ${to} (message ID: ${sent.id})`;
        },
      }),

      gmail_read_email: tool({
        description:
          "Read the full content of a specific email by its message ID. Returns headers, body text, and attachment info.",
        inputSchema: z.object({
          messageId: z.string().describe("Gmail message ID"),
        }),
        execute: async ({ messageId }) => {
          const res = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
            { headers }
          );
          if (!res.ok)
            return `Gmail API error: request failed (${res.status})`;
          const msg = await res.json();
          const hdrs = (msg.payload?.headers ?? []) as Array<{
            name: string;
            value: string;
          }>;
          const get = (name: string) =>
            hdrs.find(
              (h) => h.name.toLowerCase() === name.toLowerCase()
            )?.value ?? "";

          // Extract body text
          const extractText = (part: any): string => {
            if (
              part.mimeType === "text/plain" &&
              part.body?.data
            ) {
              return Buffer.from(
                part.body.data,
                "base64url"
              ).toString("utf-8");
            }
            if (part.parts) {
              return part.parts
                .map(extractText)
                .filter(Boolean)
                .join("\n");
            }
            return "";
          };
          const body = extractText(msg.payload);

          const attachments = (msg.payload?.parts ?? [])
            .filter(
              (p: any) => p.filename && p.filename.length > 0
            )
            .map(
              (p: any) => `\u{1F4CE} ${p.filename} (${p.mimeType})`
            );

          return [
            `**From:** ${get("From")}`,
            `**To:** ${get("To")}`,
            `**Date:** ${get("Date")}`,
            `**Subject:** ${get("Subject")}`,
            attachments.length
              ? `**Attachments:** ${attachments.join(", ")}`
              : "",
            "",
            body || "(no text content)",
          ]
            .filter((s) => s !== undefined)
            .join("\n");
        },
      }),

      gmail_search_emails: tool({
        description:
          "Search emails using Gmail search syntax. Supports queries like 'from:alice subject:meeting after:2026/03/01 has:attachment'.",
        inputSchema: z.object({
          query: z.string().describe("Gmail search query"),
          maxResults: z.number().optional().default(10),
        }),
        execute: async ({ query, maxResults }) => {
          const url = new URL(
            "https://www.googleapis.com/gmail/v1/users/me/messages"
          );
          url.searchParams.set("q", query);
          url.searchParams.set("maxResults", String(maxResults));
          const listRes = await fetch(url.toString(), { headers });
          if (!listRes.ok)
            return `Gmail API error: request failed (${listRes.status})`;
          const listData = await listRes.json();
          const messageIds = (listData.messages ?? []) as Array<{
            id: string;
          }>;
          if (!messageIds.length)
            return "No messages matched your search.";

          const messages = await Promise.all(
            messageIds.slice(0, maxResults).map(async (m) => {
              const res = await fetch(
                `https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
                { headers }
              );
              if (!res.ok) return null;
              const msg = await res.json();
              const hds = (msg.payload?.headers ?? []) as Array<{
                name: string;
                value: string;
              }>;
              const get = (name: string) =>
                hds.find((h) => h.name === name)?.value ?? "";
              return `- **${get("Subject")}** — from ${get("From")} (${get("Date")}) [id: ${m.id}]`;
            })
          );
          return (
            messages.filter(Boolean).join("\n") ||
            "No messages found."
          );
        },
      }),

      gmail_list_labels: tool({
        description:
          "List all Gmail labels (folders) for the user's account.",
        inputSchema: z.object({}),
        execute: async () => {
          const res = await fetch(
            "https://www.googleapis.com/gmail/v1/users/me/labels",
            { headers }
          );
          if (!res.ok)
            return `Gmail API error: request failed (${res.status})`;
          const data = await res.json();
          const labels = (data.labels ?? []) as Array<{
            id: string;
            name: string;
            type: string;
          }>;
          return (
            labels
              .map(
                (l) => `- ${l.name} (${l.type}) [id: ${l.id}]`
              )
              .join("\n") || "No labels found."
          );
        },
      }),

      gmail_get_thread: tool({
        description:
          "Get all messages in an email thread/conversation.",
        inputSchema: z.object({
          threadId: z.string().describe("Gmail thread ID"),
        }),
        execute: async ({ threadId }) => {
          const res = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            { headers }
          );
          if (!res.ok)
            return `Gmail API error: request failed (${res.status})`;
          const thread = await res.json();
          const messages = (thread.messages ?? []) as Array<any>;
          return (
            messages
              .map((msg) => {
                const hds = (msg.payload?.headers ?? []) as Array<{
                  name: string;
                  value: string;
                }>;
                const get = (name: string) =>
                  hds.find((h) => h.name === name)?.value ?? "";
                return `- [${get("Date")}] **${get("From")}**: ${get("Subject")} [id: ${msg.id}]`;
              })
              .join("\n") || "Empty thread."
          );
        },
      }),
    };
  },
};
