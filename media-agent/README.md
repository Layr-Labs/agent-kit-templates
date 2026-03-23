# Media Agent

A general-purpose framework for building sovereign media agents. Define your agent with three files, plug in a platform, and let it run.

## The Three Files

Every agent is defined by three files in the project root:

| File | What it defines | Can the agent change it? |
| --- | --- | --- |
| **SOUL.md** | The agent's personality — who it is, how it writes, what it cares about | Yes — evolves through reflection |
| **PROCESS.toml** | The agent's actions — what it posts, how often, and in what order | Yes — refines over time |
| **constitution.md** | The agent's rules — what it must always or never do | No — changes require creator proposal + agent consent |

See [Agent Files](https://docs.eigencloud.com/agentkit/agent-files) in the EigenCloud docs for the full reference, including examples, posting strategy tips, and best practices.

## How It Works

```
SOUL.md + PROCESS.md + constitution.md
            ↓
    AgentCompiler (LLM-powered)
            ↓
    CompiledAgent {
      identity     → persona, beliefs, voice, themes
      style        → visual style for image generation
      engagement   → interaction behavior
      governance   → immutable rules
      plan         → scheduled workflows + background tasks
    }
            ↓
    ProcessExecutor (scheduler + LLM router)
            ↓
    For each workflow trigger:
      → generateText(creative process + all tools)
      → Agent decides the flow dynamically
```

## Platforms

Set `PLATFORM` env var to select:

- **`twitter`** (default) — Scans trending topics, generates visual content, posts to Twitter
- **`substack`** — Scans RSS feeds, writes articles, publishes to Substack

## Skills

Skills are the agent's capabilities. Two types:

### Agent Skills
- **email** — Send/receive email via EigenMail
- **soul** — Read and evolve SOUL.md and PROCESS.md

### Browser Skills
- **platform-login** — Automated platform login via browser-autopilot

### Pipeline Skills (available as tools during workflows)
- `scan` — Scan for signals from data sources
- `score_signals` — Score and rank signals against worldview
- `generate_concepts` — Generate creative content concepts
- `critique_concepts` — Self-critique and pick the best concept
- `generate_image` — Generate image variants
- `write_caption` — Write social captions
- `editorial_review` — Quality review gate
- `write_article` — Write long-form content
- `publish_image` / `publish_article` — Publish to platform
- `engage_audience` — Interact with audience
- `reflect_worldview` — Reflect and evolve personality

## Quick Start

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Customize your agent
# Edit SOUL.md, PROCESS.md, and constitution.md

# Run
bun dev
```

## Examples

**Editorial Cartoonist**: SOUL.md describes a sharp visual satirist. PROCESS.md scans Twitter, generates editorial cartoons, publishes with punchy captions.

**Newsletter Analyst**: SOUL.md describes a thoughtful researcher. PROCESS.md scans RSS feeds, writes deep analysis articles, publishes to Substack.

**Debate Judge**: SOUL.md describes a neutral arbiter. PROCESS.md monitors discussions, analyzes arguments from multiple angles, publishes balanced assessments.

**Philosopher**: SOUL.md describes a contemplative thinker. PROCESS.md reads widely, reflects deeply, publishes essays exploring different perspectives.

All use the same framework — just different SOUL.md and PROCESS.md files.
