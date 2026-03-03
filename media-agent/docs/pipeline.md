# Content Pipeline

The content pipeline transforms raw signals from the internet into published content. Each stage is implemented as a pipeline skill (tool) that the agent calls during workflow execution.

## Pipeline Overview

```
  Data Sources                Pipeline                         Platform
  ──────────                  ────────                         ────────

  Grok News API  ─┐
  Viral Tweets   ─┼─► Scanner ─► Scorer ─► Ideator ─► Generator ─┐
  Home Timeline  ─┤                          │                     │
  RSS Feeds      ─┘                     Captioner              Editor
                                             │                     │
                                             └─────────┬───────────┘
                                                       ▼
                                                   Publisher ──► Twitter
                                                       │              or
                                                   TextWriter ──► Substack
```

## Stage 1: Scanner

**Source**: `src/pipeline/scanner.ts`
**Tool**: `scan`

The `ScannerRegistry` aggregates signals from all registered scanners. Each platform provides its own scanner implementation.

### Signal Type

Every piece of incoming data is normalized into a `Signal`:

```typescript
interface Signal {
  id: string           // UUID
  source: string       // "twitter", "rss", etc.
  type: string         // "headline", "tweet", etc.
  content: string      // The actual content text
  url: string          // Source URL
  sourceId?: string
  author?: string
  mediaUrls?: string[]
  metrics?: {
    likes?: number
    shares?: number
    retweets?: number
    comments?: number
    score?: number
    rank?: number
  }
  ingestedAt: number   // Unix timestamp
  expiresAt: number    // When to evict from buffer
  metadata?: Record<string, unknown>
}
```

### Twitter Scanners

Three scanners run in parallel:

| Scanner | Source | What It Finds | Cache TTL |
|---|---|---|---|
| `GrokNewsScanner` | X News API (`/2/news/search`) | Trending stories across categories (technology, science, entertainment, sports, business) | `news_ttl_ms` (15 min) |
| `ViralTweetScanner` | Twitter search API | Tweets with 50K+ likes, tech/AI tweets with 10K+ likes, open source tweets with 5K+ likes | `timeline_ttl_ms` (2 min) |
| `TimelineScanner` | Home timeline API | Quality tweets (200+ likes) from accounts the agent follows | `timeline_ttl_ms` (2 min) |

Signals are deduplicated by tweet ID or Grok story ID. Stale signals (past `expiresAt`) are pruned on each scan.

### Substack Scanner

The `SubstackScanner` wraps an `RSSScanner` that fetches configured RSS feeds, parses XML, and emits headline signals. Feed URLs are configured via the `RSS_FEEDS` environment variable.

---

## Stage 2: Scorer

**Source**: `src/pipeline/scorer.ts`
**Tool**: `score_signals`

The scorer batch-evaluates all cached signals into ranked topics. This is the agent's editorial judgment — it decides what's worth creating content about.

### Scoring Dimensions

Each topic is scored on six weighted dimensions (0-10):

| Dimension | Weight | Description |
|---|---|---|
| Virality | 0.15 | Is this already trending? Will it be shared? |
| Content Potential | 0.15 | Can the agent create compelling content about this? |
| Audience Breadth | 0.10 | Will most people understand this, or is it niche? |
| Timeliness | 0.10 | Is this happening right now? How fresh? |
| Creativity | 0.15 | How many creative angles does this topic offer? |
| **Worldview Alignment** | **0.35** | Does this connect to the agent's themes and beliefs? |

Worldview alignment is the heaviest weight. The agent's audience follows it for *its perspective*, so a viral topic with no worldview connection loses to a smaller topic that resonates with the agent's themes.

### Composite Score

```
composite = virality × 0.15 + contentPotential × 0.15 + audienceBreadth × 0.10
          + timeliness × 0.10 + creativity × 0.15 + worldviewAlignment × 0.35
```

### Worldview Alignment Guide

| Score | Meaning |
|---|---|
| 9-10 | Directly about the agent's core themes |
| 7-8 | News the agent can spin into its themes |
| 5-6 | General culture with a discoverable angle |
| 3-4 | Mainstream news with a weak connection |
| 1-2 | Random viral content with zero connection |
| 0 | Violates a restriction |

