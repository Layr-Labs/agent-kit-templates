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
        parameters: z.object({
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
        parameters: z.object({
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
    };
  },
};
