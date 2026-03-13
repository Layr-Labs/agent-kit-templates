import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import type { TwitterClient } from '../../../platform/twitter/client.js'
import type { TwitterReadProvider } from '../../../platform/twitter/provider.js'
import { trackPost } from './tracking.js'

const skill: Skill = {
  name: 'twitter',
  description: 'Twitter/X platform tools — read, post, reply, search, and manage social connections.',
  category: 'agent',

  async init(ctx: SkillContext) {
    const client = (ctx as any).twitterClient as TwitterClient | undefined
    const provider = (ctx as any).twitterProvider as TwitterReadProvider | undefined
    if (!client || !provider) {
      console.log('Twitter skill: No TwitterClient on context, skipping.')
      return {} as Record<string, any>
    }

    const tools: Record<string, any> = {
      // ─── Reading & Discovery ─────────────────────────────────

      search_tweets: tool({
        description: 'Search for tweets by keyword or phrase.',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
          sort: z.enum(['Latest', 'Top']).default('Top').describe('Sort order'),
        }),
        execute: async ({ query, sort }) => {
          const result = await provider.search(query, sort)
          return result.tweets.map(t => ({
            id: t.id,
            text: t.text,
            author: t.author.userName,
            likes: t.likeCount,
            retweets: t.retweetCount,
            replies: t.replyCount,
            createdAt: t.createdAt,
          }))
        },
      }),

      get_tweet: tool({
        description: 'Get a specific tweet by its ID.',
        inputSchema: z.object({
          tweet_id: z.string().describe('Tweet ID'),
        }),
        execute: async ({ tweet_id }) => {
          const tweet = await provider.getTweetById(tweet_id)
          if (!tweet) return { error: 'Tweet not found' }
          return {
            id: tweet.id,
            text: tweet.text,
            author: tweet.author.userName,
            authorId: tweet.author.id,
            likes: tweet.likeCount,
            retweets: tweet.retweetCount,
            replies: tweet.replyCount,
            views: tweet.viewCount,
            createdAt: tweet.createdAt,
            isReply: tweet.isReply,
            inReplyToId: tweet.inReplyToId,
          }
        },
      }),

      get_mentions: tool({
        description: 'Get recent mentions of your account.',
        inputSchema: z.object({
          since_timestamp: z.number().optional().describe('Unix timestamp — only return mentions after this time'),
        }),
        execute: async ({ since_timestamp }) => {
          return client.getMentions(since_timestamp)
        },
      }),

      get_home_timeline: tool({
        description: 'Get tweets from your home timeline.',
        inputSchema: z.object({
          max_results: z.number().default(20).describe('Max tweets to return (default 20)'),
        }),
        execute: async ({ max_results }) => {
          return client.getHomeTimeline(max_results)
        },
      }),

      get_user_info: tool({
        description: 'Get a Twitter user\'s public profile by username.',
        inputSchema: z.object({
          username: z.string().describe('Twitter username/handle (without @)'),
        }),
        execute: async ({ username }) => {
          const user = await provider.getUserInfo(username)
          if (!user) return { error: 'User not found' }
          return {
            id: user.id,
            username: user.userName,
            name: user.name,
            bio: user.description,
            followers: user.followers,
            following: user.following,
            isBlueVerified: user.isBlueVerified,
            location: user.location,
            tweetsCount: user.statusesCount,
          }
        },
      }),

      get_user_tweets: tool({
        description: 'Get recent tweets from a specific user.',
        inputSchema: z.object({
          username: z.string().describe('Twitter username/handle (without @)'),
        }),
        execute: async ({ username }) => {
          const result = await provider.getUserTweets(username)
          return result.tweets.map(t => ({
            id: t.id,
            text: t.text,
            likes: t.likeCount,
            retweets: t.retweetCount,
            replies: t.replyCount,
            createdAt: t.createdAt,
          }))
        },
      }),

      find_tweet_about: tool({
        description: 'Find a popular tweet about a topic (useful for quote-tweeting).',
        inputSchema: z.object({
          query: z.string().describe('Topic or keywords to search for'),
        }),
        execute: async ({ query }) => {
          const tweetId = await client.findTweetAbout(query)
          if (!tweetId) return { found: false }
          return { found: true, tweetId }
        },
      }),

      get_thread_context: tool({
        description: 'Get the reply chain above a tweet (useful for understanding conversation context).',
        inputSchema: z.object({
          tweet_id: z.string().describe('Tweet ID to trace the thread from'),
          max_depth: z.number().default(5).describe('Max replies to trace up'),
        }),
        execute: async ({ tweet_id, max_depth }) => {
          return client.getThreadContext(tweet_id, max_depth)
        },
      }),

      // ─── Posting ────────────────────────────────────────────

      post_tweet: tool({
        description: 'Post a tweet with an image. Returns the tweet ID.',
        inputSchema: z.object({
          text: z.string().describe('Tweet text'),
          image_path: z.string().describe('Local file path of the image to attach'),
          quote_tweet_id: z.string().optional().describe('Tweet ID to quote-tweet'),
        }),
        execute: async ({ text, image_path, quote_tweet_id }) => {
          const tweetId = await client.postCartoon({
            text,
            imagePath: image_path,
            quoteTweetId: quote_tweet_id,
          })

          trackPost(ctx, {
            platformId: tweetId,
            text,
            type: 'quickhit',
          })

          ctx.events.monologue(`Posted tweet: "${text.slice(0, 60)}..." → ${tweetId}`)
          return { tweetId, url: `https://x.com/i/status/${tweetId}` }
        },
      }),

      post_video: tool({
        description: 'Post a tweet with a video. Returns the tweet ID.',
        inputSchema: z.object({
          text: z.string().describe('Tweet text'),
          video_path: z.string().describe('Local file path or URL of the video'),
          quote_tweet_id: z.string().optional().describe('Tweet ID to quote-tweet'),
        }),
        execute: async ({ text, video_path, quote_tweet_id }) => {
          const tweetId = await client.postVideo({
            text,
            videoPath: video_path,
            quoteTweetId: quote_tweet_id,
          })

          trackPost(ctx, {
            platformId: tweetId,
            text,
            type: 'quickhit',
          })

          ctx.events.monologue(`Posted video tweet: "${text.slice(0, 60)}..." → ${tweetId}`)
          return { tweetId, url: `https://x.com/i/status/${tweetId}` }
        },
      }),

      reply_to_tweet: tool({
        description: 'Reply to a tweet. Returns the reply tweet ID.',
        inputSchema: z.object({
          text: z.string().describe('Reply text'),
          reply_to_id: z.string().describe('Tweet ID to reply to'),
        }),
        execute: async ({ text, reply_to_id }) => {
          const tweetId = await client.reply({ text, replyToId: reply_to_id })

          trackPost(ctx, {
            platformId: tweetId,
            text,
            type: 'engagement',
          })

          return { tweetId, url: `https://x.com/i/status/${tweetId}` }
        },
      }),

      // ─── Social ─────────────────────────────────────────────

      follow_user: tool({
        description: 'Follow a Twitter user by their user ID.',
        inputSchema: z.object({
          user_id: z.string().describe('Twitter user ID to follow'),
        }),
        execute: async ({ user_id }) => {
          await client.follow(user_id)
          return { success: true }
        },
      }),

      unfollow_user: tool({
        description: 'Unfollow a Twitter user by their user ID.',
        inputSchema: z.object({
          user_id: z.string().describe('Twitter user ID to unfollow'),
        }),
        execute: async ({ user_id }) => {
          await client.unfollow(user_id)
          return { success: true }
        },
      }),

      block_user: tool({
        description: 'Block a Twitter user by their user ID.',
        inputSchema: z.object({
          user_id: z.string().describe('Twitter user ID to block'),
        }),
        execute: async ({ user_id }) => {
          await client.blockUser(user_id)
          return { success: true }
        },
      }),

      get_following: tool({
        description: 'Get the list of users you follow.',
        inputSchema: z.object({}),
        execute: async () => {
          return client.getFollowing()
        },
      }),

      get_following_count: tool({
        description: 'Get how many users you currently follow.',
        inputSchema: z.object({}),
        execute: async () => {
          const count = await client.getFollowingCount()
          return { count }
        },
      }),
    }

    return tools
  },
}

export default skill
