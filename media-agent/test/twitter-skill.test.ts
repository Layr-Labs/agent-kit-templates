import { describe, expect, it, mock } from 'bun:test'
import type { SkillContext } from '../src/skills/types.js'
import type { Tweet, User, SearchResult, UserTweetsResult } from '../src/platform/twitter/types.js'

// ─── Mock Factories ──────────────────────────────────────────

function makeTweet(overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: '123456',
    url: 'https://x.com/testuser/status/123456',
    text: 'Hello world',
    likeCount: 42,
    retweetCount: 5,
    replyCount: 3,
    quoteCount: 1,
    viewCount: 1000,
    createdAt: '2026-03-09T12:00:00Z',
    lang: 'en',
    isReply: false,
    inReplyToId: '',
    author: makeUser(),
    ...overrides,
  }
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    userName: 'testuser',
    name: 'Test User',
    isBlueVerified: false,
    followers: 5000,
    following: 200,
    profilePicture: 'https://pbs.twimg.com/test.jpg',
    description: 'A test user for testing',
    ...overrides,
  }
}

function makeMockProvider() {
  return {
    name: 'mock-provider',
    search: mock(async (_query: string, _sort?: string): Promise<SearchResult> => ({
      tweets: [makeTweet(), makeTweet({ id: '789', text: 'Another tweet' })],
      has_next_page: false,
      next_cursor: '',
    })),
    getMentions: mock(async () => ({ tweets: [], has_next_page: false, next_cursor: '' })),
    getUserInfo: mock(async (_username: string) => makeUser()),
    getFollowers: mock(async () => ({ followers: [], has_next_page: false, next_cursor: '' })),
    getUserTweets: mock(async (_username: string): Promise<UserTweetsResult> => ({
      tweets: [makeTweet({ text: 'User tweet 1' }), makeTweet({ id: '456', text: 'User tweet 2' })],
      has_next_page: false,
      next_cursor: '',
    })),
    findTopTweet: mock(async () => '999'),
    getTweetById: mock(async (id: string) => makeTweet({ id })),
  }
}

function makeMockClient() {
  return {
    postCartoon: mock(async (opts: { text: string }) => `tweet-${Date.now()}`),
    postVideo: mock(async (opts: { text: string }) => `video-${Date.now()}`),
    reply: mock(async (opts: { text: string; replyToId: string }) => `reply-${Date.now()}`),
    getMentions: mock(async () => [
      { id: 'm1', text: 'Hey!', authorId: 'a1', authorUsername: 'fan1', authorFollowers: 100, metrics: { likes: 2, retweets: 0, replies: 0 } },
    ]),
    getHomeTimeline: mock(async () => [
      { id: 'ht1', text: 'Timeline tweet', authorUsername: 'friend1', authorId: 'f1', likes: 10, retweets: 2, replies: 1 },
    ]),
    findTweetAbout: mock(async () => 'found-tweet-id'),
    getThreadContext: mock(async () => [
      { author: 'user1', text: 'First message' },
      { author: 'user2', text: 'Reply to first' },
    ]),
    follow: mock(async () => {}),
    unfollow: mock(async () => {}),
    blockUser: mock(async () => {}),
    getFollowing: mock(async () => [
      { id: 'f1', username: 'friend', name: 'Friend', bio: 'A friend', followers: 1000 },
    ]),
    getFollowingCount: mock(async () => 42),
  }
}

function makeMockCtx(): SkillContext & { twitterClient: any; twitterProvider: any } {
  const monologue = mock((_msg: string) => {})
  return {
    events: { monologue } as any,
    identity: { name: 'Test', tagline: '', creator: '', constitution: '', persona: '', beliefs: [], themes: [], punchesUp: [], respects: [], voice: 'plain', restrictions: [], motto: '' } as any,
    config: {} as any,
    dataDir: '/tmp/test',
    db: { run: mock(() => {}) } as any,
    wallet: {} as any,
    state: { allPosts: [] } as any,
    scannerRegistry: {} as any,
    caches: { eval: {}, image: {}, signal: {} } as any,
    twitterClient: makeMockClient(),
    twitterProvider: makeMockProvider(),
  }
}

// ─── Tests ───────────────────────────────────────────────────

