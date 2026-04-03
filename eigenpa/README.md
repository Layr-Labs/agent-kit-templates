# EigenPA

**A multi-tenant personal assistant with individualized learning — secured by your Ethereum wallet.**

EigenPA gives every user their own encrypted database, a memory system that learns their preferences over time, and a growing set of integrations (calendar, email, GitHub) — all unlocked by a single wallet connection. No accounts, no emails, no trust assumptions. Not even the server operator can read your data.

```
  You: "Remember that I prefer TypeScript over Python"
  PA:  Done. I'll keep that in mind.

  ... 3 weeks later ...

  You: "Write me a quick HTTP server"
  PA:  Here's a TypeScript server using Hono: ...
```

## How Multi-Tenancy Works

EigenPA achieves physical data isolation between users. Each wallet address gets its own SQLite database file on disk, encrypted with a key that only that wallet can derive. There is no shared database, no row-level access control, and no trust-the-server security model.

### Authentication: Two Signatures, Zero Gas

```
Connect Wallet ──► Sign In (SIWE) ──► Sign Key Derivation Message ──► Chat
      │                  │                        │                       │
  RainbowKit        EIP-4361 +               Deterministic            Agent opens
                    server nonce             message (no nonce)      encrypted DB
      │                  │                        │                       │
      ▼                  ▼                        ▼                       ▼
  Proves wallet     Session cookie           HKDF-SHA256 derives     Turso loads
  ownership         created                  256-bit encryption key   user's .db file
```

1. **SIWE (EIP-4361)** — The user signs a nonce-bearing message, proving wallet ownership. The server verifies the signature and creates a session.
2. **Key derivation** — The user signs a second, deterministic message (no nonce, always identical for a given wallet). The server runs `HKDF-SHA256(signature, address_salt, "turso-db-key", 32)` to derive a 256-bit encryption key. This key is sealed into the session cookie via `iron-session` and never written to disk.

The encryption key is deterministic: the same wallet will always produce the same key, so a user can log out, clear cookies, and log back in — their data is still there, decryptable.

### Encryption: AEGIS-256 at the Page Level

Each user's database is a standalone `.db` file encrypted with Turso's AEGIS-256 cipher. Encryption happens at the database page level — the file is opaque on disk without the key.

| Property | Implementation |
|----------|---------------|
| Encryption at rest | Turso AEGIS-256, per-page encryption |
| Key storage | Sealed in client-held `iron-session` cookie only |
| Key derivation | HKDF-SHA256 from deterministic wallet signature |
| Cross-user isolation | Physical — separate `.db` files per wallet address |
| Data deletion | `rm {address}.db` |
| Lost wallet | Lost data. No backdoor. No recovery. By design. |

### Constitution: Immutable Safety Boundaries

A `constitution.md` file defines platform rules the agent cannot override:

- Never expose, log, or transmit encryption keys or secrets
- Never access or reference data belonging to other users
- All user data scoped exclusively to the authenticated user's database
- Agent cannot modify its own constitution or system prompts

## How Personalization Works

EigenPA builds an evolving understanding of each user through three complementary systems, all stored in the user's encrypted database:

### 1. Explicit Memory (Key-Value)

The agent has `save_memory` and `recall_memories` tools. When a user shares a preference, fact, or instruction, the agent stores it as a key-value pair:

```
name       → Jordan
timezone   → America/Chicago
code_style → Prefers TypeScript, functional patterns, minimal dependencies
```

On each request, relevant memories are selected via keyword scoring against the current query and injected into the system prompt. When there are 5 or fewer memories, all are included. Beyond that, a BM25-inspired keyword match selects the most relevant subset.

### 2. Semantic Retrieval (Vector Search)

Every conversation exchange is embedded via Voyage AI (`voyage-3`) and stored in the user's `embeddings` table. On each request, the user's query is embedded and compared against stored vectors using cosine distance. The top 5 most semantically relevant past exchanges are injected as context.

This gives the agent recall of *how* it helped in the past — not just explicit facts, but the full shape of prior conversations.

### 3. Conversation History

