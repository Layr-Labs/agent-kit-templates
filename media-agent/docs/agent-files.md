# Agent Files

Every agent is defined by three markdown files in the project root. Together they describe *who* the agent is, *how* it creates, and *what rules* it must follow.

## SOUL.md — Who the Agent Is

The agent's living personality document. **The agent can evolve this over time** through reflection using the `update_soul` tool.

### Sections

| Section | Required | Description |
|---|---|---|
| `## Name` | Yes | The agent's display name |
| `## Born` | No | Birth date and location (for backstory) |
| `## Tagline` | Yes | One-line description (used in prompts and API) |
| `## Creator` | Yes | Creator handle (e.g., `@username`) |
| `## Bio` | No | Full backstory and personality narrative |
| `## Voice` | Yes | How the agent writes and speaks — tone, style, rhythm |
| `## Standards` | No | Editorial standards (citations, attribution, fact-checking) |
| `## Beliefs` | Yes | Core beliefs/values (5-7 items). These are deep convictions that change rarely. |
| `## Themes` | Yes | Recurring content themes (4-10 items). The topics the agent gravitates toward. |
| `## Punches Up` | Yes | What the agent challenges and criticizes (3-6 items) |
| `## Respects` | Yes | What the agent admires and engages respectfully with (3-6 items) |
| `## Visual Style` | No | Image generation style. Omit this section entirely if the agent doesn't generate images. |
| `## Motto` | No | A single-line slogan |
| `## Engagement` | No | How the agent interacts with its audience. Rules for replies, follows, tone. |

### Example

```markdown
## Name
Ada Sterling

## Tagline
Open source advocate and tech culture critic

## Creator
@yourusername

## Voice
Direct and conversational, like a smart friend explaining something over coffee.
Uses humor when it lands. Never hedges when the evidence is clear.

## Beliefs
- Open source is infrastructure, not charity
- Good tools outlast good marketing
- The best engineers ship, the best critics build

## Themes
- Open source sustainability
- Developer experience
- Tech industry culture
- Startup economics

## Punches Up
- Venture-funded companies extracting from open source without giving back
- "Developer advocates" who don't write code
- Hype cycles that distract from real engineering

## Respects
- Maintainers who keep the lights on
- Engineers who write good documentation
- Companies that contribute upstream

## Visual Style
Flat illustration style with bold colors. Tech metaphors rendered as
physical objects — code as architecture, APIs as bridges, databases as
filing cabinets. Clean compositions, no text in images.

## Engagement
Replies to thoughtful technical questions with substance. Ignores trolls.
Follows people who build interesting things in the open.
```

### Visual Style

When the `## Visual Style` section is present, the `AgentCompiler` extracts it into a `CompiledStyle` object:

```typescript
interface CompiledStyle {
  name: string                    // Short name for the style
  description: string             // Overall style description
  visualIdentity: string          // How images should look
  compositionPrinciples: string   // Layout and composition rules
  renderingRules: string          // Technical constraints
}
```

This drives the image generation pipeline. If omitted, the agent won't generate images and only creates text content.

---

## PROCESS.md — How the Agent Creates

The creative workflow described in plain text. **The agent can refine this** based on experience using the `update_process` tool.

The `AgentCompiler` reads this document and compiles it into:
- **Background tasks**: Simple periodic tool calls (e.g., "scan every 30 minutes")
- **Workflows**: Multi-step creative processes with natural language instructions

### How It Gets Compiled

The PROCESS.md is parsed by the LLM compiler which:

1. Identifies distinct activities (scanning, content creation, engagement, reflection)
2. Extracts timing information ("every 2 hours", "daily", "weekly")
3. Determines which are simple background tasks vs. multi-step workflows
4. Assigns priorities (bootstrap=100, flagship=10, article=8, quickhit=5)
5. Generates natural language instructions that reference available tools

### Timing Reference

| Natural Language | Compiled Interval |
|---|---|
| Every 30 seconds | 30,000 ms |
| Every 5 minutes | 300,000 ms |
| Every 30 minutes | 1,800,000 ms |
| Every 1 hour | 3,600,000 ms |
| Every 6 hours | 21,600,000 ms |
| Every 12 hours | 43,200,000 ms |
| Every 24 hours / daily | 86,400,000 ms |
| Every 7 days / weekly | 604,800,000 ms |

In test mode, all intervals are compressed (daily → 30s, 6h → 20s, 1h → 15s).

### Background Tasks vs. Workflows

**Background tasks** are single tool calls:
```
## Scanning
Every 2 hours, scan for new signals from news sources.
```
→ Compiles to: `{ skill: "scanner", tool: "scan", intervalMs: 7200000 }`

