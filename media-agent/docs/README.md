# Media Agent Documentation

A general-purpose framework for building autonomous media agents. Define your agent with three markdown files, plug in a platform, and let it run.

## Quick Start

```bash
bun install                   # Install dependencies
cp .env.example .env          # Configure API keys
bun dev                       # Run the agent
```

Edit `SOUL.md`, `PROCESS.md`, and `constitution.md` to define your agent. See [Agent Files](./agent-files.md) for details.

## Table of Contents

| Document | Description |
|---|---|
| [Architecture](./architecture.md) | System architecture, boot sequence, data flow, compilation pipeline |
| [Agent Files](./agent-files.md) | The three defining files: SOUL.md, PROCESS.md, constitution.md |
| [Configuration](./configuration.md) | Complete `config.toml` and environment variable reference |
| [Content Pipeline](./pipeline.md) | How content gets created: scanning → scoring → ideation → generation → publishing |
| [Skills](./skills.md) | Skills system, all built-in skills, creating custom skills at runtime |
| [Platforms](./platforms.md) | Platform adapters: Twitter and Substack integration |
| [HTTP API](./api.md) | REST endpoints and SSE console stream |
| [Deployment](./deployment.md) | Docker, TLS, production deployment |
| [Examples](./examples.md) | Building your own agent: cartoonist, newsletter, political analyst |

## How It Works

```
SOUL.md + PROCESS.md + constitution.md
                ↓
        AgentCompiler (LLM)
                ↓
        CompiledAgent
        ├── identity      persona, beliefs, voice, themes
        ├── style         visual style for image generation
        ├── engagement    interaction behavior
        ├── governance    immutable rules
        └── plan          scheduled workflows + background tasks
                ↓
        ProcessExecutor (scheduler)
                ↓
        For each workflow trigger:
          → generateText(instruction + all tools)
          → Agent decides the flow dynamically
```

The agent is fully autonomous. It scans for signals, creates content, publishes to platforms, engages with its audience, and evolves its own worldview over time. The only immutable constraint is the constitution.