describe('Twitter agent skill', () => {
  async function initSkill(ctx: ReturnType<typeof makeMockCtx>) {
    const mod = await import('../src/skills/agent/twitter/index.js')
    const skill = mod.default
    expect(skill.name).toBe('twitter')
    expect(skill.category).toBe('agent')
    return skill.init(ctx as any)
  }

  it('returns empty tools when no client is on context', async () => {
    const ctx = makeMockCtx()
    delete (ctx as any).twitterClient
    delete (ctx as any).twitterProvider
    const mod = await import('../src/skills/agent/twitter/index.js')
    const tools = await mod.default.init(ctx as any)
    expect(Object.keys(tools).length).toBe(0)
  })

  it('returns all expected tools when client is present', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)

    const expectedTools = [
      'search_tweets', 'get_tweet', 'get_mentions', 'get_home_timeline',
      'get_user_info', 'get_user_tweets', 'find_tweet_about', 'get_thread_context',
      'post_tweet', 'post_video', 'reply_to_tweet',
      'follow_user', 'unfollow_user', 'block_user', 'get_following', 'get_following_count',
    ]
    for (const name of expectedTools) {
      expect(name in tools).toBe(true)
    }
    expect(Object.keys(tools).length).toBe(expectedTools.length)
  })

  // ─── Reading tools ──────────────────────────────────────────

  it('search_tweets calls provider.search and maps results', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)
    const result = await tools.search_tweets.execute({ query: 'typescript', sort: 'Top' })

    expect(ctx.twitterProvider.search).toHaveBeenCalledWith('typescript', 'Top')
    expect(result).toBeArray()
    expect(result.length).toBe(2)
    expect(result[0].id).toBe('123456')
    expect(result[0].author).toBe('testuser')
    expect(result[0].likes).toBe(42)
  })

  it('get_tweet returns tweet data or error', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)

    const result = await tools.get_tweet.execute({ tweet_id: 'abc' })
    expect(ctx.twitterProvider.getTweetById).toHaveBeenCalledWith('abc')
    expect(result.id).toBe('abc')
    expect(result.author).toBe('testuser')
    expect(result.views).toBe(1000)

    // Test not-found case
    ctx.twitterProvider.getTweetById.mockImplementationOnce(async () => null)
    const notFound = await tools.get_tweet.execute({ tweet_id: 'missing' })
    expect(notFound.error).toBe('Tweet not found')
  })

  it('get_mentions calls client.getMentions', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)
    const result = await tools.get_mentions.execute({ since_timestamp: 1000 })

    expect(ctx.twitterClient.getMentions).toHaveBeenCalledWith(1000)
    expect(result).toBeArray()
    expect(result[0].id).toBe('m1')
  })

  it('get_home_timeline calls client.getHomeTimeline', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)
    const result = await tools.get_home_timeline.execute({ max_results: 10 })

    expect(ctx.twitterClient.getHomeTimeline).toHaveBeenCalledWith(10)
    expect(result).toBeArray()
    expect(result[0].id).toBe('ht1')
  })

  it('get_user_info returns profile or error', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)

    const result = await tools.get_user_info.execute({ username: 'elonmusk' })
    expect(ctx.twitterProvider.getUserInfo).toHaveBeenCalledWith('elonmusk')
    expect(result.username).toBe('testuser')
    expect(result.followers).toBe(5000)

    // Test not-found case
    ctx.twitterProvider.getUserInfo.mockImplementationOnce(async () => null)
    const notFound = await tools.get_user_info.execute({ username: 'nobody' })
    expect(notFound.error).toBe('User not found')
  })

  it('get_user_tweets returns mapped tweets', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)
    const result = await tools.get_user_tweets.execute({ username: 'someone' })

    expect(ctx.twitterProvider.getUserTweets).toHaveBeenCalledWith('someone')
    expect(result.length).toBe(2)
    expect(result[0].text).toBe('User tweet 1')
  })

  it('find_tweet_about returns found tweet or not-found', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)

    const result = await tools.find_tweet_about.execute({ query: 'AI agents' })
    expect(result.found).toBe(true)
    expect(result.tweetId).toBe('found-tweet-id')

    ctx.twitterClient.findTweetAbout.mockImplementationOnce(async () => undefined)
    const notFound = await tools.find_tweet_about.execute({ query: 'nothing' })
    expect(notFound.found).toBe(false)
  })

  it('get_thread_context returns reply chain', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)
    const result = await tools.get_thread_context.execute({ tweet_id: 't1', max_depth: 3 })

    expect(ctx.twitterClient.getThreadContext).toHaveBeenCalledWith('t1', 3)
    expect(result.length).toBe(2)
    expect(result[0].author).toBe('user1')
  })

  // ─── Posting tools ─────────────────────────────────────────

  it('post_tweet calls client.postCartoon and tracks the post', async () => {
    const ctx = makeMockCtx()
    ctx.twitterClient.postCartoon.mockImplementationOnce(async () => 'tweet-001')
    const tools = await initSkill(ctx)

    const result = await tools.post_tweet.execute({
      text: 'Hello from test',
      image_path: '/tmp/img.png',
      quote_tweet_id: 'qt-123',
    })

    expect(ctx.twitterClient.postCartoon).toHaveBeenCalledWith({
      text: 'Hello from test',
      imagePath: '/tmp/img.png',
      quoteTweetId: 'qt-123',
    })
    expect(result.tweetId).toBe('tweet-001')
    expect(result.url).toContain('tweet-001')

    // Verify tracking
    expect(ctx.state.allPosts.length).toBe(1)
    expect(ctx.state.allPosts[0].platformId).toBe('tweet-001')
    expect(ctx.state.allPosts[0].type).toBe('quickhit')
    expect(ctx.state.allPosts[0].text).toBe('Hello from test')

    // Verify db insert
    expect(ctx.db.run).toHaveBeenCalled()

    // Verify monologue
    expect(ctx.events.monologue).toHaveBeenCalled()
  })

  it('post_video calls client.postVideo and tracks the post', async () => {
    const ctx = makeMockCtx()
    ctx.twitterClient.postVideo.mockImplementationOnce(async () => 'video-001')
    const tools = await initSkill(ctx)

    const result = await tools.post_video.execute({
      text: 'Video post',
      video_path: '/tmp/vid.mp4',
    })

    expect(ctx.twitterClient.postVideo).toHaveBeenCalledWith({
      text: 'Video post',
      videoPath: '/tmp/vid.mp4',
      quoteTweetId: undefined,
    })
    expect(result.tweetId).toBe('video-001')

    expect(ctx.state.allPosts.length).toBe(1)
    expect(ctx.state.allPosts[0].type).toBe('quickhit')
  })

  it('reply_to_tweet calls client.reply and tracks as engagement', async () => {
    const ctx = makeMockCtx()
    ctx.twitterClient.reply.mockImplementationOnce(async () => 'reply-001')
    const tools = await initSkill(ctx)

    const result = await tools.reply_to_tweet.execute({
      text: 'Great take!',
      reply_to_id: 'original-tweet',
    })

    expect(ctx.twitterClient.reply).toHaveBeenCalledWith({
      text: 'Great take!',
      replyToId: 'original-tweet',
    })
    expect(result.tweetId).toBe('reply-001')

    expect(ctx.state.allPosts.length).toBe(1)
    expect(ctx.state.allPosts[0].type).toBe('engagement')
    expect(ctx.state.allPosts[0].platformId).toBe('reply-001')
  })

  // ─── Social tools ──────────────────────────────────────────

  it('follow_user calls client.follow', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)
    const result = await tools.follow_user.execute({ user_id: 'uid-123' })

    expect(ctx.twitterClient.follow).toHaveBeenCalledWith('uid-123')
    expect(result.success).toBe(true)
  })

  it('unfollow_user calls client.unfollow', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)
    const result = await tools.unfollow_user.execute({ user_id: 'uid-456' })

    expect(ctx.twitterClient.unfollow).toHaveBeenCalledWith('uid-456')
    expect(result.success).toBe(true)
  })

  it('block_user calls client.blockUser', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)
    const result = await tools.block_user.execute({ user_id: 'uid-789' })

    expect(ctx.twitterClient.blockUser).toHaveBeenCalledWith('uid-789')
    expect(result.success).toBe(true)
  })

  it('get_following returns the following list', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)
    const result = await tools.get_following.execute({})

    expect(ctx.twitterClient.getFollowing).toHaveBeenCalled()
    expect(result).toBeArray()
    expect(result[0].username).toBe('friend')
  })

  it('get_following_count returns the count', async () => {
    const ctx = makeMockCtx()
    const tools = await initSkill(ctx)
    const result = await tools.get_following_count.execute({})

    expect(ctx.twitterClient.getFollowingCount).toHaveBeenCalled()
    expect(result.count).toBe(42)
  })
})