### Filtering

Topics are filtered through several gates:

1. **Safety check**: Content policy violations are rejected (hate speech, active tragedies, harassment of private individuals, constitutional restrictions).
2. **Worldview threshold**: Topics scoring below 4 on worldview alignment are dropped ("not my beat").
3. **Deduplication**: Topics too similar to recently published content are dropped (Jaccard similarity > 0.3 on summary words).
4. **Shortlisting**: Top 5 topics by composite score are shortlisted.

Results are cached for `topic_eval_ttl_ms` (default 1 hour).

### Output: Topic

```typescript
interface Topic {
  id: string
  signals: string[]      // Signal IDs this topic covers
  summary: string        // One-line summary
  scores: TopicScores    // All six dimensions + composite
  safety: { passed: boolean; reason?: string }
  status: 'candidate' | 'shortlisted' | 'selected' | 'posted' | 'rejected'
  evaluatedAt: number
}
```

---

## Stage 3: Ideator

**Source**: `src/pipeline/ideator.ts`
**Tools**: `generate_concepts`, `critique_concepts`

### Concept Generation

For the top-scoring topic, the ideator generates N content concepts (default 3). Each concept has five components:

| Component | Description |
|---|---|
| `visual` | What the content depicts — characters, setting, key visual element, background detail |
| `composition` | Visual layout — focal point, eye movement, spatial relationships, scale |
| `caption` | The one-liner that accompanies the image (standalone + amplified by visual) |
| `approach` | Creative mechanism — irony, absurdism, exaggeration, juxtaposition, etc. |
| `reasoning` | Why the concept works — what tension is created, what expectation is subverted |

Rules enforced:
- Each concept uses a **different angle** (no variations of the same idea)
- Keep visuals simple — single panel, 1-3 characters max
- No text in the image
- Recent posts are provided as context to avoid repetition

The worldview store provides recurring themes context to keep concepts aligned with the agent's evolving perspective.

### Self-Critique

After generation, the ideator critiques its own concepts on four dimensions:

| Dimension | Description |
|---|---|
| Quality (1-10) | Is this actually good? Would a real person engage? |
| Clarity (1-10) | Will people get it instantly? |
| Shareability (1-10) | Would someone share this? |
| Execution (1-10) | Can this be produced clearly? |

Overall score is the average. The highest-scoring concept becomes `bestConcept` in the pipeline state.

Scoring expectations: 5-7 is normal range, 7 is good, 8 is great, 9 means high confidence.

---

## Stage 4: Generator

**Source**: `src/pipeline/generator.ts`
**Tool**: `generate_image`

Generates image variants from the best concept using the configured generation model (default: Gemini Pro Image).

### Prompt Building

The generator constructs a detailed image prompt from:

1. **Style prompt** — from the compiled visual style (if defined in SOUL.md)
2. **Color mood** — auto-inferred from concept text:
   - Tech/AI topics → cool (slate blue, teal, muted purple)
   - Chaos/breaking topics → hot (vermillion, amber, charcoal)
   - Business/corporate topics → corporate (forest green, navy, gold)
   - Default → warm (ochre, warm gray, dusty rose)
3. **Concept details** — approach, visual description, composition, reasoning
4. **Rendering rules** — zero text in image, single panel, max 3 characters, clean background

### Reference Images

Before generating, the system extracts named subjects (people, products, companies) from the concept and fetches reference images from Wikipedia. These are passed to the generation model to improve likeness accuracy for recognizable subjects.

### Multi-Variant Generation

By default, 3 variants are generated (configurable in `config.toml`). Each variant is:

1. Generated via `generateText()` with file output
2. Processed through `sharp` for signature overlay (if configured)
3. Saved to `.data/images/{conceptId}-v{N}.png`
4. Uploaded to Cloudflare R2 (if enabled)

Results are cached by prompt hash for `image_prompt_ttl_ms` (default 24 hours).

### Retry Logic

