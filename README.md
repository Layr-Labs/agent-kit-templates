# Agent Kit Templates

Starter templates for building autonomous agents with [Agent Kit](https://github.com/Layr-Labs/agent-kit).

## Templates

| Template | Description | Status |
|---|---|---|
| `media-agent/` | Constitution-driven autonomous media agent | Included |

## How It Works

Each template is a standalone, deployable agent defined by three plain-text files:

- **SOUL.md** — Who the agent is (personality, voice, beliefs, themes)
- **PROCESS.toml** — Deterministic pipeline definition (workflows, timers, skill scoping)
- **constitution.md** — Governance rules (immutable constraints, financial commitments)

Write the three files, pick a platform adapter (Twitter, Substack, etc.), and deploy.

## Runtime Notes

- `media-agent/` uses AI Gateway only. Set `AI_GATEWAY_API_KEY` before running or deploying.
- Model IDs in `media-agent/config.toml` should use AI Gateway's `provider/model` format, for example `anthropic/claude-sonnet-4.6`.

## License

See [LICENSE](./LICENSE) for details.