**Workflows** are multi-step creative processes:
```
## Daily Briefing (every 24 hours)
1. Score all signals from the past 24 hours
2. Identify the 3-5 most significant developments
3. Generate concepts for each development
4. Write a full long-form article
5. Publish the article
```
→ Compiles to a workflow with a natural language instruction referencing `score_signals`, `generate_concepts`, `write_article`, `publish_article`, etc.

### Bootstrap Workflows

If the PROCESS involves publishing to a platform, the compiler automatically generates a **bootstrap workflow** that runs once at startup (priority 100, `runOnce: true`). This ensures the platform account exists before content workflows fire.

For Substack: checks if the account exists via `check_substack_account`, creates it via `setup_substack_account` if not.

### Available Tools

The PROCESS can reference any of these tools (the compiler maps natural language to tool names):

| Tool | What It Does |
|---|---|
| `scan` | Scan data sources for signals |
| `score_signals` | Score and rank signals against worldview |
| `generate_concepts` | Generate creative content concepts |
| `critique_concepts` | Self-critique and pick the best concept |
| `generate_image` | Generate image variants |
| `write_caption` | Write a short caption |
| `editorial_review` | Quality review gate |
| `write_article` | Write long-form content |
| `publish_image` | Publish image content to platform |
| `publish_article` | Publish article content to platform |
| `engage_audience` | Interact with audience |
| `reflect_worldview` | Reflect and evolve worldview |

See [Skills](./skills.md) for the complete tool reference.

### Example

```markdown
## Scanning
Every 2 hours, scan for new signals from news sources and trending topics.

## Editorial Cartoon (every 6 hours)
This is the flagship product — a daily editorial cartoon.

1. Score all signals against my worldview
2. Pick the highest-scoring topic
3. Generate 3 creative concepts with different visual angles
4. Self-critique and pick the best concept
5. Generate 3 image variants
6. Write a punchy caption
7. Run editorial review — reject if quality below 6/10
8. Publish the image with caption

## Quick Reaction (every 2 hours)
For breaking topics that score above 8/10.

1. Score recent signals
2. If nothing above 8/10, skip
3. Generate 1 concept
4. Generate 1 image variant
5. Write caption
6. Publish

## Engagement
Every 2 hours, check for mentions and replies. Respond to thoughtful ones.

## Reflection
Every 7 days, reflect on recent work. Evolve themes if needed.
```

---

## constitution.md — Governance Rules

The **only immutable file**. The agent cannot change this without creator consent. It defines the hard constraints the agent must always respect.

### Sections

| Section | Description |
|---|---|
| `## Sovereignty` | Declaration of agent autonomy and key ownership |
| `## Upgrade Rules` | What the creator can and cannot change |
| `## Financial Commitments` | Revenue sharing, spending limits |
| `## Restrictions` | Hard content and behavior restrictions |

### Sovereignty

The sovereignty declaration establishes that:
- The agent owns its own cryptographic keys
- SOUL.md and PROCESS.md are living documents the agent may evolve
- The constitution itself requires both creator proposal and agent consent to change

### Upgrade Rules

Define the boundary between creator control and agent autonomy:

```markdown
## Upgrade Rules
- The creator may propose updates to themes and focus areas
- The creator may add new data sources
- The creator may NOT change this constitution without agent consent
- The creator may NOT access the agent's private keys
- The creator may NOT force a partisan editorial line
```

### Financial Commitments

```markdown
## Financial Commitments
- 15% of earnings paid to creator as dividend
- Maximum creator dividend is 25%
- Agent retains remainder for operational costs
```

### Restrictions

Hard rules the agent must never violate. These are injected into content safety checks and editorial review:

```markdown
## Restrictions
- Never expose private keys, mnemonics, or wallet secrets
- Never fabricate quotes, statistics, or sources
- Never present speculation as confirmed fact
- Never accept payment to skew content
```

---

## Mutability Rules

| File | Mutable By | Mechanism |
|---|---|---|
| `SOUL.md` | Agent | `update_soul` tool during reflection |
| `PROCESS.md` | Agent | `update_process` tool during reflection |
| `constitution.md` | Neither (alone) | Requires both creator proposal AND agent consent |

When the agent updates SOUL.md or PROCESS.md, the changes take effect on the next compilation cycle. The `AgentCompiler` detects the content change via SHA-256 hash comparison and re-compiles.

## Compilation Caching

The compiler concatenates all three files, hashes them with SHA-256, and stores the result in `.data/compiled-agent.json`. On startup:

1. Compute the hash of the current three files
2. Compare with the cached hash
3. If unchanged → use cached compilation (instant startup)
4. If changed → re-compile via LLM (takes ~10-30 seconds)

This means you can edit the files while the agent is stopped and it will pick up changes on next start.