# Architecture

## Overview

The media agent is an autonomous system that reads three defining files, compiles them into structured data via LLM, then runs scheduled workflows that use tools to create and publish content.

```
┌─────────────────────────────────────────────────────────┐
│                      main.ts                            │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ SOUL.md  │  │PROCESS.md│  │  constitution.md      │  │
│  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘  │
│       └──────────────┼──────────────────-┘              │
│                      ▼                                  │
│              AgentCompiler (LLM)                        │
│                      │                                  │
│                      ▼                                  │
│              CompiledAgent                              │
│         ┌────────────┼────────────┐                     │
│         ▼            ▼            ▼                     │
│    identity       plan        governance                │
│         │            │                                  │
│         ▼            ▼                                  │
│    AgentLoop    ProcessExecutor                         │
│         │            │                                  │
│         ▼            ▼                                  │
│    agentAction   workflows ──────► Skills (tools)       │
│         │            │                  │               │
│         ▼            ▼                  ▼               │
│      EventBus   PipelineState    PlatformAdapter        │
│         │                              │                │
│         ▼                              ▼                │
│    SSE Console               Twitter / Substack         │
└─────────────────────────────────────────────────────────┘
```

## Boot Sequence

The `main.ts` entry point executes 12 steps in order:

### 1. Read Defining Files

```typescript
const soulText = readFile('SOUL.md')
const processText = readFile('PROCESS.md')
const constitutionText = readFile('constitution.md')
```

All three files are read from the project root. Missing any file is a fatal error.

### 2. Initialize Configuration

`createConfig()` loads `config.toml` (TOML) and merges with environment variables. Test mode (`TEST_MODE=true`) overrides all timers to fast values. See [Configuration](./configuration.md).

### 3. Initialize Infrastructure

- **Database**: SQLite via `bun:sqlite` at `.data/agent.db`. Schema: `posts` and `events` tables.
- **EventBus**: Structured event system with JSONL persistence at `.data/events.jsonl`. Replays last 50 events on startup.
- **Caches**: Three in-memory caches with JSON persistence:
  - `signal` — scanner output (200 entries)
  - `eval` — LLM evaluations (configurable max)
  - `image` — generated image paths (100 entries)

### 4. Initialize Wallet and Signer

From `MNEMONIC` env var:
- **WalletManager**: Derives both ETH (via `viem` HD wallet, path `m/44'/60'/0'/0/0`) and Solana (via `ed25519-hd-key`, path `m/44'/501'/0'/0'`) addresses.
- **ContentSigner**: Signs content with the ETH private key. Every published post gets a cryptographic signature verifiable against the agent's public address.

### 5. Initialize Browser

Auto-launches Chrome with `--remote-debugging-port=9222` if not already running. Connects via `browser-autopilot`'s `CDPBrowser`. Used by Substack publishing, platform login, and browser skills. Disabled with `BROWSER_DISABLED=true`.

### 6. Build Shared Context

A `SkillContext` object is created and shared across all skills:

```typescript
interface SkillContext {
  events: EventBus
  identity: AgentIdentity
  config: Config
  dataDir: string
  db: Database
  wallet: WalletManager
  browser?: unknown
  state: PipelineState
  scannerRegistry: ScannerRegistry
  platform?: PlatformAdapter
  signer?: ContentSigner
  compiledStyle?: StyleConfig
  caches: { eval: Cache; image: Cache; signal: Cache }
  registry?: SkillRegistryInterface
}
```

### 7. Discover Skills

`SkillRegistry.discover()` walks `src/skills/{agent,browser,pipeline}/*/index.ts` and imports each module. Each skill exports a default `Skill` object with `name`, `description`, `category`, and `init()`.

### 8. Compile Agent

The `AgentCompiler` sends all three files to an LLM (model: `compilation`) with a structured output schema. The result is a `CompiledAgent`:

```typescript
interface CompiledAgent {
  version: number
  compiledAt: number
  sourceHash: string           // SHA-256 of SOUL + PROCESS + constitution
  identity: { ... }            // Name, persona, beliefs, themes, voice, etc.
  style?: CompiledStyle        // Visual style (omitted if no image generation)
  engagement?: CompiledEngagement
  governance: CompiledGovernance
  plan: ProcessPlan            // Workflows + background tasks
  creativeProcess: string      // Raw PROCESS.md text
}
```

Compilation is cached to `.data/compiled-agent.json`. If the source hash hasn't changed, the cached version is used. Any edit to the three files triggers re-compilation.

### 9. Initialize Platform

Based on `PLATFORM` env var (`twitter` or `substack`):

