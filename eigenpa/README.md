# EigenPA

**Your wallet is your password. Your data is yours alone.**

EigenPA is a personal assistant that gives every user their own encrypted database, unlocked only by their Ethereum wallet. Connect wallet, sign twice, chat. No accounts, no emails, no trust assumptions.

```
  You: "Remember that I prefer TypeScript over Python"
  PA:  Done. I'll keep that in mind.

  ... 3 weeks later ...

  You: "Write me a quick HTTP server"
  PA:  Here's a TypeScript server using Hono: ...
```

The agent remembers you across sessions because your conversations and preferences live in a database that only your wallet can decrypt. Not even the server operator can read it.

## How It Works

```
Connect Wallet → Sign In (SIWE) → Sign Key Derivation Message → Chat
       │                │                    │                     │
       │           proves you              derives               agent reads
       │          own the wallet        encryption key         your encrypted DB
       │                │                    │                     │
       ▼                ▼                    ▼                     ▼
  RainbowKit        EIP-4361            HKDF-SHA256          Turso + AEGIS-256
```

Two signatures on login. Both gasless. The first proves identity. The second deterministically derives a 256-bit encryption key from your wallet's private key. That key opens your database and lives only in a sealed session cookie — never on disk.

For the full story, see:

- **[Architecture](docs/architecture.md)** — system design, component map, request lifecycle
- **[Encryption](docs/encryption.md)** — key derivation, AEGIS-256, threat model
- **[Authentication](docs/authentication.md)** — SIWE flow, session management, API endpoints
- **[Personalization](docs/personalization.md)** — memory systems, embeddings, how the agent learns

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1+
- An [Anthropic API key](https://console.anthropic.com/)
- A [Voyage AI API key](https://dash.voyageai.com/)
- A [WalletConnect project ID](https://cloud.walletconnect.com/) (free)

### Run Locally

```bash
cd eigenpa
cp .env.example .env
# Fill in your API keys in .env

bun install
bun run dev
```

Open `http://localhost:3000`, connect your wallet, and start chatting.

### Run with Docker

```bash
cp .env.example .env
# Fill in your API keys

docker compose up --build
```

User databases are stored in `/mnt/disks/userdata` inside the container, mounted as a volume.

## Configuration

### `config.toml`

```toml
[models]
agent = "anthropic/claude-sonnet-4-6-20250514"   # LLM for the agent
embed = "voyage-3"                                # Embedding model

[server]
port = 3000

[session]
cookie_name = "eigenpa_session"
ttl_hours = 72                                    # Session lifetime

[encryption]
cipher = "aegis256"                               # Turso encryption cipher

[data]
dir = "/mnt/disks/userdata"                       # Where encrypted .db files live
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

## What's In a User's Database?

Each wallet gets a single `.db` file containing three tables:

| Table | Purpose | Example |
|-------|---------|---------|
| `memories` | Key-value facts the agent learns | `name → Jordan`, `tz → America/Chicago` |
| `conversations` | Full message history | Every user/assistant exchange |
| `embeddings` | Vector store for semantic search | Past exchanges embedded via Voyage AI |

The agent uses all three on every request: memories for personalization, embeddings for relevant context retrieval, and conversation history for immediate continuity.

## Security Model

| Property | How |
|----------|-----|
| Data encrypted at rest | Turso AEGIS-256, per-page encryption |
| Key never on server disk | Sealed in client-held session cookie only |
| Key derivable only by wallet owner | HKDF from deterministic wallet signature |
| No cross-user data access | Physical isolation (separate `.db` files) |
| Data deletion | `rm {address}.db` — or `DELETE /api/data` |
| Lost wallet = lost data | By design. No backdoor. No recovery. |

## Project Structure

```
eigenpa/
├── config.toml              # Model routing, server config, encryption settings
├── SOUL.md                  # Agent personality
├── constitution.md          # Safety boundaries
├── template.json            # Deployment manifest
├── Dockerfile               # Bun multi-stage build
├── docker-compose.yml       # Volume mount + env vars
├── src/
│   ├── main.ts              # Entry point
│   ├── server/
│   │   ├── index.ts         # Fastify: routes, static serving, rate limiting
│   │   └── auth.ts          # SIWE + HKDF key derivation + session
│   ├── agent/
│   │   ├── assistant.ts     # Agentic loop: memories → retrieval → Claude → persist
│   │   └── tools.ts         # save_memory, recall_memories, search_history
│   ├── db/
│   │   ├── router.ts        # Encrypted connection manager
│   │   ├── schema.ts        # Table definitions
│   │   └── vector.ts        # vectorSearch(), embedAndStore()
│   └── config/
│       └── index.ts         # TOML loader with env var overrides
├── site/
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx          # React entry + providers
│       ├── App.tsx           # Wallet gate → chat routing
│       └── components/
│           ├── WalletGate.tsx  # Connect + SIWE + key derivation
│           └── ChatInput.tsx   # Chat interface
└── docs/
    ├── architecture.md       # System design + component map
    ├── encryption.md         # Key derivation + threat model
    ├── authentication.md     # SIWE flow + session management
    └── personalization.md    # Memory systems + how the agent learns
```

## Known Limitations

| # | Limitation | Notes |
|---|-----------|-------|
| 1 | **No ANN vector index** | Turso vector indexing is on the roadmap. Brute-force is fine for <50k embeddings per user. |
| 2 | **Single-process only** | Turso doesn't support multi-process access to the same file. Run one server instance. |
| 3 | **Turso encryption is experimental** | Keep backups of `/mnt/disks/userdata`. Files are self-contained — `cp` is sufficient. |
| 4 | **Lost wallet = lost data** | There is no key escrow or recovery mechanism. This is a feature, not a bug. |
| 5 | **Two signatures on login** | Both are gasless `personal_sign` calls — sub-second each. UX cost is minimal. |

## License

MIT
