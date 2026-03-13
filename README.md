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

- `media-agent/` routes model traffic through an AI Gateway-compatible proxy using `createGateway` from `ai`.
- Set `LLM_PROXY_URL` or `EIGEN_GATEWAY_URL` before running or deploying.
- Set `LLM_PROXY_API_KEY` for bearer auth, or use `KMS_AUTH_JWT` if that is the bearer token your proxy expects.
- All LLM calls now use an explicit retry budget; override it with `AI_INFERENCE_MAX_RETRIES` if needed.
- Model IDs in `media-agent/config.toml` should keep the `provider/model` format, for example `anthropic/claude-sonnet-4.6`.

## License

See [LICENSE](./LICENSE) for details.