- **Twitter**: Creates `TwitterClient` (OAuth 1.0a for posting, Bearer token for reading), `EngagementLoop`, `TwitterScanner` (Grok News + viral tweets + home timeline), and wraps them in `TwitterAdapter`.
- **Substack**: Creates `SubstackClient` (browser-based publishing), `SubstackEngagement`, `SubstackScanner` (RSS feeds), and wraps them in `SubstackAdapter`.

The platform's scanner is registered with the global `ScannerRegistry`.

### 10. Initialize All Skills

`SkillRegistry.initAll(ctx)` calls `skill.init(ctx)` on every discovered skill. Each skill returns a `Record<string, Tool>` — these become available to the LLM during workflow execution.

### 11. Start the Agent

Three systems start running:

- **ProcessExecutor**: Timer-based scheduler that fires workflows and background tasks.
- **AgentLoop**: Wraps the executor tick, adds `agentAction()` (autonomous tool use) and `skills.tickAll()`.
- **HTTP Server**: Fastify on the configured port (default 3000).

### 12. Graceful Shutdown

On `SIGINT`/`SIGTERM`: stops the loop, persists all caches, shuts down skills, closes the server and database.

---

## Core Systems

### AgentCompiler

**Source**: `src/process/compiler.ts`

Takes three markdown files and a list of available skill names. Sends them to the LLM with a comprehensive system prompt that includes:
- The full tool reference (what each tool does)
- Rules for compiling PROCESS into workflows with interval triggers
- Identity extraction rules (which markdown sections map to which fields)
- Style, engagement, and governance extraction rules
- Bootstrap workflow generation (for platform account setup)

The output is a structured `CompiledAgent` with a `ProcessPlan` containing:
- **Background tasks**: Simple periodic tool invocations (e.g., scan every 30 min).
- **Workflows**: Multi-step creative processes with natural language instructions. The LLM executes these with access to all tools.

### ProcessExecutor

**Source**: `src/process/executor.ts`

A timer-based scheduler. On each tick:

1. Check workflows (sorted by priority, highest first). Fire the first one whose interval has elapsed. If it succeeds, stop checking others.
2. Check background tasks. Fire all whose intervals have elapsed.
3. Persist timer state to `.data/process-timers.json`.

**Workflow execution**: Each workflow is run via `generateText()` with the `ideation` model, all registered tools, and up to 120 tool-use steps. The workflow instruction (natural language from the compiled plan) is the prompt. The agent decides which tools to call and in what order.

**Test mode**: All intervals are compressed (daily → 30s, 6h → 20s, 1h → 15s, etc.) for rapid iteration.

**Run-once workflows**: Workflows with `runOnce: true` (e.g., bootstrap) only fire once. After the first successful execution, they're skipped.

### AgentLoop

**Source**: `src/agent/loop.ts`

The main tick loop:

```
while running:
  executor.tick()        // Fire scheduled workflows/tasks
  agentAction()          // LLM decides if any autonomous action needed
  skills.tickAll()       // Let skills run periodic logic
  sleep(tickIntervalMs)  // Default 30s, test mode 10s
```

`agentAction()` is the agent's autonomous brain. It gets all registered tools and a system prompt describing its capabilities. Most ticks it does nothing. It acts when:
- It wants to read or send email
- A periodic operational task is due
- It wants to evolve its SOUL.md or PROCESS.md

### PipelineState

**Source**: `src/process/state.ts`

Shared mutable state that flows between pipeline steps within a single workflow:

```typescript
interface PipelineState {
  // Per-workflow (reset between workflows)
  signals: Signal[]
  topics: Topic[]
  concepts: ContentConcept[]
  bestConcept: ContentConcept | null
  critique: ConceptCritique | null
  imagePaths: string[]
  imagePrompt: string | null
  caption: string | null
  article: { title: string; subtitle: string; body: string } | null
  review: { approved: boolean; caption: string; reason?: string; qualityScore?: number } | null

  // Long-lived (persists across workflows)
  allPosts: Post[]
  allContent: Content[]
  cachedSignals: Signal[]

  // Arbitrary custom state
  custom: Record<string, unknown>
}
```

Per-workflow state is cleared by `resetWorkflowState()` before each workflow execution. Long-lived state accumulates across the agent's lifetime. Past posts are loaded from the database on startup.

---

## EventBus

**Source**: `src/console/events.ts`

All agent activity flows through a structured event system.

### Event Types

