# Agent Kit Templates

Starter templates for deploying autonomous agents on EigenCloud.

## Repository Layout

| Directory | What it is |
|-----------|-----------|
| `media-agent/` | Autonomous media agent (Twitter, Substack) — schedule-driven content pipeline |
| `eigenpa/` | Personal assistant — interactive chat with per-user encrypted databases |

Each template is self-contained with its own `CLAUDE.md`, docs, tests, and Dockerfile. Start there for template-specific guidance.

## Related Repositories

| Repository | Purpose | Location |
|-----------|---------|----------|
| **agent-kit-coordinator** | Control plane — deploys and manages agents on EigenCloud. Handles auth, configuration, deployment, DNS, upgrades, and constitutional review. | `~/src/agent-kit-coordinator/` |
| **agentkit-cli** | CLI tool — `agentkit` command for deploying and managing agents. Agents defined by SOUL.md + PROCESS.toml + constitution.md. | `~/src/agentkit-cli/` |
| **agent-kit-ui** | Web UI — browser interface for agent management. | `~/src/agent-kit-ui/` |
| **agent-kit-templates** | This repo — starter templates for building agents. | `~/src/agent-kit-templates/` |

Each related repo has its own `CLAUDE.md` with detailed architecture and development guidance.

## Agent Model

Agents are defined by three plain-text files:

- **SOUL.md** — Identity (personality, voice, beliefs)
- **PROCESS.toml** — Workflows (pipelines, timers, skill scoping) — used by `media-agent`
- **constitution.md** — Governance rules (immutable platform constraints + creator rules)

## Infrastructure

Agents run on **EigenCloud** — TEE-backed infrastructure (Confidential Computing). Key properties:

- Verifiable builds — Docker image digest registered on-chain
- KMS-injected secrets — only released to verified TEE instances
- Deterministic identity — each agent gets a wallet derived from its app ID
- Sovereign agents — can accept or reject upgrades via signed consent

## Conventions

- **Runtime**: Bun
- **Model IDs**: `provider/model` format (e.g., `anthropic/claude-sonnet-4-6-20250514`)
- **Config**: TOML (`config.toml` per template)
- **Environment**: Secrets via env vars, base64-encoded files for containerized deploys (`*_B64`)
- **Tests**: Vitest