The full message history is stored in the `conversations` table. For context efficiency, the system summarizes older messages (beyond the most recent 6) into a compact block, keeping the immediate conversation fresh while preserving continuity.

### Per-User Database Schema

| Table | Purpose | Example |
|-------|---------|---------|
| `memories` | Key-value facts the agent learns | `name → Jordan`, `tz → America/Chicago` |
| `conversations` | Full message history | Every user/assistant exchange |
| `embeddings` | Vector store for semantic recall | Past exchanges embedded via Voyage AI |
| `integrations` | Enabled services + config | `google-calendar → enabled` |
| `scheduled_tasks` | Recurring background tasks | `daily_briefing → 0 8 * * *` |

## Integrations

Users progressively enable integrations that give the agent new capabilities. The agent prompts for connection when a tool is needed — users never need to pre-configure anything.

| Integration | Tools | Auth |
|-------------|-------|------|
| **Google Calendar** | List calendars, list/create/search events, check free/busy | OAuth 2.0 |
| **Gmail** | List/read/search/send emails, list labels, get threads | OAuth 2.0 |
| **GitHub** | Repos, issues, PRs, commits, diffs, reviews, code search, file browsing (read-only) | OAuth 2.0 |
| **Web Search** | Real-time web search via Anthropic's native tool | Built-in |
| **Scheduled Tasks** | Create/manage recurring background tasks via cron | Built-in |

Integration config is stored in the user's encrypted DB. OAuth credentials live only in the session cookie — never on disk.

### Generative UI: Dynamic OAuth Flow

Integration login is handled entirely through generative UI — the agent never tells users to "go connect Google Calendar in settings." Instead, when the agent needs an integration the user hasn't connected yet, it calls the `show_integration_signin` tool, which returns structured data that the frontend renders as an inline OAuth button directly in the chat:

```
User: "What's on my calendar today?"

  ┌─────────────────────────────────────────────┐
  │  🔗 Connect Google Calendar                  │
  │  I need calendar access to check your agenda │
  │  [Sign in with Google]                       │
  └─────────────────────────────────────────────┘
```

The flow works end-to-end without leaving the chat:

1. **Agent calls `show_integration_signin`** — returns `{ integrationId, name, reason, oauthUrl }`
2. **Frontend renders `<OAuthButton>`** — an inline button with the agent's reason for needing access
3. **User clicks** — a popup opens to the OAuth provider (Google, GitHub)
4. **OAuth callback** — the popup exchanges the auth code for tokens, stores them in the session cookie, enables the integration in the user's DB, and sends a `postMessage` back to the parent window
5. **Auto-resume** — the `<OAuthButton>` component listens for the `postMessage`, then automatically sends a follow-up chat message ("I just connected google-calendar. Please continue with...") so the agent retries the original request with the new credentials

The same generative UI pattern is used for other interactive components: `request_location` renders a geolocation button, `show_calendar_agenda` renders a visual timeline, `show_email_inbox` renders an inbox list, and so on. Each is a tool that returns structured data, mapped to a React component on the frontend.

### Adding Integrations

Create a file in `src/integrations/`, implement the `IntegrationDefinition` interface, and register it in `registry.ts`. The system handles OAuth flow, credential storage, and tool assembly automatically.

### Background Tasks and the TEE KeyVault

Users can delegate background execution to the agent for recurring tasks (e.g., "send me a daily briefing at 8am"). This creates a security challenge: the agent needs the user's database encryption key and integration tokens to run tasks when the user isn't actively logged in.

EigenPA solves this with a **TEE-resident in-memory KeyVault**:

```
User delegates ──► KeyVault.store() ──► In-memory Map (TEE-encrypted RAM)
                        │
                        │  encKey + integrationCredentials + delegatedAt
                        │
Scheduler tick  ──► KeyVault.get() ──► Opens DB, runs task with user's credentials
```

