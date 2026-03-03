# HTTP API

The agent runs a Fastify HTTP server (default port 3000) with REST endpoints and a Server-Sent Events (SSE) stream for the live console.

## Endpoints

### `GET /api/health`

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "agent": "Kenji Muraoka",
  "uptime": 3600.5,
  "state": "scanning",
  "ts": 1700000000000
}
```

| Field | Type | Description |
|---|---|---|
| `status` | string | Always `"ok"` |
| `agent` | string | Agent name from compiled identity |
| `uptime` | number | Process uptime in seconds |
| `state` | string | Current agent state |
| `ts` | number | Unix timestamp (ms) |

---

### `GET /api/feed`

Published posts feed, ordered by most recent.

**Query Parameters:**

| Parameter | Default | Description |
|---|---|---|
| `limit` | 20 | Number of posts to return |
| `offset` | 0 | Pagination offset |

**Response:**

```json
[
  {
    "id": "uuid",
    "platform_id": "1234567890",
    "content_id": "uuid",
    "text": "Post caption",
    "image_url": "/images/concept-v1.png",
    "video_url": null,
    "article_url": null,
    "reference_id": null,
    "type": "flagship",
    "signature": "0x...",
    "signer_address": "0x...",
    "posted_at": 1700000000000,
    "likes": 0,
    "shares": 0,
    "comments": 0,
    "views": 0,
    "engagement_checked_at": 0
  }
]
```

---

### `GET /api/worldview`

Current worldview (beliefs, themes, and evolution history).

**Response:**

```json
{
  "beliefs": ["Geopolitics is shaped by incentives, not ideology", "..."],
  "punchesUp": ["Cable news hysteria", "..."],
  "respects": ["Journalists who do original reporting", "..."],
  "evolvedAt": 1700000000000,
  "changelog": [
    {
      "date": 1700000000000,
      "summary": "After reflecting on recent coverage..."
    }
  ]
}
```

If the worldview hasn't been evolved yet, returns the initial values from the compiled identity.

---

### `GET /api/identity`

Full agent identity.

**Response:**

```json
{
  "name": "Kenji Muraoka",
  "tagline": "Geopolitical intelligence, delivered daily",
  "creator": "@you",
  "born": "March 14, 1981 — Kobe, Japan",
  "bio": "I'm Kenji. Born in Kobe in '81...",
  "constitution": "## Sovereignty\n...",
  "persona": "A measured, precise analyst...",
  "beliefs": ["..."],
  "themes": ["..."],
  "punchesUp": ["..."],
  "respects": ["..."],
  "voice": "Measured and precise...",
  "restrictions": ["..."],
  "motto": "What happened. Why it matters. What to watch."
}
```

---

### `GET /api/wallets`

Agent wallet addresses.

**Response:**

```json
{
  "evm": "0x1234567890abcdef1234567890abcdef12345678",
  "solana": "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
}
```

Returns `{ evm: null, solana: null }` if no mnemonic is configured.

---

### `GET /api/console/state`

Current agent state.

**Response:**

```json
{
  "state": "scanning",
  "ts": 1700000000000
}
```

---

### `GET /api/console/stream`

Server-Sent Events (SSE) stream of all console events. This is the agent's live consciousness — every thought, action, and state transition is broadcast here.

**Response:** `text/event-stream`

On connection, the server replays the most recent 50 events (history), then streams new events in real-time.

**Event Format:**

```
data: {"type":"monologue","text":"Scanning for signals...","state":"scanning","ts":1700000000000}

data: {"type":"post","platformId":"1234567890","text":"Post caption","imageUrl":"/images/concept-v1.png","ts":1700000000000}
```

---

## Event Types

All events include a `ts` field (Unix timestamp in milliseconds).

### `monologue`

The agent's internal thoughts. This is the live monologue — thinking out loud.

```json
{
  "type": "monologue",
  "text": "3 signals to evaluate. Batch-scoring...",
  "state": "shortlisting",
  "ts": 1700000000000
}
```

### `scan`

A scan cycle completed.

```json
{
  "type": "scan",
  "source": "twitter",
  "signalCount": 42,
  "ts": 1700000000000
}
```

### `shortlist`

Topics shortlisted from signals.

```json
{
  "type": "shortlist",
  "topics": [
    { "id": "uuid", "summary": "AI regulation debate heats up", "score": 8.2 }
  ],
  "ts": 1700000000000
}
```

### `ideate`

Content concepts generated.

```json
{
  "type": "ideate",
  "concepts": [
    { "id": "uuid", "caption": "The algorithm sees all" }
  ],
  "topicId": "uuid",
  "ts": 1700000000000
}
```

### `generate`

Image generation started.

```json
{
  "type": "generate",
  "prompt": "ARTIST STYLE — Editorial Cartoon...",
  "variantCount": 3,
  "ts": 1700000000000
}
```

### `critique`

Concept critique completed.

```json
{
  "type": "critique",
  "critique": "Strong visual metaphor but caption could be punchier",
  "selected": 0,
  "ts": 1700000000000
}
```

### `post`

Content published.

```json
{
  "type": "post",
  "platformId": "1234567890",
  "text": "The algorithm sees all",
  "imageUrl": "/images/concept-v1.png",
  "ts": 1700000000000
}
```

### `engage`

Reply sent to audience.

```json
{
  "type": "engage",
  "targetId": "1234567890",
  "text": "Good question — here's what I think...",
  "ts": 1700000000000
}
```

### `skill`

A skill tool was invoked.

```json
{
  "type": "skill",
  "skill": "email",
  "action": "{\"to\":\"someone@example.com\"}",
  "ts": 1700000000000
}
```

### `state_change`

Agent state transition.

```json
{
  "type": "state_change",
  "from": "scanning",
  "to": "shortlisting",
  "ts": 1700000000000
}
```

### `metric`

Numerical metric recorded.

```json
{
  "type": "metric",
  "name": "signal_count",
  "value": 42,
  "ts": 1700000000000
}
```

---

## Agent States

The agent transitions between these states during its work cycle:

| State | Description |
|---|---|
| `scanning` | Scanning data sources for signals |
| `monologuing` | Processing internal thoughts |
| `shortlisting` | Evaluating and ranking signals into topics |
| `ideating` | Generating content concepts |
| `critiquing` | Self-critiquing concepts |
| `generating` | Generating images |
| `composing` | Writing captions |
| `writing` | Writing long-form articles |
| `publishing` | Publishing content to platform |
| `posting` | Posting to platform (sub-state of publishing) |
| `engaging` | Interacting with audience |

---

## Static Files

Generated images are served at `/images/{filename}` via Fastify static file serving from `.data/images/`.

---

## CORS

The SSE stream includes `Access-Control-Allow-Origin: *` for cross-origin access from frontend dashboards.