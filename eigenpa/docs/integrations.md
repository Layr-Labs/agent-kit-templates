# Integrations

## Overview

EigenPA supports a plugin-style integration system that lets users progressively grant the agent access to external services — email, calendar, and any future integrations. Users enable integrations through the API, provide credentials, and the agent gains new tools it can use during conversations.

**Key design principles:**

- **Integration config** (which integrations are enabled, per-integration settings) is stored in the user's **encrypted database**.
- **Credentials** (OAuth tokens, API keys) are stored in the **session cookie** — never on disk.
- **Tool assembly** is dynamic — the agent's available tools change based on what the user has enabled.

## Data Model

```
┌───────────────────────────────────────────────────────────┐
│  User's Encrypted Database                                │
│                                                           │
│  integrations table                                       │
│  ┌────────────────┬─────────┬───────────────────────────┐ │
│  │ integration_id │ enabled │ config                    │ │
│  ├────────────────┼─────────┼───────────────────────────┤ │
│  │ google-calendar│    1    │ {"calendar_id":"primary"} │ │
│  │ gmail          │    1    │ {}                        │ │
│  └────────────────┴─────────┴───────────────────────────┘ │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│  Session Cookie (iron-session sealed)                     │
│                                                           │
│  {                                                        │
│    address: "0x...",                                      │
│    encKey: "7f3a...",                                     │
│    integrationCredentials: {                              │
│      "google-calendar": {                                 │
│        "access_token": "ya29...",                         │
│        "refresh_token": "1//..."                          │
│      },                                                   │
│      "gmail": {                                           │
│        "access_token": "ya29...",                         │
│        "refresh_token": "1//..."                          │
│      }                                                    │
│    }                                                      │
│  }                                                        │
└───────────────────────────────────────────────────────────┘
```

## How Tool Assembly Works

On every chat request, the agent assembles its tool set dynamically:

```
 POST /api/chat { prompt }
        │
        ▼
 Read session → { address, encKey, integrationCredentials }
        │
        ▼
 Open encrypted DB → read `integrations` table (enabled rows)
        │
        ├─ google-calendar: enabled, config = { calendar_id: "primary" }
        ├─ gmail: enabled, config = {}
        │
        ▼
 For each enabled integration:
   1. Look up definition in registry
   2. Pull credentials from session
   3. Call createTools({ credentials, config })
        │
        ▼
 Merge: base tools + integration tools
   save_memory, recall_memories, search_history   ← always available
   calendar_list_events, calendar_create_event    ← from google-calendar
   gmail_list_messages, gmail_send_message        ← from gmail
        │
        ▼
 generateText({ tools: allTools, ... })
```

Integrations with no credentials in the session are silently skipped — they're enabled in the DB but the user hasn't provided tokens yet (or the session expired).

## API Endpoints

### `GET /api/integrations`

List all available integrations with their enable state for the current user.

**Response:**
```json
{
  "integrations": [
    {
      "id": "google-calendar",
      "name": "Google Calendar",
      "description": "Read and create events on your Google Calendar",
      "credentialFields": [
        { "key": "access_token", "label": "Google OAuth Access Token", "secret": true },
        { "key": "refresh_token", "label": "Google OAuth Refresh Token", "secret": true }
      ],
      "enabled": true,
      "hasCredentials": true
    },
    {
      "id": "gmail",
      "name": "Gmail",
      "description": "Read and send emails through your Gmail account",
      "credentialFields": [...],
      "enabled": false,
      "hasCredentials": false
    }
  ]
}
```

### `POST /api/integrations/enable`

Enable an integration and store its credentials.

**Body:**
```json
{
  "integrationId": "google-calendar",
  "credentials": {
    "access_token": "ya29...",
    "refresh_token": "1//..."
  },
  "config": {
    "calendar_id": "primary"
  }
}
```

- `integrationId` → looked up in the registry
- `credentials` → stored in the session cookie (never on disk)
- `config` → stored in the user's encrypted DB

### `POST /api/integrations/disable`

Disable an integration. Removes credentials from the session but keeps the DB row (can be re-enabled).

**Body:**
```json
{
  "integrationId": "google-calendar"
}
```

### `POST /api/integrations/remove`

Remove an integration entirely — deletes the DB row and removes credentials from the session.

**Body:**
```json
{
  "integrationId": "google-calendar"
}
```

## Available Integrations

### Google Calendar

| Tool | Description |
|------|-------------|
| `calendar_list_events` | List upcoming events with time range and count filters |
| `calendar_create_event` | Create new events with title, time, and description |

**Credentials:** Google OAuth `access_token` + `refresh_token`
**Config:** `calendar_id` (default: `"primary"`)

### Gmail

| Tool | Description |
|------|-------------|
| `gmail_list_messages` | Search and list emails with Gmail query syntax |
| `gmail_send_message` | Send emails with to, subject, and body |

**Credentials:** Google OAuth `access_token` + `refresh_token`

## Adding a New Integration

1. Create a file in `src/integrations/` (e.g., `slack.ts`)
2. Implement the `IntegrationDefinition` interface:

```typescript
import { tool } from "ai";
import { z } from "zod";
import type { IntegrationDefinition, IntegrationContext } from "./types.js";

export const slack: IntegrationDefinition = {
  id: "slack",
  name: "Slack",
  description: "Send messages and read channels in Slack",
  credentialFields: [
    { key: "bot_token", label: "Slack Bot Token", secret: true },
  ],
  createTools(ctx: IntegrationContext) {
    return {
      slack_send_message: tool({
        description: "Send a message to a Slack channel",
        parameters: z.object({
          channel: z.string(),
          text: z.string(),
        }),
        execute: async ({ channel, text }) => {
          // Use ctx.credentials.bot_token to call Slack API
          // ...
        },
      }),
    };
  },
};
```

3. Register it in `src/integrations/registry.ts`:

```typescript
import { slack } from "./slack.js";

const ALL_INTEGRATIONS: IntegrationDefinition[] = [
  googleCalendar,
  gmail,
  slack, // ← add here
];
```

That's it. The integration automatically appears in `GET /api/integrations` and its tools are available to the agent when the user enables it.

## Security Properties

| Property | Mechanism |
|----------|-----------|
| Credentials never on disk | Stored only in sealed session cookie |
| Credentials scoped to session | Session expiry → credentials gone → integration tools unavailable |
| Config encrypted at rest | Stored in user's AEGIS-256 encrypted database |
| No cross-user credential access | Physical DB isolation + per-session credential storage |
| Integration tools scoped to user | Tools created per-request with that user's credentials |
