# Skills

Skills are the agent's capabilities. Each skill provides one or more tools that the LLM can call during workflow execution or autonomous action.

## Architecture

### Skill Interface

```typescript
interface Skill {
  readonly name: string
  readonly description: string
  readonly category: 'agent' | 'browser' | 'pipeline'
  readonly dependencies?: string[]
  init(ctx: SkillContext): Promise<Record<string, Tool>>
  tick?(): Promise<void>
  shutdown?(): Promise<void>
}
```

| Method | Description |
|---|---|
| `init(ctx)` | Called once at startup. Returns a map of tool names to `Tool` objects. |
| `tick()` | Optional. Called every tick of the agent loop for periodic work. |
| `shutdown()` | Optional. Called on graceful shutdown for cleanup. |

### Skill Categories

| Category | Directory | Purpose |
|---|---|---|
| `pipeline` | `src/skills/pipeline/` | Content creation steps (scan, score, generate, publish) |
| `agent` | `src/skills/agent/` | Internal capabilities (email, crypto, files, self-modification) |
| `browser` | `src/skills/browser/` | Web automation (login, card provisioning, browsing) |

### Discovery

Skills are auto-discovered from `src/skills/{category}/{name}/index.ts`. Each `index.ts` must export a default `Skill` object:

```typescript
// src/skills/pipeline/my-skill/index.ts
const skill: Skill = {
  name: 'my-skill',
  description: 'Does something useful',
  category: 'pipeline',
  async init(ctx) {
    return {
      my_tool: tool({ ... }),
    }
  },
}
export default skill
```

### SkillContext

Every skill receives the shared context during initialization:

```typescript
interface SkillContext {
  events: EventBus              // Emit events, log monologue
  identity: AgentIdentity       // Agent name, beliefs, themes, voice
  config: Config                // All configuration
  dataDir: string               // Path to .data/ directory
  db: Database                  // SQLite database
  wallet: WalletManager         // ETH + SOL wallet
  browser?: unknown             // Chrome CDP browser (may be null)
  state: PipelineState          // Shared pipeline state
  scannerRegistry: ScannerRegistry
  platform?: PlatformAdapter    // Twitter or Substack
  signer?: ContentSigner        // Content signing key
  compiledStyle?: StyleConfig   // Visual style (from SOUL.md)
  caches: {
    eval: Cache                 // Evaluation cache
    image: Cache                // Image cache
    signal: Cache               // Signal cache
  }
  registry?: SkillRegistryInterface  // For hot-loading new skills
}
```

### Dependencies

Skills can declare dependencies on other skills:

```typescript
const skill: Skill = {
  name: 'twitter-topup',
  dependencies: ['bitrefill'],  // Requires bitrefill to be loaded
  ...
}
```

If a dependency is not registered, the skill is skipped with a warning.

---

## Built-in Skills

### Pipeline Skills

#### `scanner`
Scans all configured data sources for new signals.

| Tool | Input | Output |
|---|---|---|
| `scan` | `{}` | `{ count: number, top: string[] }` |

Calls `scannerRegistry.scan()` and stores results in `state.signals` and `state.cachedSignals`.

#### `scorer`
Evaluates and scores signals into ranked topics.

| Tool | Input | Output |
|---|---|---|
| `score_signals` | `{}` | `{ topicCount: number, top: { summary, score }[] }` |

