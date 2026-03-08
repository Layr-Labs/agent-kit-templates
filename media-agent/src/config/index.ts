import { readFileSync } from 'fs'
import { parse } from 'smol-toml'
import { resolve } from 'path'
import { resolveModel, resolveModelId, type ModelTask } from './models.js'

interface TomlConfig {
  models: Record<string, string> & { overrides?: Record<string, string>; reasoning_effort?: string }
  agent: {
    tick_interval_ms: number
    flagship_interval_ms: number
    quickhit_cooldown_ms: number
    engagement_interval_ms: number
    reflection_interval_ms: number
    max_caption_length: number
    recent_topic_window_ms: number
    posting: { min_cooldown_ms: number; max_cooldown_ms: number; growth_factor: number }
    test_mode?: {
      tick_interval_ms: number; flagship_interval_ms: number; quickhit_cooldown_ms: number
      engagement_interval_ms: number; reflection_interval_ms: number
      min_cooldown_ms: number; max_cooldown_ms: number
    }
  }
  image: { variants: number; max_retries: number; test_mode?: { variants: number; max_retries: number } }
  cache: {
    topic_eval_ttl_ms: number; engagement_eval_ttl_ms: number; image_prompt_ttl_ms: number
    llm_response_ttl_ms: number; max_entries: number
    test_mode?: { topic_eval_ttl_ms: number; engagement_eval_ttl_ms: number; image_prompt_ttl_ms: number; llm_response_ttl_ms: number }
  }
  r2: { enabled: boolean }
  twitter?: { posting_enabled: boolean; read_provider: string }
  scan: { news_ttl_ms: number; timeline_ttl_ms: number; test_mode?: { news_ttl_ms: number; timeline_ttl_ms: number } }
}

function loadToml(configPath: string): TomlConfig {
  const raw = readFileSync(configPath, 'utf-8')
  return parse(raw) as unknown as TomlConfig
}

export function createConfig(configPath?: string) {
  const toml = loadToml(configPath ?? resolve(process.cwd(), 'config.toml'))
  const testMode = process.env.TEST_MODE === 'true'

  const at = toml.agent.test_mode
  const it = toml.image.test_mode
  const ct = toml.cache.test_mode
  const st = toml.scan.test_mode

  const config = {
    testMode,
    platform: (process.env.PLATFORM ?? 'twitter') as 'twitter' | 'substack',
    port: Number(process.env.PORT || 3000),

    model: (task: ModelTask): any => resolveModel(toml.models, task),
    modelId: (task: ModelTask): string => resolveModelId(toml.models, task),
    reasoningEffort: toml.models.reasoning_effort as string | undefined,

    // Twitter (optional — only used when PLATFORM=twitter)
    twitter: {
      readProvider: (process.env.TWITTER_READ_PROVIDER ?? toml.twitter?.read_provider ?? 'v2') as 'v2' | 'proxy',
      postingEnabled: process.env.TWITTER_POSTING_ENABLED === 'true' || toml.twitter?.posting_enabled === true,
      bearerToken: process.env.TWITTER_BEARER_TOKEN ?? '',
      apiKey: process.env.TWITTER_API_KEY ?? '',
      apiSecret: process.env.TWITTER_API_SECRET ?? '',
      accessToken: process.env.TWITTER_ACCESS_TOKEN ?? '',
      accessSecret: process.env.TWITTER_ACCESS_SECRET ?? '',
      twitterApiIoKey: process.env.TWITTERAPI_IO_KEY ?? '',
      username: process.env.TWITTER_USERNAME ?? '',
    },

    // Agent loop
    tickIntervalMs: testMode && at ? at.tick_interval_ms : toml.agent.tick_interval_ms,
    flagshipIntervalMs: testMode && at ? at.flagship_interval_ms : toml.agent.flagship_interval_ms,
    quickhitCooldownMs: testMode && at ? at.quickhit_cooldown_ms : toml.agent.quickhit_cooldown_ms,
    engagementIntervalMs: testMode && at ? at.engagement_interval_ms : toml.agent.engagement_interval_ms,
    reflectionIntervalMs: testMode && at ? at.reflection_interval_ms : toml.agent.reflection_interval_ms,
    maxCaptionLength: toml.agent.max_caption_length,
    recentTopicWindowMs: toml.agent.recent_topic_window_ms,

    posting: {
      minCooldownMs: testMode && at ? at.min_cooldown_ms : toml.agent.posting.min_cooldown_ms,
      maxCooldownMs: testMode && at ? at.max_cooldown_ms : toml.agent.posting.max_cooldown_ms,
      growthFactor: toml.agent.posting.growth_factor,
    },

    // Scanning
    scan: {
      newsTtlMs: testMode && st ? st.news_ttl_ms : toml.scan.news_ttl_ms,
      timelineTtlMs: testMode && st ? st.timeline_ttl_ms : toml.scan.timeline_ttl_ms,
    },

    // Image
    imageVariants: testMode && it ? it.variants : toml.image.variants,
    maxImageRetries: testMode && it ? it.max_retries : toml.image.max_retries,

    // Cache
    cache: {
      topicEvalTtlMs: testMode && ct ? ct.topic_eval_ttl_ms : toml.cache.topic_eval_ttl_ms,
      engagementEvalTtlMs: testMode && ct ? ct.engagement_eval_ttl_ms : toml.cache.engagement_eval_ttl_ms,
      imagePromptTtlMs: testMode && ct ? ct.image_prompt_ttl_ms : toml.cache.image_prompt_ttl_ms,
      llmResponseTtlMs: testMode && ct ? ct.llm_response_ttl_ms : toml.cache.llm_response_ttl_ms,
      maxEntries: toml.cache.max_entries,
    },

    // CDN
    r2: {
      enabled: !!process.env.R2_ACCESS_KEY_ID || toml.r2.enabled,
      accountId: process.env.R2_ACCOUNT_ID ?? '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      bucketName: process.env.R2_BUCKET_NAME ?? '',
      publicUrl: process.env.R2_PUBLIC_URL ?? '',
    },

    browserPublishMode: process.env.BROWSER_PUBLISH_MODE || 'cdp',
    dataDir: '.data',
  }

  if (testMode) {
    console.log(`[TEST MODE] Fast timers enabled | tick ${config.tickIntervalMs}ms`)
  }

  return config
}

export type Config = ReturnType<typeof createConfig>
