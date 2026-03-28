# EigenPA

Multi-tenant personal assistant with Ethereum wallet auth and encrypted per-user Turso databases.

## Quick Reference

- **Runtime**: Bun
- **Server**: Fastify (`src/server/index.ts`)
- **Agent**: Vercel AI SDK `generateText()` with tool calling (`src/agent/assistant.ts`)
- **LLM**: Claude via `@ai-sdk/anthropic`
- **Embeddings**: Voyage AI (`voyageai` SDK)
- **Database**: Turso (local, `@tursodatabase/database`) — one encrypted `.db` file per user
- **Auth**: SIWE (EIP-4361) + HKDF key derivation
- **Frontend**: React + Vite + wagmi + RainbowKit (`site/`)
- **Config**: `config.toml` (parsed by `smol-toml`)

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full system diagram and component map.

**Data flow**: Browser → Fastify → unseal session cookie → DBRouter opens encrypted DB → PersonalAssistant runs agentic loop → response.

**Key invariant**: User databases are always encrypted on disk. The encryption key exists only in the sealed session cookie. See [docs/encryption.md](docs/encryption.md).

## Commands

```bash
bun install              # Install dependencies
bun run dev              # Dev mode (builds site, watches server)
bun run start            # Production start
bun run typecheck        # Type-check server code
bun run site:build       # Build React SPA
bun run site:dev         # Vite dev server for frontend (with API proxy)
bun test                 # Run tests
```

## Key Files

| File | What it does |
|------|-------------|
| `src/main.ts` | Entry point — bootstraps Fastify server |
| `src/server/auth.ts` | SIWE nonce/verify/unlock/logout + HKDF key derivation |
| `src/server/index.ts` | Fastify routes: `/api/chat`, `/api/data`, `/api/health`, static SPA |
| `src/agent/assistant.ts` | Agentic loop: load memories → vector search → generateText → persist |
| `src/agent/tools.ts` | `save_memory`, `recall_memories`, `search_history` (all scoped to user DB) |
| `src/db/router.ts` | `DBRouter` — maps eth address + encKey → encrypted Turso connection |
| `src/db/schema.ts` | SQL DDL for memories, conversations, embeddings tables |
| `src/db/vector.ts` | `vectorSearch()` (cosine distance), `embedAndStore()` |
| `src/config/index.ts` | Loads `config.toml` (or `CONFIG_TOML_B64` env var), applies `DATA_DIR` override |
| `config.toml` | Model IDs, server port, session TTL, encryption cipher, data directory |
| `SOUL.md` | Agent personality (loaded into system prompt) |
| `constitution.md` | Safety boundaries (loaded into system prompt) |
| `template.json` | Deployment manifest for agent-kit |

## Schema

Each user's encrypted `.db` file contains:

- **`memories`** — key-value facts (UNIQUE on key, upserted via `save_memory` tool)
- **`conversations`** — full message log (session_id = eth address)
- **`embeddings`** — vector store (Voyage AI embeddings, cosine distance search)

See [docs/personalization.md](docs/personalization.md) for how these are used.

## Auth Flow

Two wallet signatures on login:

1. **SIWE** (with nonce) → proves wallet ownership → `POST /api/auth/verify`
2. **Deterministic** (no nonce) → derives encryption key via HKDF → `POST /api/auth/unlock`

See [docs/authentication.md](docs/authentication.md) for the full flow.

## Adding Tools

Define new tools in `src/agent/tools.ts` using Vercel AI SDK's `tool()` + Zod:

```typescript
new_tool: tool({
  description: "What this tool does",
  parameters: z.object({ param: z.string() }),
  execute: async ({ param }) => {
    // db is available in closure — scoped to current user
    return "result";
  },
}),
```

Tools are passed to `generateText()` in `assistant.ts`. The agent can use up to 10 tool steps per request (`maxSteps: 10`).

## Environment Variables

Required: `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `VOYAGEAI_API_KEY`, `VITE_WC_PROJECT_ID`

Optional: `DATA_DIR` (override db path), `CONFIG_TOML_B64`, `SOUL_MD_B64`, `CONSTITUTION_MD_B64` (base64-encoded files for containerized deploys)

## Docker

```bash
docker compose up --build
```

User databases stored at `/mnt/disks/userdata` (volume mount). Bun runtime via `FROM oven/bun:1`.
