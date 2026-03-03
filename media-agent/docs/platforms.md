# Platforms

Platforms are pluggable adapters that handle publishing, engagement, and signal scanning. Set `PLATFORM` env var to select: `twitter` (default) or `substack`.

## Platform Adapter Interface

```typescript
interface PlatformAdapter {
  readonly name: string
  init(events: EventBus): Promise<void>
  publish(opts: PublishOptions): Promise<PublishResult>
  engage(): Promise<void>
  getScanner(): Scanner
  supportedContentTypes(): ('image' | 'article' | 'video')[]
  findReference?(topicSummary: string): Promise<string | undefined>
  shutdown?(): Promise<void>
}

interface PublishOptions {
  text: string
  imagePath?: string
  videoPath?: string
  referenceId?: string
  contentType: 'image' | 'article' | 'video'
  metadata?: Record<string, unknown>
}

interface PublishResult {
  platformId: string
  url?: string
}
```

---

## Twitter

**Source**: `src/platform/twitter/`

### Authentication

Twitter requires two sets of credentials:

| Credential Set | Purpose | Env Vars |
|---|---|---|
| Bearer Token | Read-only API access (search, Grok News) | `TWITTER_BEARER_TOKEN` |
| OAuth 1.0a | Read-write access (posting, mentions, timeline) | `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` |

### Supported Content Types

- `image` — Tweet with image attachment
- `video` — Tweet with video attachment (chunked upload with processing poll)

### TwitterClient

**Source**: `src/platform/twitter/client.ts`

The main client handles all Twitter operations:

#### Posting

| Method | Description |
|---|---|
| `postCartoon(opts)` | Post a tweet with an image. Uploads media via v1 API, tweets via v2. |
| `postVideo(opts)` | Post a tweet with video. Chunked upload, polls for processing completion. |
| `reply(opts)` | Reply to a tweet. |

All posting methods check `TWITTER_POSTING_ENABLED`. When `false`, posts are logged locally with a `[DRY RUN]` prefix and a local UUID is returned. This is the default for safe development.

#### Reading

| Method | Description |
|---|---|
| `getMentions(sinceTimestamp?)` | Get mentions of the agent's account |
| `getHomeTimeline(maxResults?)` | Get the home timeline |
| `findTweetAbout(query)` | Search for a relevant tweet to quote |
| `getThreadContext(tweetId, maxDepth?)` | Walk up the reply chain to build conversation context |

#### Social Graph

| Method | Description |
|---|---|
| `follow(userId)` | Follow a user |
| `unfollow(userId)` | Unfollow a user |
| `blockUser(userId)` | Block a user |
| `getFollowingCount()` | Get the agent's following count |
| `getFollowing()` | Get the full following list with bios |

### TwitterV2Reader

**Source**: `src/platform/twitter/twitterapi-v2.ts`

Implements the `TwitterReadProvider` interface using the official Twitter API v2:

```typescript
interface TwitterReadProvider {
  readonly name: string
  search(query: string, queryType?: 'Latest' | 'Top'): Promise<SearchResult>
  getMentions(userName: string, sinceTime?: number): Promise<MentionsResult>
  getUserInfo(userName: string): Promise<User | null>
  getFollowers(userName: string): Promise<FollowersResult>
  getUserTweets(userName: string): Promise<UserTweetsResult>
  findTopTweet(query: string, minLikes?: number): Promise<string | undefined>
  getTweetById(tweetId: string): Promise<Tweet | null>
}
```

Internal user ID resolution is cached to minimize API calls.

### Scanning

Three scanners run in parallel during each scan cycle:

#### GrokNewsScanner

**Source**: `src/platform/twitter/scanner/grok-news.ts`

Uses the X News API (`GET /2/news/search`) to find trending stories:

- Queries five categories: technology, science, entertainment, sports, business
- Returns up to 10 stories per category
- Each story includes: headline, summary, hook, category, keywords, entities, and related tweet IDs
- Results cached for `news_ttl_ms` (default 15 minutes)
- Deduplicates by Grok story ID

#### ViralTweetScanner

**Source**: `src/platform/twitter/scanner/viral-tweets.ts`

Searches for viral tweets using three query tiers:

| Query | Minimum Likes |
|---|---|
| General viral | 50,000 |
| Tech/AI specific | 10,000 |
| Open source/startup | 5,000 |

All queries filter to English, non-retweets. Results are sorted by likes and cached for `timeline_ttl_ms` (default 2 minutes). Media URLs (photos, videos) are extracted from tweet entities.

#### TimelineScanner

**Source**: `src/platform/twitter/scanner/timeline.ts`

Reads the agent's home timeline (tweets from accounts it follows):

- Fetches 50 recent tweets via the v2 home timeline API
- Filters to tweets with 200+ likes
- Creates signals with engagement metrics
- Cached for `timeline_ttl_ms` (default 2 minutes)

### Engagement

**Source**: `src/platform/twitter/engagement.ts`

The `EngagementLoop` handles all audience interaction:

#### Mention Processing