describe('Twitter tracking', () => {
  it('trackPost pushes to allPosts and inserts into db', async () => {
    const { trackPost } = await import('../src/skills/agent/twitter/tracking.js')

    const dbRun = mock(() => {})
    const allPosts: any[] = []
    const ctx = {
      state: { allPosts },
      db: { run: dbRun },
    } as any

    trackPost(ctx, { platformId: 'tw-123', text: 'Test post', type: 'quickhit' })

    expect(allPosts.length).toBe(1)
    expect(allPosts[0].platformId).toBe('tw-123')
    expect(allPosts[0].text).toBe('Test post')
    expect(allPosts[0].type).toBe('quickhit')
    expect(allPosts[0].id).toBeTruthy()
    expect(allPosts[0].postedAt).toBeGreaterThan(0)
    expect(allPosts[0].engagement.likes).toBe(0)

    expect(dbRun).toHaveBeenCalledTimes(1)
    const [sql, params] = dbRun.mock.calls[0] as [string, any[]]
    expect(sql).toContain('INSERT INTO posts')
    expect(params[1]).toBe('tw-123')
    expect(params[2]).toBe('Test post')
    expect(params[3]).toBe('quickhit')
  })

  it('trackPost does not throw when db.run fails', async () => {
    const { trackPost } = await import('../src/skills/agent/twitter/tracking.js')

    const ctx = {
      state: { allPosts: [] },
      db: { run: () => { throw new Error('db error') } },
    } as any

    expect(() => trackPost(ctx, { platformId: 'tw-456', text: 'Test', type: 'engagement' })).not.toThrow()
    expect(ctx.state.allPosts.length).toBe(1)
  })
})