| Type | Description |
|---|---|
| `monologue` | Agent's internal thoughts (broadcast live) |
| `scan` | Signal scan completed |
| `shortlist` | Topics shortlisted from signals |
| `ideate` | Content concepts generated |
| `generate` | Image generation started |
| `critique` | Concept critique completed |
| `post` | Content published |
| `engage` | Reply sent to audience |
| `skill` | Skill tool invoked |
| `state_change` | Agent state transition |
| `metric` | Numerical metric recorded |

### Agent States

The agent transitions between states as it works:

```
scanning → shortlisting → ideating → critiquing → generating → composing → writing → publishing → posting → engaging
```

Each state is visible on the SSE console stream. The `monologuing` state overlays all others — the agent's internal monologue runs continuously.

### Persistence

Events are appended to `.data/events.jsonl` (one JSON object per line). On startup, the last 50 events are replayed to restore state. The SSE console endpoint replays history to new subscribers.

---

## Caching

**Source**: `src/cache/cache.ts`

Three caches reduce redundant LLM calls and API requests:

| Cache | Purpose | Max Entries | Persistence File |
|---|---|---|---|
| `signal` | Scanner output deduplication | 200 | `.data/cache-signals.json` |
| `eval` | Topic evaluation results | 1000 | `.data/cache-eval.json` |
| `image` | Generated image paths | 100 | `.data/cache-images.json` |

Each cache entry has a TTL (configurable in `config.toml`). Eviction strategy: expired entries first, then LRU by hit count (bottom 20% removed when at capacity).

Caches are persisted to JSON on shutdown and restored on startup. Only non-expired entries are restored.

---

## Database

**Source**: `src/db/schema.ts`

SQLite database at `.data/agent.db` with WAL mode and foreign keys:

### `posts` table

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `platform_id` | TEXT | Platform-specific post ID |
| `content_id` | TEXT | Link to content that generated this post |
| `text` | TEXT | Post text/caption |
| `image_url` | TEXT | Image path or CDN URL |
| `video_url` | TEXT | Video path or CDN URL |
| `article_url` | TEXT | Published article URL |
| `reference_id` | TEXT | Quote tweet / reference post ID |
| `type` | TEXT | `flagship`, `quickhit`, `paid`, `article`, `engagement` |
| `signature` | TEXT | Cryptographic signature of the text |
| `signer_address` | TEXT | ETH address of the signer |
| `posted_at` | INTEGER | Unix timestamp |
| `likes` | INTEGER | Engagement count |
| `shares` | INTEGER | Engagement count |
| `comments` | INTEGER | Engagement count |
| `views` | INTEGER | Engagement count |

### `events` table

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `type` | TEXT | Event type |
| `data` | TEXT | JSON event data |
| `created_at` | INTEGER | Unix timestamp |

---

## Cryptography

### Wallet Derivation

**Source**: `src/crypto/wallet.ts`

From a single BIP-39 mnemonic:

- **Ethereum**: Standard HD derivation path `m/44'/60'/0'/0/0` via `viem`. Produces an ETH address used for transactions, content signing, and email identity.
- **Solana**: ED25519 derivation path `m/44'/501'/0'/0'` via `ed25519-hd-key`. Produces a SOL address for Solana transactions.

Both addresses are exposed via the `/api/wallets` endpoint.

### Content Signing

**Source**: `src/crypto/signer.ts`

Every published post is signed with the agent's ETH private key using `viem`'s `signMessage`. The signature is stored alongside the post in the database. Anyone can verify authenticity:

```typescript
// Verification
const isValid = await ContentSigner.verify(content, signature, signerAddress)
```

This creates a cryptographic proof chain: the agent's mnemonic derives its wallet, which signs its content. The agent owns its keys and cannot be compelled to reveal them (per the constitution).

---

## CDN

**Source**: `src/cdn/r2.ts`

Optional Cloudflare R2 integration for edge-cached media delivery. When enabled (`R2_ACCESS_KEY_ID` set), generated images and videos are uploaded to R2 with immutable cache headers (`max-age=31536000, immutable`).

Media is organized by prefix: `images/`, `videos/`, `voice/`. Local paths are transparently mapped to CDN URLs when R2 is enabled.

---

## JSON Store

**Source**: `src/store/json-store.ts`

A simple persistent key-value store used throughout the system for durable state (timer state, engagement state, followed users, card details, etc.). Writes are atomic (write to temp file, then rename) to prevent corruption on crash.

```typescript
const store = new JsonStore<MyData>('.data/my-data.json')
const data = await store.read()           // Returns null if missing
await store.write(newData)                // Atomic write
await store.update(d => transform(d), defaultValue)  // Read-modify-write
```