1. Fetch new mentions since last check
2. Filter already-replied mentions (persisted in `engagement-state.json`)
3. Block spam accounts (crypto spam, homoglyph obfuscation, link spam, bulk tags)
4. Pre-filter low-effort mentions using a heuristic score:
   - High followers → +3 points
   - High engagement → +2 points
   - Word count > 10 → +2 points
   - Contains question → +1 point
   - Low-effort text ("lol", "nice") → -3 points
   - Hostile language → -5 points
   - Threshold: score < 3 is skipped
5. Build thread context (walks up the reply chain for conversation context)
6. LLM batch-decides which mentions deserve replies (default: skip 90%+)
7. For approved replies: post the reply, sign it, store in database

#### Follow Decisions

After processing mentions, the agent considers following the most interesting person:

1. Check if following count is below cap (500)
2. Score candidates by mention quality
3. Deep vet via Twitter API: full profile, recent tweets
4. LLM decides based on follow criteria:
   - **Follow**: Builders, open thinkers, authentic voices, people who ship
   - **Don't follow**: Corporate accounts, engagement farmers, generic content

#### Following Audit

Periodic audit of the following list:

1. Sample 10 random accounts from the following list
2. Fetch their recent tweets
3. LLM evaluates each: KEEP or UNFOLLOW
4. Unfollow accounts that no longer earn their spot

#### Follower Vetting

Checks new followers and blocks spam:

- Mass-follow bots (high following, low followers)
- Zero-content accounts
- Empty bio + high following patterns
- Crypto/scam bio patterns
- Notable followers (5K+) are logged on console

#### Timeline Engagement

Proactive engagement with the home timeline:

1. Filter to fresh, unengaged tweets from followed accounts
2. Sort by engagement, take top 5
3. Build thread context for each
4. LLM decides which deserve a reply
5. Replies should be "a sharp friend jumping into the conversation"

---

## Substack

**Source**: `src/platform/substack/`

### Architecture

Substack doesn't have a public posting API, so all publishing is done via **browser automation** using `browser-autopilot`. The agent controls a headless Chrome instance to navigate, type, upload, and click through the Substack web interface.

### Supported Content Types

- `article` — Full long-form article with optional header image
- `image` — Substack Note with optional image

### SubstackClient

**Source**: `src/platform/substack/client.ts`

#### Authentication

| Method | Description |
|---|---|
| `isLoggedIn()` | Tests the Substack API via browser to check session |
| `login()` | Signs in via email verification using EigenMail |
| `ensureLoggedIn()` | Re-authenticates if session has expired |

Login flow:
1. Navigate to `substack.com/sign-in`
2. Enter the agent's EigenMail address
3. Use `wait_for_email` tool to receive the verification email
4. Extract magic link or 6-digit code from the email
5. Complete verification

#### Article Publishing

| Method | Description |
|---|---|
| `publishArticle(opts)` | Publish a full article with title, body, subtitle, and optional header image |
| `publishNote(opts)` | Publish a short note with optional image |

Article publishing flow:
1. Ensure logged in (re-authenticate if needed)
2. Save article body to markdown file
3. Navigate to the post editor
4. Upload header image to Substack CDN (base64 via their API)
5. Insert image into TipTap editor via ProseMirror transaction
6. Inject article content via `paste_content`
7. Browser agent fills in title/subtitle and clicks Publish

#### Image Upload

Images are uploaded to Substack's CDN via their internal `/api/v1/image` endpoint. The image is base64-encoded, chunked (500KB chunks to avoid browser memory issues), and POSTed. The CDN URL, width, and height are returned.

The image is then inserted into the editor using a ProseMirror transaction that creates an `image2` node in the TipTap schema.

#### Comment Reading

| Method | Description |
|---|---|
| `getRecentComments()` | Extract recent comments via browser automation |
| `replyToComment(id, text)` | Reply to a specific comment |

### SubstackEngagement

**Source**: `src/platform/substack/engagement.ts`

LLM-powered comment response:

1. Fetch recent comments via browser
2. LLM decides which deserve a reply (thoughtful questions, interesting perspectives)
3. Skip spam, generic praise, or low-effort comments
4. Post replies in the agent's authentic voice

Engagement is skipped until the agent has published at least one piece of content.

### SubstackScanner

**Source**: `src/platform/substack/scanner/index.ts`

Wraps the `RSSScanner`:

1. Fetches all configured RSS feed URLs (from `RSS_FEEDS` env var)
2. Parses XML manually (extracts `<title>`, `<link>`, `<description>`, `<author>`)
3. Deduplicates by URL
4. Emits `headline` signals with TTL (default 15 minutes)

### Account Setup

**Source**: `src/skills/browser/substack-setup/index.ts`

The `setup_substack_account` tool handles first-time Substack setup:

1. Navigate to `substack.com`, click "Start writing"
2. Enter agent's EigenMail address
3. Wait for verification email, complete sign-in
4. Set up profile (name, bio)
5. Create publication (name, handle, description)
6. Skip paid plans / Stripe setup
7. Save account state to `.data/substack-account.json`

The bootstrap workflow (auto-generated by the compiler) calls this on first run.