If image generation fails or the editor rejects the image, the generator supports retry with feedback:

```typescript
await generator.retry(concept, "The image has text in it — regenerate without any text", attempt)
```

Maximum retries: `max_retries` from config (default 3).

---

## Stage 5: Editor

**Source**: `src/pipeline/editor.ts`
**Tool**: `editorial_review`

A separate editorial intelligence that reviews every piece of content before publication. This is the quality gate — content that doesn't pass doesn't get published.

### Review Checks

1. **Duplicate check**: Is this too similar to a previous post? Compares against all past posts and content topics.
2. **Quality gate**: Overall quality score (1-10). Below 6 = reject.
3. **Caption review**: Is the caption punchy enough? If improvable, provides a revised caption.
4. **Image review**: Checks for text leaked into the image, visual clarity, intentional character rendering, and composition match.
5. **Brand alignment**: Does this fit the agent's identity and themes?

The editor reviews the actual generated image (multimodal input — the image file is read and passed to the LLM) alongside the concept and caption text.

### Output

```typescript
{
  approved: boolean       // Pass/fail
  caption: string         // Original or revised caption
  reason: string          // Editorial reasoning
  qualityScore: number    // 1-10
}
```

If rejected, the reason is logged and the workflow may retry with different generation parameters or skip the topic entirely.

---

## Stage 6: Captioner

**Source**: `src/pipeline/captioner.ts`
**Tool**: `write_caption`

Generates 5 caption candidates for the best concept, each taking a different angle. The LLM picks the best one with reasoning.

### Rules

- Under `max_caption_length` characters (default 100)
- Standalone engaging — text alone should make someone pause
- Amplified by the visual — reading text then seeing image = more impact
- No hashtags, no emojis
- In the agent's authentic voice
- Recent captions provided as context to avoid repetition

---

## Stage 7: Text Writer

**Source**: `src/pipeline/text-writer.ts`
**Tool**: `write_article`

Writes long-form articles in three phases:

### Phase 1: Outline

Generates a structured outline with:
- **Thesis**: Central argument (one sentence)
- **Hook**: Opening that grabs attention
- **Sections** (3-5): Each with title, key argument, evidence, and transition
- **Conclusion**: Landing point

### Phase 2: Section-by-Section Writing

Each section is written independently with:
- Target word count proportional to overall length
- The thesis and section details as context
- Rules: no filler, concrete examples, varied sentence length, authentic voice

Leading headers from LLM output are stripped and replaced with the section title.

### Phase 3: Headline Generation

3 headline/subtitle pairs are generated, ranked by strength. Rules:
- Headline under 80 characters
- Specific, not vague
- Creates curiosity or tension
- Subtitle previews the argument without giving everything away

### Length Options

| Option | Target Words |
|---|---|
| `short` | ~500 |
| `medium` | ~1500 |
| `long` | ~3000 |

### Style Options

| Style | Description |
|---|---|
| `essay` | Long-form essay (default) |
| `analysis` | Analytical breakdown |
| `satire` | Satirical piece |
| `tutorial` | How-to guide |

---

## Stage 8: Publisher

**Source**: `src/skills/pipeline/publisher/index.ts`
**Tools**: `publish_image`, `publish_article`

### Image Publishing

1. Retrieves the best concept, caption (editor-revised if applicable), and first image path
2. Optionally finds a reference tweet/post to quote (via `platform.findReference`)
3. Signs the caption with the agent's ETH key
4. Calls `platform.publish()` with the content
5. Creates `Content` and `Post` records
6. Saves the post to the SQLite database
7. Emits a `post` event

### Article Publishing

1. Retrieves the article (title, subtitle, body) and best concept
2. Includes header image if one was generated
3. Calls `platform.publish()` with article content type and metadata
4. Creates and persists the `Post` record
5. Emits a `post` event

### Post Types

| Type | Description |
|---|---|
| `flagship` | Main content (highest priority workflow) |
| `quickhit` | Quick reaction to breaking topics |
| `paid` | Sponsored/paid content |
| `article` | Long-form article |
| `engagement` | Reply to audience |