| Property | Implementation |
|----------|---------------|
| Storage | In-memory `Map` only — never written to disk |
| Protection | TEE hardware-encrypted RAM — invisible to host OS and cloud operator |
| Contents | Database encryption key + OAuth tokens per delegated user |
| Eviction | Cleared on process restart — users must re-delegate |
| Revocation | User calls `POST /api/delegate/revoke` → `KeyVault.delete()` removes keys immediately |

The scheduler runs on a 60-second tick. For each delegated user, it reads their `scheduled_tasks` table, evaluates cron expressions, and executes due tasks using `generateText` with the user's full tool set (including integration tools backed by the delegated OAuth tokens).

The trade-off is explicit: delegated keys are lost on server restart. Users who want background tasks must re-authorize after a reboot. This is preferable to persisting keys on disk, which would break the "key never on server disk" guarantee.

## Token Efficiency

EigenPA implements several optimizations to minimize token usage and latency:

| # | Optimization | How |
|---|-------------|-----|
| 1 | **Tool search** | Core tools always loaded; integration/schedule tools loaded on-demand via a custom BM25 search tool that returns `tool_reference` blocks |
| 2 | **Conversation summarization** | Messages beyond the 6 most recent are summarized into a compact block (~200 chars each) |
| 3 | **Lazy tool registration** | Integration tools only assembled when the user has active credentials |
| 4 | **Dynamic system prompt** | Only non-empty sections (memories, context, integrations) included |
| 5 | **Embedding-based memory selection** | Keyword-scored top-k memory retrieval instead of dumping all memories |
| 6 | **Prompt caching** | Static system prompt prefix (SOUL + constitution) separated from dynamic sections for Anthropic's automatic caching |

## Running Locally

### Prerequisites

