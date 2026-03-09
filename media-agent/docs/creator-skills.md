# Creator Skills

Creator skills are explicit, versioned upgrades that attach new capabilities to an agent without changing the base `media-agent` image.

The runtime model is:

- The Docker image stays fixed.
- `SOUL.md`, `PROCESS.toml`, and `constitution.md` define the agent.
- Installed skills add optional capabilities on top of the same runtime.
- Skill changes should go through the upgrade flow, including constitutional consent.

This is the preferred way to add domain-specific capabilities such as:

- arXiv paper readers
- API clients
- SDK wrappers
- CLI-backed ingestion or export tools
- document parsers
- internal knowledge system integrations

Prefer these over browser-heavy skills whenever possible. Browser skills are slower, more fragile, and more expensive.

## Preferred Skill Shape

Prefer skills that are:

- API-first
- CLI-first
- deterministic
- narrow in scope
- explicit about their inputs and outputs

Good examples:

- `arxiv-skill`
- `s3-sync`
- `postgres-query`
- `slack-webhook`

Avoid making browser automation the default if the same task can be done via HTTP, SDK, local files, or a command-line tool.

## Lifecycle

The intended lifecycle is:

1. The creator writes a skill locally in TypeScript.
2. The creator bundles the skill with:
   - reviewable TypeScript source
   - executable `.mjs` output
   - manifest metadata
3. The coordinator asks the running agent for consent using `POST /upgrade/consent`.
4. If approved, the coordinator installs the skill with `POST /upgrade/skills/install`.
5. The runtime hot-loads the skill and recompiles the workflow plan.
6. The creator can disable or remove the skill later with:
   - `POST /upgrade/skills/set-state`
   - `POST /upgrade/skills/remove`

Installed skills live under:

`<agent-data-dir>/skills/installed/<skill-name>/`

## Manifest

Each installed skill should include a manifest like this:

```json
{
  "apiVersion": 1,
  "name": "arxiv-skill",
  "version": "1.0.0",
  "description": "Fetch arXiv paper metadata and abstracts",
  "entrypoint": "dist/index.mjs",
  "sourceEntrypoint": "source/index.ts",
  "capabilities": ["network"],
  "tools": [
    {
      "name": "read_arxiv_paper",
      "description": "Fetch arXiv paper metadata and abstract by arXiv id"
    }
  ],
  "enabled": true
}
```

Notes:

- `name` should be lowercase hyphen-case.
- `sourceEntrypoint` should point to the TypeScript source the upgrade proxy reviews.
- `entrypoint` should point to the bundled `.mjs` module the runtime imports.
- `tools` should describe the exported tool surface honestly. The compiler uses this metadata.
- `capabilities` should be conservative and explicit.
- `enabled: false` keeps the skill installed but inactive.

## Authoring Rules

When writing creator skills:

- Export a default `Skill` object.
- Use `tool({...})` with `inputSchema`.
- Treat TypeScript as the authoring format.
- Treat `.mjs` as the runtime artifact.
- Keep `init()` fast and idempotent.
- Write only under `ctx.dataDir` unless there is a very good reason not to.
- Return structured outputs where possible.
- Fail clearly instead of hiding errors.
- Treat network calls and subprocesses as operational dependencies that may fail.

Avoid:

- reading secrets from random files
- mutating `SOUL.md` or `PROCESS.toml` from a generic utility skill
- doing browser automation when an API or CLI exists
- broad kitchen-sink skills with many unrelated tools

## Bundling

The upgrade install endpoint expects a bundle payload shaped like this:

```json
{
  "id": "install-arxiv-skill",
  "description": "Install a creator-authored arXiv skill.",
  "summary": "Install arxiv-skill v1.0.0.",
  "proposedBy": "@creator",
  "timestamp": "2026-03-08T12:00:00.000Z",
  "changes": {
    "skillInstall": {
      "name": "arxiv-skill",
      "version": "1.0.0"
    }
  },
  "skillInstall": {
    "manifest": {
      "...": "..."
    },
    "files": {
      "source/index.ts": "<base64 TypeScript source>",
      "dist/index.mjs": "<base64 bundled runtime artifact>"
    }
  }
}
```

The upgrade request should be signed the same way as other coordinator upgrade requests.

## Review vs Runtime

The intended split is:

- the upgrade proxy reads `sourceEntrypoint`
- the runtime executes `entrypoint`

That means the recommended workflow is:

- author in TypeScript
- review in TypeScript
- execute in `.mjs`

## Hot Reload

If hot reload is enabled, installed-skill changes are picked up automatically and the runtime recompiles the workflow plan.

Important implications:

- installing a skill can change the compiler hash
- disabling a skill can restore a previous compiled hash
- the agent should only reference tools that are actually installed and enabled

## Example Template

A complete non-browser arXiv skill template lives in:

- [`docs/templates/arxiv-skill/manifest.json.example`](/Users/gaj/.codex/worktrees/501e/agent-kit-templates/media-agent/docs/templates/arxiv-skill/manifest.json.example)
- [`docs/templates/arxiv-skill/source/index.ts.example`](/Users/gaj/.codex/worktrees/501e/agent-kit-templates/media-agent/docs/templates/arxiv-skill/source/index.ts.example)
- [`docs/templates/arxiv-skill/dist/index.mjs.example`](/Users/gaj/.codex/worktrees/501e/agent-kit-templates/media-agent/docs/templates/arxiv-skill/dist/index.mjs.example)

Use that as the starting point for new API/CLI-style creator skills.
