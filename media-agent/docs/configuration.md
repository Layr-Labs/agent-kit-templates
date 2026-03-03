# Configuration

Configuration is split between `config.toml` (static settings) and environment variables (secrets and deployment-specific values).

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

### Required

| Variable | Description |
|---|---|
| `MNEMONIC` | BIP-39 mnemonic phrase. Derives wallet addresses (ETH + SOL), email identity (EigenMail), and content signing key. |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models |
| `AI_GATEWAY_API_KEY` | AI Gateway key (for model routing) |

### Platform Selection

| Variable | Default | Description |
|---|---|---|
| `PLATFORM` | `twitter` | Which platform to use: `twitter` or `substack` |
| `PORT` | `3000` | HTTP server port |
| `TEST_MODE` | `false` | Enable fast timers for development |

### Twitter (when `PLATFORM=twitter`)

| Variable | Description |
|---|---|
| `TWITTER_POSTING_ENABLED` | Set `true` to actually post. When `false`, posts are logged locally (dry run). |
| `TWITTER_BEARER_TOKEN` | Bearer token for Twitter API v2 read access (search, Grok News) |
| `TWITTER_API_KEY` | OAuth 1.0a consumer key |
| `TWITTER_API_SECRET` | OAuth 1.0a consumer secret |
| `TWITTER_ACCESS_TOKEN` | OAuth 1.0a access token |
| `TWITTER_ACCESS_SECRET` | OAuth 1.0a access secret |
| `TWITTER_USERNAME` | The agent's Twitter username (for mention detection) |

### Substack (when `PLATFORM=substack`)

| Variable | Description |
|---|---|
| `SUBSTACK_HANDLE` | Substack handle (URL slug, e.g., `my-newsletter`) |
| `RSS_FEEDS` | Comma-separated RSS feed URLs for scanning |

### Optional Services

| Variable | Description |
|---|---|
| `REPLICATE_API_TOKEN` | Replicate API token for video generation (Veo 3.1) |
| `DATABASE_URL` | Postgres URL for encrypted state backup |
| `ELEVENLABS_API_KEY` | ElevenLabs API key for TTS narration |
| `ELEVENLABS_VOICE_ID` | ElevenLabs voice ID |

### Cloudflare R2 CDN

| Variable | Description |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 access key (enables R2 when set) |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | R2 bucket name |
| `R2_PUBLIC_URL` | Public URL prefix for CDN-served media |

### Browser

| Variable | Default | Description |
|---|---|---|
| `BROWSER_DISABLED` | `false` | Set `true` to disable Chrome auto-launch |
| `CDP_PORT` | `9222` | Chrome DevTools Protocol port |
| `CDP_URL` | `http://localhost:9222` | CDP endpoint URL |

---

## config.toml

The TOML configuration file controls models, timing, image generation, caching, and scanning behavior.

### Models

```toml
[models]
scoring = "claude-haiku-4-5-20251001"
ideation = "claude-opus-4-6"
generation = "google/gemini-3-pro-image"
caption = "claude-haiku-4-5-20251001"
editing = "claude-sonnet-4-6"
writing = "claude-sonnet-4-6"
engagement = "claude-haiku-4-5-20251001"
monologue = "claude-haiku-4-5-20251001"
reflection = "claude-sonnet-4-6"
compilation = "claude-sonnet-4-6"

[models.overrides]
flagship_ideation = "claude-opus-4-6"
```

