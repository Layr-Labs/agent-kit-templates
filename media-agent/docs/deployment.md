# Deployment

## Quick Start (Development)

```bash
# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Customize your agent
# Edit SOUL.md, PROCESS.md, constitution.md

# Run in development (auto-reload on file changes)
bun dev

# Run in production mode
bun start
```

The agent starts on port 3000 (configurable via `PORT` env var). Chrome is auto-launched for browser automation unless `BROWSER_DISABLED=true`.

---

## Docker

The Docker image bundles Chrome, a virtual display (Xvfb), and the Bun runtime. This is the recommended way to deploy.

### Build

```bash
docker build -t media-agent .
```

### Run

```bash
docker run -d \
  --name media-agent \
  -p 3000:3000 \
  -v media-agent-data:/app/.data \
  --env-file .env \
  media-agent
```

### Dockerfile Walkthrough

The image is built in layers:

1. **Base**: `oven/bun:1` (Bun runtime on Debian)
2. **System dependencies**: Chrome prerequisites (X11, fonts, graphics libraries)
3. **Chrome**: Google Chrome Stable via official `.deb`
4. **App dependencies**: `bun install` from `package.json` and `bun.lock`
5. **App source**: `src/`, `tsconfig.json`, agent files (`SOUL.md`, `PROCESS.md`, `constitution.md`), `config.toml`
6. **Entrypoint**: `/entrypoint.sh`

Key settings:
- `DISPLAY=:99` — Virtual display for headless Chrome
- `NODE_ENV=production`
- `PORT=3000`
- Volume at `/app/.data` for persistent state

### entrypoint.sh

The entrypoint script starts three processes in sequence:

```
1. Xvfb :99          Virtual display (1920×1080, 24-bit color)
2. openbox            Window manager (Chrome requires one)
3. google-chrome      Headless Chrome with CDP on port 9222
4. bun src/main.ts    The agent (waits for Chrome to be ready)
```

Chrome is launched with:
- `--no-sandbox` (required in Docker)
- `--disable-dev-shm-usage` (avoids shared memory issues)
- `--disable-blink-features=AutomationControlled` (reduces bot detection)
- `--remote-debugging-port=9222` (CDP for browser-autopilot)
- `--user-data-dir=/app/.data/chrome-profile` (persistent sessions)

### Persistent Data

Mount `/app/.data` as a Docker volume to persist:
- SQLite database (posts, events)
- Compiled agent cache
- Browser sessions (Chrome profile)
- Generated images and articles
- Worldview evolution history
- Engagement state

Without persistence, the agent starts fresh every restart — it will re-compile, lose its post history, and need to re-login to platforms.

---

## TLS with Caddy

A `Caddyfile` is included for automatic HTTPS via Caddy reverse proxy.

### Setup

1. Copy TLS environment config:
   ```bash
   cp .env.example.tls .env.tls
   ```

2. Edit `.env.tls`:
   ```bash
   DOMAIN=yourdomain.com
   APP_PORT=3000
   ```

3. Run Caddy alongside the agent:
   ```bash
   caddy run --config Caddyfile
   ```

### What Caddy Does

- Terminates TLS (uses provided certificates at `/run/tls/`)
- Reverse proxies to the agent on `localhost:3000`
- Adds security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection)
- Health checks the agent at `/api/health` every 30 seconds
- Limits request body size to 10MB
- Provides HTTP → HTTPS redirect for non-localhost domains
- HTTP health check at `:80/health` (always available)

### Docker Compose Example

```yaml
version: '3.8'
services:
  agent:
    build: .
    volumes:
      - agent-data:/app/.data
    env_file: .env
    restart: unless-stopped

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
      - ./certs:/run/tls:ro
    environment:
      - DOMAIN=yourdomain.com
      - APP_PORT=3000
    depends_on:
      - agent
    restart: unless-stopped

volumes:
  agent-data:
  caddy-data:
  caddy-config:
```

---

## Production Checklist

### Required

- [ ] `MNEMONIC` set (generates wallet addresses and email identity)
- [ ] `ANTHROPIC_API_KEY` set (or `AI_GATEWAY_API_KEY` for gateway routing)
- [ ] `SOUL.md`, `PROCESS.md`, `constitution.md` customized for your agent
- [ ] `.data` volume mounted for state persistence

### Platform-Specific

**Twitter:**
- [ ] `PLATFORM=twitter`
- [ ] All Twitter API credentials set (Bearer token + OAuth 1.0a)
- [ ] `TWITTER_USERNAME` set
- [ ] `TWITTER_POSTING_ENABLED=true` when ready to go live (start with `false` for dry runs)

**Substack:**
- [ ] `PLATFORM=substack`
- [ ] `SUBSTACK_HANDLE` set
- [ ] `RSS_FEEDS` configured with data sources
- [ ] Chrome running (browser automation required)

### Optional

- [ ] `R2_*` credentials for Cloudflare CDN
- [ ] `REPLICATE_API_TOKEN` for video generation
- [ ] `ELEVENLABS_API_KEY` for TTS narration
- [ ] TLS certificates and Caddy for HTTPS

### Recommended

- [ ] Start with `TEST_MODE=true` to verify everything works with fast timers
- [ ] Start with `TWITTER_POSTING_ENABLED=false` for dry runs
- [ ] Monitor via `/api/console/stream` SSE endpoint
- [ ] Check `/api/health` for uptime monitoring

---

## Monitoring

### Health Endpoint

```bash
curl http://localhost:3000/api/health
```

Returns the agent name, uptime, current state, and timestamp.

### Live Console

Connect to the SSE stream to watch the agent think and act in real-time:

```bash
curl -N http://localhost:3000/api/console/stream
```

The stream replays the last 50 events on connection, then streams new events. Each event is a JSON object with a `type` field. See [HTTP API](./api.md) for all event types.

### Logs

The agent logs all events to stdout (formatted for readability) and to `.data/events.jsonl` (structured JSON, one event per line).

Log format:
```
[12:00:00] [SCANNING]        42 signals ingested (42 total in buffer).
[12:00:05] [SHORTLISTING]    Top pick: "AI regulation debate" (8.2).
[12:00:10] [IDEATING]        Concept: "The algorithm sees all" — irony approach.
```

---

## Resource Usage

The main resource consumers:
- **Chrome**: ~200-400 MB RAM (required for Substack, optional for Twitter)
- **Bun runtime**: ~50-100 MB RAM
- **SQLite database**: Minimal disk (grows with post count)
- **Generated images**: ~1-5 MB per image
- **LLM API calls**: The primary cost — configurable via model selection and timing