- [Bun](https://bun.sh) v1+
- An [Anthropic API key](https://console.anthropic.com/)
- A [Voyage AI API key](https://dash.voyageai.com/)
- A [WalletConnect project ID](https://cloud.walletconnect.com/) (free)

### Setup

```bash
cd eigenpa
cp .env.example .env
```

Fill in your `.env`:

```bash
SESSION_SECRET=any-string-at-least-32-characters-long
ANTHROPIC_API_KEY=sk-ant-...
VOYAGEAI_API_KEY=pa-...
VITE_WC_PROJECT_ID=your-project-id
```

### Development

```bash
bun install
bun run dev
```

This builds the React frontend and starts the Fastify server with file watching. Open `http://localhost:3000`, connect your wallet, and start chatting.

For frontend-only development with hot reload:

```bash
bun run site:dev
```

This starts Vite's dev server with a proxy to the API server (which must be running separately).

### Testing

```bash
bun test              # All tests (114 server + 10 UI)
bun run test:server   # Server tests only
bun run test:ui       # UI tests only (jsdom)
bun run test:coverage # With coverage report
```

### Docker

```bash
cp .env.example .env
# Fill in your API keys

docker compose up --build
```

User databases are stored at `/mnt/disks/userdata` inside the container, mounted as a persistent volume.

## Configuration

### `config.toml`

```toml
[models]
chat = "claude-haiku-4-5-20251001"    # LLM for interactive chat
task = "claude-haiku-4-5-20251001"    # LLM for background scheduled tasks
embed = "voyage-3"                     # Embedding model for semantic search

[server]
port = 3000

[session]
cookie_name = "eigenpa_session"
ttl_hours = 72                         # Session lifetime

[encryption]
cipher = "aegis256"                    # Turso encryption cipher

[data]
dir = "/mnt/disks/userdata"            # Where encrypted .db files live
```

### `SOUL.md`

The agent's personality. Edit this to change how EigenPA talks, what it prioritizes, and how it presents itself. Loaded into the system prompt on every request.

### `constitution.md`

Immutable safety boundaries. Platform rules that the agent cannot override — data isolation, key handling, impersonation prevention.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SECRET` | Yes | 32+ char secret for sealing session cookies |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `VOYAGEAI_API_KEY` | Yes | Voyage AI API key for embeddings |
| `VITE_WC_PROJECT_ID` | Yes | WalletConnect project ID |
| `DATA_DIR` | No | Override database storage path (default: from `config.toml`) |
| `CONFIG_TOML_B64` | No | Base64-encoded config.toml (for containerized deploys) |
| `SOUL_MD_B64` | No | Base64-encoded SOUL.md |
| `CONSTITUTION_MD_B64` | No | Base64-encoded constitution.md |

## Project Structure

```
eigenpa/
├── config.toml              # Model routing, server config, encryption settings
├── SOUL.md                  # Agent personality
├── constitution.md          # Safety boundaries (immutable)
├── template.json            # Deployment manifest
├── Dockerfile               # Bun multi-stage build
├── docker-compose.yml       # Volume mount + env vars
├── src/
│   ├── main.ts              # Entry point
│   ├── server/
│   │   ├── index.ts         # Fastify: routes, SSE streaming, rate limiting
│   │   ├── auth.ts          # SIWE + HKDF key derivation + session management
│   │   └── oauth.ts         # Google OAuth flow (popup-based)
│   ├── agent/
│   │   ├── assistant.ts     # Core loop: memories → retrieval → Claude → persist
│   │   ├── tools.ts         # save_memory, recall_memories, search_history
│   │   ├── ui-tools.ts      # Generative UI tools (OAuth, calendar, email, etc.)
│   │   ├── schedule-tools.ts # Scheduled task CRUD
│   │   └── tool-search.ts   # BM25 tool search with deferred loading
│   ├── db/
│   │   ├── router.ts        # Encrypted connection manager (per-user)
│   │   ├── schema.ts        # Table definitions (5 tables)
│   │   └── vector.ts        # vectorSearch(), embedAndStore()
│   ├── integrations/
│   │   ├── types.ts          # IntegrationDefinition interface
│   │   ├── registry.ts       # google-calendar, gmail, github
│   │   ├── manager.ts        # Enable/disable/remove, assemble tools
│   │   ├── google-calendar.ts
│   │   ├── gmail.ts
│   │   └── github.ts
│   ├── vault/
│   │   └── keyvault.ts      # TEE-resident in-memory key store
│   ├── scheduler/
│   │   ├── index.ts          # Cron scheduler (60s tick)
│   │   └── cron.ts           # Cron expression parser
│   └── config/
│       └── index.ts          # TOML loader with env var overrides
├── site/
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx           # React entry + providers
│       ├── App.tsx            # Session persistence + wallet gate
│       └── components/
│           ├── WalletGate.tsx   # Connect + SIWE + key derivation
│           ├── Chat.tsx         # Chat interface with tool rendering
│           ├── Markdown.tsx     # react-markdown with remark-gfm
│           ├── OAuthButton.tsx  # OAuth popup flow
│           ├── LocationButton.tsx
│           ├── CalendarAgenda.tsx
│           ├── EmailInbox.tsx
│           ├── EmailDetail.tsx
│           ├── GitHubRepoCard.tsx
│           ├── GitHubIssueList.tsx
│           ├── ScheduledTaskList.tsx
│           └── SettingsPanel.tsx  # Integration management
└── docs/
    ├── architecture.md
    ├── encryption.md
    ├── authentication.md
    └── personalization.md
```

## Known Limitations

| # | Limitation | Notes |
|---|-----------|-------|
| 1 | **No ANN vector index** | Brute-force cosine search. Fine for <50k embeddings per user. |
| 2 | **Single-process only** | Turso doesn't support multi-process access to the same file. |
| 3 | **Lost wallet = lost data** | No key escrow or recovery. By design. |
| 4 | **Key eviction on restart** | Delegated keys for background tasks are held in-memory. Server restart requires re-delegation. |
| 5 | **Two signatures on login** | Both gasless `personal_sign` — sub-second each. |
| 6 | **OAuth client credentials required** | Google Calendar, Gmail, and GitHub integrations require the *operator* to register OAuth apps and provide client IDs/secrets. This is a barrier to agent autonomy — a fully sovereign agent can't provision its own OAuth credentials, because Google and GitHub require human identity verification, domain ownership, and consent screen approval. The agent depends on its operator for third-party API access, which limits how self-sufficiently it can expand its own capabilities. |

## License

MIT
