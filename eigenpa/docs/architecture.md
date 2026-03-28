# Architecture

## System Overview

EigenPA is a multi-tenant personal assistant where each user gets a fully isolated, encrypted database. There is no shared data layer between users — isolation is physical (one file per wallet), not logical (no `WHERE user_id =` to get wrong).

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser                                    │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  React SPA (Vite)                                             │  │
│  │                                                               │  │
│  │  1. Connect Wallet  →  RainbowKit / wagmi                     │  │
│  │  2. SIWE Sign-In    →  Proves wallet ownership                │  │
│  │  3. Key Derivation  →  Deterministic sig → HKDF → enc key    │  │
│  │  4. Chat UI         →  POST /api/chat { prompt }              │  │
│  └──────────────────────────────┬────────────────────────────────┘  │
└─────────────────────────────────┼───────────────────────────────────┘
                                  │  Cookie: session (sealed, contains enc key)
┌─────────────────────────────────▼───────────────────────────────────┐
│                    Docker Container                                  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    Fastify Server (:3000)                      │  │
│  │                                                                │  │
│  │  /api/auth/nonce    GET   → generate SIWE nonce               │  │
│  │  /api/auth/verify   POST  → verify SIWE signature             │  │
│  │  /api/auth/unlock   POST  → derive enc key from wallet sig    │  │
│  │  /api/auth/logout   POST  → destroy session, close DB conn    │  │
│  │  /api/auth/me       GET   → return current session state      │  │
│  │  /api/chat          POST  → run agent, return response        │  │
│  │  /api/data          DEL   → delete user's entire database     │  │
│  │  /api/health        GET   → liveness probe                    │  │
│  │  /*                 GET   → serve React SPA                   │  │
│  └────────────────────────┬───────────────────────────────────────┘  │
│                           │                                          │
│  ┌────────────────────────▼───────────────────────────────────────┐  │
│  │              PersonalAssistant (Agent Orchestrator)            │  │
│  │                                                                │  │
│  │  1. Load structured memories from user's DB                   │  │
│  │  2. Embed query via Voyage AI → vector search user's DB       │  │
│  │  3. Load conversation history from user's DB                  │  │
│  │  4. Build system prompt: SOUL.md + constitution + memories    │  │
│  │  5. Run Vercel AI SDK generateText() with tools               │  │
│  │  6. Persist conversation + embed exchange                     │  │
│  └────────────────────────┬───────────────────────────────────────┘  │
│                           │                                          │
│  ┌────────────────────────▼───────────────────────────────────────┐  │
│  │              DBRouter (Encrypted Connection Manager)           │  │
│  │                                                                │  │
│  │  address + encKey  →  Turso Database(path, { encryption })    │  │
│  │  Connection cache  →  Map<address, Database>                  │  │
│  │  On logout         →  close() + evict from cache              │  │
│  └────────────────────────┬───────────────────────────────────────┘  │
│                           │                                          │
│  ┌────────────────────────▼───────────────────────────────────────┐  │
│  │  /mnt/disks/userdata/          (mounted volume)                │  │
│  │                                                                │  │
│  │  ┌──────────────────┐  ┌──────────────────┐                   │  │
│  │  │ 0x1a2b...db      │  │ 0xaabb...db      │  ...             │  │
│  │  │ AEGIS-256 enc    │  │ AEGIS-256 enc    │                   │  │
│  │  │ ┌──────────────┐ │  │ ┌──────────────┐ │                   │  │
│  │  │ │ memories     │ │  │ │ memories     │ │                   │  │
│  │  │ │ conversations│ │  │ │ conversations│ │                   │  │
│  │  │ │ embeddings   │ │  │ │ embeddings   │ │                   │  │
│  │  │ └──────────────┘ │  │ └──────────────┘ │                   │  │
│  │  └──────────────────┘  └──────────────────┘                   │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Map

| Component | File | Responsibility |
|-----------|------|----------------|
| Entry point | `src/main.ts` | Bootstrap server |
| Fastify server | `src/server/index.ts` | HTTP routing, static serving, rate limiting |
| Auth | `src/server/auth.ts` | SIWE verification, key derivation, session management |
| Agent orchestrator | `src/agent/assistant.ts` | Agentic loop: memories → retrieval → LLM → persist |
| User tools | `src/agent/tools.ts` | `save_memory`, `recall_memories`, `search_history` |
| DB router | `src/db/router.ts` | Encrypted connection lifecycle (open, cache, close, delete) |
| Schema | `src/db/schema.ts` | Table definitions (memories, conversations, embeddings) |
| Vector helpers | `src/db/vector.ts` | `vectorSearch()`, `embedAndStore()` |
| Config loader | `src/config/index.ts` | Parse `config.toml`, env var overrides |
| React SPA | `site/src/` | Wallet gate, chat UI |

## Request Lifecycle

```
Browser: POST /api/chat { prompt: "What's my name?" }
Cookie: eigenpa_session=<iron-sealed blob>
         │
         ▼
Fastify: unseal cookie → { address: "0x1a2B...", encKey: "7f3a..." }
         │
         ▼
PersonalAssistant.handleMessage("0x1a2B...", "7f3a...", "What's my name?")
         │
         ├─ DBRouter.getConnection("0x1a2B...", "7f3a...")
         │  └─ new Database("/mnt/disks/userdata/0x1a2b...db", { encryption: { cipher: "aegis256", hexkey: "7f3a..." } })
         │
         ├─ SELECT key, value FROM memories
         │  └─ "name: Jordan, role: engineer, tone: concise"
         │
         ├─ voyage.embed("What's my name?") → vector
         │  └─ vectorSearch(db, vector, 5) → relevant past exchanges
         │
         ├─ SELECT role, content FROM conversations (last 20)
         │
         ├─ generateText({ model: claude, system: soul+constitution+memories+context, messages, tools })
         │  └─ Claude may call save_memory, recall_memories, search_history
         │  └─ Up to 10 tool-use steps
         │
         ├─ INSERT INTO conversations (user message + assistant response)
         │
         └─ voyage.embed(exchange) → embedAndStore()

         │
         ▼
Response: { response: "Your name is Jordan." }
```

## Database Schema

Each user's `.db` file contains three tables:

### `memories`
Structured key-value facts the agent learns about the user.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key |
| key | TEXT | Unique label (e.g., "name", "timezone") |
| value | TEXT | The fact |
| created_at | TEXT | ISO datetime |
| updated_at | TEXT | ISO datetime, updated on upsert |

### `conversations`
Full message history, grouped by session.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key |
| session_id | TEXT | Groups messages (currently = eth address) |
| role | TEXT | `user`, `assistant`, `system`, or `tool` |
| content | TEXT | Message text |
| created_at | TEXT | ISO datetime |

### `embeddings`
Vector store for semantic retrieval (RAG over past interactions).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key |
| content | TEXT | The text that was embedded |
| embedding | BLOB | `vector32(...)` — float32 vector |
| metadata | TEXT | JSON blob (source type, session, etc.) |
| created_at | TEXT | ISO datetime |

## Technology Stack

| Layer | Technology | Package |
|-------|-----------|---------|
| Runtime | Bun | `oven/bun:1` |
| LLM | Claude (Anthropic) | `@ai-sdk/anthropic`, `ai` |
| Embeddings | Voyage AI | `voyageai` |
| Web server | Fastify | `fastify`, `@fastify/static`, `@fastify/rate-limit` |
| Database | Turso (local, encrypted) | `@tursodatabase/database` |
| Vector search | Turso native | `vector32()`, `vector_distance_cos()` |
| Auth | SIWE (EIP-4361) | `siwe`, `iron-session`, `viem` |
| Key derivation | HKDF-SHA256 | `@noble/hashes` |
| Frontend | React + Vite | `react`, `vite`, `wagmi`, `@rainbow-me/rainbowkit` |
| Config | TOML | `smol-toml` |
| Container | Docker | `FROM oven/bun:1` |