Each task maps to a model ID resolved through the AI Gateway (`ai` SDK's `gateway()` function).

| Task | Used For | Default Model |
|---|---|---|
| `scoring` | Signal evaluation, topic ranking | Claude Haiku |
| `ideation` | Concept generation, workflow execution | Claude Opus |
| `generation` | Image generation | Gemini Pro Image |
| `caption` | Caption writing, headline generation, subject extraction | Claude Haiku |
| `editing` | Editorial review | Claude Sonnet |
| `writing` | Article writing (outline + sections) | Claude Sonnet |
| `engagement` | Mention replies, follow decisions, agent actions | Claude Haiku |
| `monologue` | Internal monologue generation | Claude Haiku |
| `reflection` | Worldview evolution | Claude Sonnet |
| `compilation` | SOUL + PROCESS + constitution → structured data | Claude Sonnet |

**Overrides**: The `[models.overrides]` section allows content-type-specific model overrides. The key format is `{contentType}_{task}`. For example, `flagship_ideation` uses Opus for flagship content ideation while quickhit ideation uses the default.

### Agent Timing

```toml
[agent]
tick_interval_ms = 30000          # Main loop tick interval (30s)
flagship_interval_ms = 21600000   # Flagship content interval (6h)
quickhit_cooldown_ms = 3600000    # Quick-hit cooldown (1h)
engagement_interval_ms = 300000   # Engagement check interval (5m)
reflection_interval_ms = 604800000 # Reflection interval (7 days)
max_caption_length = 100          # Maximum caption characters
recent_topic_window_ms = 86400000 # Deduplication window (24h)
```

### Posting Cooldown

```toml
[agent.posting]
min_cooldown_ms = 2700000    # Minimum between posts (45 min)
max_cooldown_ms = 3600000    # Maximum between posts (1 hour)
growth_factor = 1.5          # Cooldown growth factor
```

### Image Generation

```toml
[image]
variants = 3        # Number of image variants to generate per concept
max_retries = 3     # Maximum retry attempts on generation failure
```

### Cache TTLs

```toml
[cache]
topic_eval_ttl_ms = 3600000      # Topic evaluation cache (1h)
engagement_eval_ttl_ms = 1800000 # Engagement evaluation cache (30m)
image_prompt_ttl_ms = 86400000   # Image prompt cache (24h)
llm_response_ttl_ms = 3600000    # General LLM response cache (1h)
max_entries = 1000               # Maximum cache entries
```

### Scanning

```toml
[scan]
news_ttl_ms = 900000     # Grok News cache TTL (15 min)
timeline_ttl_ms = 120000 # Timeline/viral tweet cache TTL (2 min)
```

### R2 CDN

```toml
[r2]
enabled = false    # Auto-enabled when R2_ACCESS_KEY_ID is set
```

---

## Test Mode

When `TEST_MODE=true`, all timers are compressed for rapid iteration:

```toml
[agent.test_mode]
tick_interval_ms = 10000       # 10s ticks
flagship_interval_ms = 30000   # Flagship every 30s
quickhit_cooldown_ms = 15000   # Quick-hit every 15s
engagement_interval_ms = 60000 # Engagement every 60s
reflection_interval_ms = 300000 # Reflection every 5 min
min_cooldown_ms = 300000       # 5 min post cooldown
max_cooldown_ms = 300000

[image.test_mode]
variants = 1       # Single variant (faster)
max_retries = 1

[cache.test_mode]
topic_eval_ttl_ms = 60000
engagement_eval_ttl_ms = 60000
image_prompt_ttl_ms = 60000
llm_response_ttl_ms = 60000

[scan.test_mode]
news_ttl_ms = 60000
timeline_ttl_ms = 30000
```

Additionally, the `ProcessExecutor` compresses all compiled workflow intervals:

| Original Interval | Test Mode Interval |
|---|---|
| ≥ 7 days | 60 seconds |
| ≥ 24 hours | 30 seconds |
| ≥ 6 hours | 20 seconds |
| ≥ 1 hour | 15 seconds |
| ≥ 5 minutes | 10 seconds |
| < 5 minutes | Capped at 10 seconds |

---

## Model Routing

Models are resolved through the `gateway()` function from the `ai` SDK. This supports routing to different providers:

```
claude-haiku-4-5-20251001    → Anthropic
claude-sonnet-4-6            → Anthropic
claude-opus-4-6              → Anthropic
google/gemini-3-pro-image    → Google (via gateway)
```

The model ID format is `provider/model-name` for gateway routing, or just `model-name` for the default provider.

---

## Data Directory

All runtime data is stored in `.data/` (gitignored):

```
.data/
├── agent.db                 # SQLite database (posts, events)
├── events.jsonl             # Event audit log
├── compiled-agent.json      # Cached compilation result
├── process-timers.json      # Workflow timer state
├── worldview.json           # Evolved worldview
├── posts.json               # Post store (Twitter)
├── local-posts.json         # Dry-run posts
├── cache-signals.json       # Signal cache persistence
├── cache-eval.json          # Evaluation cache persistence
├── cache-images.json        # Image cache persistence
├── card_details.json        # Prepaid card details
├── substack-account.json    # Substack account state
├── engagement-state.json    # Engagement loop state
├── followed-users.json      # Follow tracking
├── vetted-followers.json    # Vetted follower tracking
├── chrome-profile/          # Chrome user data directory
├── images/                  # Generated images
└── articles/                # Written articles (markdown)
```