Reads from `state.cachedSignals`, writes to `state.topics`. Uses the scoring prompt with six weighted dimensions. See [Pipeline — Scorer](./pipeline.md#stage-2-scorer).

#### `ideator`
Generates creative content concepts and critiques them.

| Tool | Input | Output |
|---|---|---|
| `generate_concepts` | `{ count?: number }` | `{ conceptCount, concepts: { id, caption, approach }[] }` |
| `critique_concepts` | `{}` | `{ bestConceptId, bestCaption, overallScore, critique }` |

Reads from `state.topics[0]`, writes to `state.concepts` and `state.bestConcept`. Initializes its own `WorldviewStore` for theme context.

#### `generator`
Generates image variants from the best concept.

| Tool | Input | Output |
|---|---|---|
| `generate_image` | `{ variants?: number }` | `{ variantCount, paths: string[] }` |

Reads `state.bestConcept`, writes to `state.imagePaths` and `state.imagePrompt`.

#### `editor`
Editorial quality gate.

| Tool | Input | Output |
|---|---|---|
| `editorial_review` | `{}` | `{ approved, caption, qualityScore, reason }` |

Reads `state.bestConcept`, `state.caption`, `state.imagePaths[0]`. Writes to `state.review`. Reviews the actual generated image (multimodal).

#### `captioner`
Writes punchy captions.

| Tool | Input | Output |
|---|---|---|
| `write_caption` | `{}` | `{ caption: string }` |

Reads `state.bestConcept`, writes to `state.caption`. Generates 5 candidates, picks the best.

#### `text_writer`
Writes long-form articles.

| Tool | Input | Output |
|---|---|---|
| `write_article` | `{ length?: 'short'\|'medium'\|'long', style?: 'essay'\|'analysis'\|'satire'\|'tutorial' }` | `{ title, subtitle, wordCount }` |

Reads `state.bestConcept`, writes to `state.article`. Three-phase writing: outline → sections → headline.

#### `publisher`
Publishes content to the configured platform.

| Tool | Input | Output |
|---|---|---|
| `publish_image` | `{ type?: 'flagship'\|'quickhit'\|'paid' }` | `{ platformId, url, type }` |
| `publish_article` | `{}` | `{ platformId, url, title }` |

Reads from various state fields. Saves posts to the database, signs content, emits events.

#### `engagement`
Engages with the audience.

| Tool | Input | Output |
|---|---|---|
| `engage_audience` | `{}` | `{ status: string }` |

Delegates to `platform.engage()` — runs the platform-specific engagement loop (mention replies, follow decisions, etc.).

#### `reflection`
Reflects on recent work and evolves the worldview.

| Tool | Input | Output |
|---|---|---|
| `reflect_worldview` | `{}` | `{ changed: boolean, postCount: number }` |

Uses the last 20 posts as context. The `WorldviewStore` compares current beliefs, themes, and values against the body of work. Changes are conservative — real worldview evolution is slow.

---

### Agent Skills

#### `email`
Email via the EigenMail SDK. Derives the private key from the agent's mnemonic automatically.

| Tool | Description |
|---|---|
| `send_email` | Send an email from the agent's address |
| `read_inbox` | List inbox messages |
| `read_message` | Read a specific email |
| `trash_message` | Delete an email |

Requires `MNEMONIC` environment variable. The email address is derived from the ETH wallet address.

#### `cast`
EVM blockchain operations via the Foundry `cast` CLI.

| Tool | Input | Description |
|---|---|---|
| `eth_balance` | `{ address }` | Get ETH balance |
| `send_eth` | `{ to, amount }` | Send ETH (amount in ether) |
| `erc20_balance` | `{ token, address }` | Get ERC-20 token balance |
| `gas_price` | `{}` | Current gas price in gwei |
| `chain_id` | `{}` | Current chain ID |
| `block_number` | `{}` | Latest block number |
| `get_wallet_address` | `{}` | Agent's ETH address |

Requires Foundry installed (`cast` in PATH) and `PRIVATE_KEY` for sending transactions. Addresses are validated with regex at the schema level. Uses `execFileSync` with array args to prevent injection.

#### `soul`
Read and evolve the agent's defining files.

| Tool | Input | Description |
|---|---|---|
| `read_soul` | `{}` | Read current SOUL.md |
| `update_soul` | `{ content, reason }` | Replace SOUL.md content |
| `read_process` | `{}` | Read current PROCESS.md |
| `update_process` | `{ content, reason }` | Replace PROCESS.md content |

Changes take effect on the next compilation cycle (source hash changes trigger re-compilation).

#### `files`
Read, write, and list files in the data directory.

| Tool | Input | Description |
|---|---|---|
| `write_file` | `{ path, content }` | Write content to a file (path relative to `.data/`) |
| `read_file` | `{ path }` | Read a file |
| `list_files` | `{ path? }` | List directory contents |

Path traversal is blocked — all paths are resolved within the data directory.

#### `skill-creator`
Creates new skills at runtime. The agent can build its own tools.

| Tool | Input | Description |
|---|---|---|
| `list_skills` | `{}` | List all registered skills and tools |
| `create_skill` | `{ name, description, category, what_it_should_do, research_first? }` | Generate and hot-load a new skill |

The `create_skill` tool:
1. Optionally researches the topic using the browser
2. Generates TypeScript code via LLM (with the skill template and examples as context)
3. Writes the code to `src/skills/{category}/{name}/index.ts`
4. Hot-loads the skill into the running registry — no restart needed
5. The new tools are immediately available

The constitution is included in the generation prompt to ensure created skills respect governance constraints.

---

### Browser Skills

#### `browse`
General-purpose browser automation.

| Tool | Input | Description |
|---|---|---|
| `browse` | `{ task, max_steps? }` | Execute any browser task via natural language instruction |

Sends the task to `browser-autopilot`'s `runAgent` with the Chrome CDP session.

#### `platform-login`
Automated platform login.

| Tool | Input | Description |
|---|---|---|
| `platform_login` | `{ platform, login_url? }` | Log into a platform using env var credentials |

Supported platforms: `twitter`. Login URLs are restricted to an allowlist of trusted HTTPS hosts. Credentials are passed via `sensitiveData` (not exposed to the browser agent's output).

#### `bitrefill`
Prepaid card provisioning via Bitrefill.

| Tool | Input | Description |
|---|---|---|
| `check_card_status` | `{}` | Check if a card is provisioned |
| `get_card_details` | `{}` | Get card number, CVV, expiry |
| `provision_card` | `{ amount?, payment_chain? }` | Buy and redeem a prepaid Visa card |

Two-phase browser automation: (1) purchase gift card on Bitrefill with crypto, (2) redeem for virtual Visa details. Alternatively, set `CARD_NUMBER`, `CARD_CVV`, `CARD_EXPIRY` env vars to skip provisioning.

#### `twitter-topup`
Add a payment card to Twitter/X billing.

| Tool | Input | Description |
|---|---|---|
| `topup_twitter_billing` | `{ skip_if_exists? }` | Add card to Twitter billing settings |

Depends on `bitrefill` skill (or manual card env vars). Uses browser automation to navigate to Twitter billing and enter card details.

#### `substack-setup`
Set up a Substack account and publication.

| Tool | Input | Description |
|---|---|---|
| `check_substack_account` | `{}` | Check if account exists |
| `setup_substack_account` | `{ name, handle, bio, newsletter_name, newsletter_description }` | Create account and publication |

Multi-phase browser automation with EigenMail integration for email verification. Creates the account, verifies via magic link or code, sets up the publication, and saves account state to `.data/substack-account.json`.

---

## Creating Custom Skills

### Template

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'

const skill: Skill = {
  name: 'my-custom-skill',
  description: 'What this skill does',
  category: 'agent',  // or 'browser' or 'pipeline'

  async init(ctx: SkillContext) {
    return {
      my_tool: tool({
        description: 'What this tool does',
        inputSchema: z.object({
          param: z.string().describe('Parameter description'),
        }),
        execute: async ({ param }) => {
          // Implementation
          ctx.events.monologue(`Doing something with ${param}`)
          return { result: 'done' }
        },
      }),
    }
  },
}

export default skill
```

### File Location

Place your skill at `src/skills/{category}/{name}/index.ts`. It will be auto-discovered on startup.

### Hot-Loading

Skills can also be created at runtime via the `create_skill` tool. The agent generates TypeScript code, writes it to the correct location, and hot-loads it into the running registry. No restart required.

To hot-load manually:

```typescript
const result = await registry.loadAndInit(
  'src/skills/agent/my-skill/index.ts',
  ctx
)
// result: { name: 'my-skill', tools: ['my_tool'] }
```

### Best Practices

- Keep skills focused — one capability per skill
- Handle errors gracefully — return error messages rather than throwing
- Use `ctx.events.monologue()` for status updates (broadcast on SSE console)
- Use `ctx.dataDir` for file storage
- Use `ctx.caches` to avoid redundant LLM calls
- Declare dependencies if your skill requires another skill to be loaded
- For browser tasks: `const { runBrowserTask } = await import('../../../browser/index.js')`