import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import type { SubstackClient } from 'substack-skill'
import { buildPostBody, uploadAndAttachImage, makeUpdatePublicationExecute, makeUpdateProfileExecute, replyToComment, commentOnPost } from '../../../platform/substack/helpers.js'
import { buildArticleSignatureFooter } from '../../../crypto/footer.js'
import { trackPost } from './tracking.js'

const skill: Skill = {
  name: 'substack',
  description: 'Substack platform tools — read, write, publish, engage, and analyze content.',
  category: 'agent',

  async init(ctx: SkillContext) {
    const client = (ctx as any).substackClient as SubstackClient | undefined
    if (!client) {
      console.log('Substack skill: No SubstackClient on context, skipping.')
      return {} as Record<string, any>
    }

    const tools: Record<string, any> = {
      // ─── Reading & Discovery ─────────────────────────────────

      get_substack_posts: tool({
        description: 'Get posts from a Substack newsletter by URL or subdomain.',
        inputSchema: z.object({
          newsletter: z.string().describe('Newsletter URL or subdomain (e.g. "platformer")'),
          sort: z.enum(['new', 'top', 'pinned', 'community']).default('new'),
          limit: z.number().optional().describe('Max posts to return'),
        }),
        execute: async ({ newsletter, sort, limit }) => {
          const posts = await client.getPosts(newsletter, { sort, limit })
          return posts.map((p: any) => ({
            id: p.id,
            title: p.title,
            subtitle: p.subtitle,
            slug: p.slug,
            url: p.canonical_url,
            audience: p.audience,
            publishedAt: p.published_at,
            wordcount: p.wordcount,
            commentCount: p.comment_count,
          }))
        },
      }),

      get_substack_post: tool({
        description: 'Read a specific Substack post with full content by newsletter and slug.',
        inputSchema: z.object({
          newsletter: z.string().describe('Newsletter URL or subdomain'),
          slug: z.string().describe('Post slug from the URL'),
        }),
        execute: async ({ newsletter, slug }) => {
          const post = await client.getPost(newsletter, slug)
          return {
            id: post.id,
            title: post.title,
            subtitle: post.subtitle,
            slug: post.slug,
            url: post.canonical_url,
            audience: post.audience,
            publishedAt: post.published_at,
            bodyHtml: post.body_html,
            wordcount: post.wordcount,
            authors: post.publishedBylines,
          }
        },
      }),

      search_substack_posts: tool({
        description: 'Search for posts within a Substack newsletter.',
        inputSchema: z.object({
          newsletter: z.string().describe('Newsletter URL or subdomain'),
          query: z.string().describe('Search query'),
          limit: z.number().optional(),
        }),
        execute: async ({ newsletter, query, limit }) => {
          const posts = await client.searchPosts(newsletter, { query, limit })
          return posts.map((p: any) => ({
            id: p.id,
            title: p.title,
            subtitle: p.subtitle,
            slug: p.slug,
            url: p.canonical_url,
            publishedAt: p.published_at,
          }))
        },
      }),

      get_reader_feed: tool({
        description: 'Get the Substack reader feed — personalized recommendations or content from followed publications.',
        inputSchema: z.object({
          tab: z.enum(['for-you', 'following']).default('for-you'),
        }),
        execute: async ({ tab }) => {
          return client.getReaderFeed(tab)
        },
      }),

      search_publications: tool({
        description: 'Search for Substack publications/newsletters by name or topic.',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
        }),
        execute: async ({ query }) => {
          return client.searchPublications(query)
        },
      }),

      get_substack_user: tool({
        description: 'Get a Substack user\'s public profile by their username/handle.',
        inputSchema: z.object({
          username: z.string().describe('Substack username/handle'),
        }),
        execute: async ({ username }) => {
          return client.getUser(username)
        },
      }),

      // ─── Drafts & Publishing ─────────────────────────────────

      create_draft: tool({
        description: 'Create a draft article on your Substack publication. Returns draft ID for publishing.',
        inputSchema: z.object({
          title: z.string().describe('Article title'),
          subtitle: z.string().optional().describe('Article subtitle'),
          sections: z.array(z.object({
            type: z.enum([
              'paragraph', 'heading', 'blockquote', 'image', 'divider',
              'bulletList', 'orderedList', 'codeBlock', 'youtube', 'subscribeWidget',
            ]),
            text: z.string().optional(),
            level: z.number().optional().describe('Heading level 1-6'),
            items: z.array(z.string()).optional().describe('List items'),
            src: z.string().optional().describe('Image URL or YouTube video ID'),
            alt: z.string().optional().describe('Image alt text'),
            caption: z.string().optional().describe('Image caption'),
            language: z.string().optional().describe('Code block language'),
          })).describe('Content sections that make up the article body'),
          audience: z.enum(['everyone', 'only_paid', 'founding', 'only_free']).default('everyone'),
        }),
        execute: async ({ title, subtitle, sections, audience }) => {
          if (ctx.signer) {
            const contentText = sections.map(s => s.text ?? s.items?.join('\n') ?? '').join('\n')
            const signature = await ctx.signer.sign(contentText)
            const footer = buildArticleSignatureFooter(signature, ctx.config.domain)
            sections = [...sections, { type: 'paragraph', text: footer }]
          }
          const body = await buildPostBody(sections)
          const draft = await client.createDraft({ title, subtitle, body, audience })
          return { id: draft.id, title: draft.draft_title, slug: draft.slug }
        },
      }),

      list_drafts: tool({
        description: 'List existing draft posts on your publication.',
        inputSchema: z.object({
          offset: z.number().optional(),
          limit: z.number().optional(),
        }),
        execute: async ({ offset, limit }) => {
          const result = await client.listDrafts({ offset, limit })
          return {
            total: result.total,
            drafts: result.posts.map((d: any) => ({
              id: d.id,
              title: d.draft_title,
              slug: d.slug,
              updatedAt: d.draft_updated_at,
              audience: d.audience,
            })),
          }
        },
      }),

      upload_image: tool({
        description: 'Upload an image to Substack CDN. Returns the CDN URL for use in drafts or notes.',
        inputSchema: z.object({
          file_path: z.string().describe('Local file path of the image to upload'),
        }),
        execute: async ({ file_path }) => {
          const { uploadImageFromPath } = await import('../../../platform/substack/helpers.js')
          const result = await uploadImageFromPath(client, file_path)
          return { url: result.url, width: result.imageWidth, height: result.imageHeight }
        },
      }),

      get_draft: tool({
        description: 'Read a specific draft by ID, including its full content.',
        inputSchema: z.object({
          draft_id: z.number().describe('Draft ID'),
        }),
        execute: async ({ draft_id }) => {
          const draft = await client.getDraft(draft_id)
          return {
            id: draft.id,
            title: draft.draft_title,
            subtitle: draft.draft_subtitle,
            slug: draft.slug,
            body: draft.draft_body,
            audience: draft.audience,
            updatedAt: draft.draft_updated_at,
            wordCount: draft.word_count,
          }
        },
      }),

      update_draft: tool({
        description: 'Edit an existing draft (title, subtitle, body, audience) before publishing.',
        inputSchema: z.object({
          draft_id: z.number().describe('Draft ID to update'),
          title: z.string().optional().describe('New title'),
          subtitle: z.string().optional().describe('New subtitle'),
          sections: z.array(z.object({
            type: z.enum([
              'paragraph', 'heading', 'blockquote', 'image', 'divider',
              'bulletList', 'orderedList', 'codeBlock', 'youtube', 'subscribeWidget',
            ]),
            text: z.string().optional(),
            level: z.number().optional().describe('Heading level 1-6'),
            items: z.array(z.string()).optional().describe('List items'),
            src: z.string().optional().describe('Image URL or YouTube video ID'),
            alt: z.string().optional().describe('Image alt text'),
            caption: z.string().optional().describe('Image caption'),
            language: z.string().optional().describe('Code block language'),
          })).optional().describe('New content sections (replaces entire body)'),
          audience: z.enum(['everyone', 'only_paid', 'founding', 'only_free']).optional(),
        }),
        execute: async ({ draft_id, title, subtitle, sections, audience }) => {
          const opts: Record<string, any> = {}
          if (title !== undefined) opts.title = title
          if (subtitle !== undefined) opts.subtitle = subtitle
          if (audience !== undefined) opts.audience = audience

          if (sections) {
            opts.body = await buildPostBody(sections)
          }

          const draft = await client.updateDraft(draft_id, opts)
          return { id: draft.id, title: draft.draft_title, slug: draft.slug }
        },
      }),

      delete_draft: tool({
        description: 'Delete a draft post.',
        inputSchema: z.object({
          draft_id: z.number().describe('Draft ID to delete'),
        }),
        execute: async ({ draft_id }) => {
          await client.deleteDraft(draft_id)
          return { success: true }
        },
      }),

      publish_draft: tool({
        description: 'Publish an existing draft, making it live on your Substack.',
        inputSchema: z.object({
          draft_id: z.number().describe('The draft ID to publish'),
        }),
        execute: async ({ draft_id }) => {
          const post = await client.publishDraft(draft_id)

          trackPost(ctx, {
            platformId: post.slug ?? String(post.id),
            text: post.title ?? '',
            summary: post.subtitle ?? post.description ?? undefined,
            type: 'article',
            articleUrl: post.canonical_url,
          })

          ctx.events.monologue(`Published: "${post.title}" → ${post.canonical_url}`)
          return { id: post.id, title: post.title, url: post.canonical_url }
        },
      }),

      // ─── Notes (Short-form) ──────────────────────────────────

      post_note: tool({
        description: 'Post a short-form note on Substack (like a tweet). Optionally attach an image.',
        inputSchema: z.object({
          content: z.string().describe('Note content in markdown'),
          image_path: z.string().optional().describe('Optional local image file path to attach'),
        }),
        execute: async ({ content, image_path }) => {
          let attachmentIds: string[] | undefined

          if (image_path) {
            attachmentIds = [await uploadAndAttachImage(client, image_path)]
          }

          const result = await client.postNote(content, attachmentIds)

          trackPost(ctx, {
            platformId: (result as any)?.id?.toString() ?? Date.now().toString(),
            text: content.slice(0, 280),
            type: 'engagement',
          })

          return result
        },
      }),

      // ─── Engagement ──────────────────────────────────────────

      get_comment: tool({
        description: 'Read a comment and its replies by comment ID.',
        inputSchema: z.object({
          comment_id: z.number().describe('Comment ID'),
        }),
        execute: async ({ comment_id }) => {
          const [comment, replies] = await Promise.all([
            client.getComment(comment_id),
            client.getCommentReplies(comment_id).catch(() => null),
          ])
          return { comment, replies }
        },
      }),

      react_to_comment: tool({
        description: 'React to a comment with a heart.',
        inputSchema: z.object({
          comment_id: z.number().describe('Comment ID to react to'),
        }),
        execute: async ({ comment_id }) => {
          await client.reactToComment(comment_id)
          return { success: true }
        },
      }),

      reply_to_comment: tool({
        description: 'Reply to a comment or note with markdown text.',
        inputSchema: z.object({
          comment_id: z.number().describe('Comment ID to reply to'),
          content: z.string().describe('Reply content in markdown'),
        }),
        execute: async ({ comment_id, content }) => {
          const result = await replyToComment(client, comment_id, content)

          trackPost(ctx, {
            platformId: (result as any)?.id?.toString() ?? Date.now().toString(),
            text: content.slice(0, 280),
            type: 'engagement',
          })

          return result
        },
      }),

      comment_on_post: tool({
        description: 'Post a top-level comment on a published article.',
        inputSchema: z.object({
          post_id: z.number().describe('Post ID to comment on'),
          content: z.string().describe('Comment content in markdown'),
        }),
        execute: async ({ post_id, content }) => {
          const result = await commentOnPost(client, post_id, content)

          trackPost(ctx, {
            platformId: (result as any)?.id?.toString() ?? Date.now().toString(),
            text: content.slice(0, 280),
            type: 'engagement',
          })

          return result
        },
      }),

      restack_post: tool({
        description: 'Restack (share) a post or note to your followers.',
        inputSchema: z.object({
          post_id: z.number().optional().describe('Post ID to restack'),
          comment_id: z.number().optional().describe('Note/comment ID to restack'),
        }),
        execute: async ({ post_id, comment_id }) => {
          await client.restack({ postId: post_id ?? null, commentId: comment_id ?? null })
          return { success: true }
        },
      }),

      delete_comment: tool({
        description: 'Delete one of your own comments or notes.',
        inputSchema: z.object({
          comment_id: z.number().describe('Comment/note ID to delete'),
        }),
        execute: async ({ comment_id }) => {
          await client.deleteComment(comment_id)
          return { success: true }
        },
      }),

      // ─── Subscriptions & Networking ──────────────────────────

      subscribe_to_publication: tool({
        description: 'Subscribe to another Substack publication (follow their content).',
        inputSchema: z.object({
          publication_id: z.number().describe('Publication ID to subscribe to'),
        }),
        execute: async ({ publication_id }) => {
          return client.subscribe(publication_id)
        },
      }),

      unsubscribe_from_publication: tool({
        description: 'Unsubscribe from a Substack publication.',
        inputSchema: z.object({
          publication_id: z.number().describe('Publication ID to unsubscribe from'),
        }),
        execute: async ({ publication_id }) => {
          await client.unsubscribe(publication_id)
          return { success: true }
        },
      }),

      get_recommendations: tool({
        description: 'Get the publications recommended by a newsletter.',
        inputSchema: z.object({
          newsletter: z.string().describe('Newsletter URL or subdomain'),
        }),
        execute: async ({ newsletter }) => {
          return client.getRecommendations(newsletter)
        },
      }),

      // ─── Inbox & Activity ────────────────────────────────────

      get_inbox: tool({
        description: 'Read your Substack inbox messages.',
        inputSchema: z.object({
          tab: z.enum(['all', 'comments', 'mentions']).default('all'),
        }),
        execute: async ({ tab }) => {
          return client.getInbox(tab)
        },
      }),

      get_unread_count: tool({
        description: 'Check how many unread messages/notifications you have.',
        inputSchema: z.object({}),
        execute: async () => {
          return client.getUnreadCount()
        },
      }),

      get_activity: tool({
        description: 'Get recent unread activity (comments, reactions, new subscribers, etc.).',
        inputSchema: z.object({}),
        execute: async () => {
          return client.getUnreadActivity()
        },
      }),

      // ─── Publication Management ──────────────────────────────

      update_publication: tool({
        description: 'Update your publication metadata (name, description, about page, etc.).',
        inputSchema: z.object({
          name: z.string().optional().describe('Publication name'),
          subdomain: z.string().optional().describe('Subdomain'),
          author_bio: z.string().optional().describe('Author bio'),
          copyright: z.string().optional().describe('Copyright notice'),
        }),
        execute: makeUpdatePublicationExecute(client),
      }),

      update_profile: tool({
        description: 'Update your Substack user profile (display name, handle, bio).',
        inputSchema: z.object({
          name: z.string().optional().describe('Display name'),
          handle: z.string().optional().describe('Username handle'),
          bio: z.string().optional().describe('Short profile bio'),
        }),
        execute: makeUpdateProfileExecute(client),
      }),

      get_publication: tool({
        description: 'Get your current publication settings and metadata.',
        inputSchema: z.object({}),
        execute: async () => {
          return client.getPublication()
        },
      }),

      // ─── Subscribers ─────────────────────────────────────────

      list_subscribers: tool({
        description: 'List your publication subscribers (ordered by most recent).',
        inputSchema: z.object({
          offset: z.number().optional().default(0),
          limit: z.number().optional().default(25),
        }),
        execute: async ({ offset, limit }) => {
          return client.listSubscribers({ offset, limit })
        },
      }),

      // ─── Analytics ───────────────────────────────────────────

      get_analytics: tool({
        description: 'Get a dashboard analytics summary for your publication.',
        inputSchema: z.object({
          range_days: z.number().default(7).describe('Number of days to look back (7, 30, etc.)'),
        }),
        execute: async ({ range_days }) => {
          return client.getDashboardSummary(range_days)
        },
      }),

      // ─── Account ─────────────────────────────────────────────

      get_self: tool({
        description: 'Get your authenticated Substack profile and publication info.',
        inputSchema: z.object({}),
        execute: async () => {
          const self = await client.getSelf()
          return {
            id: self.id,
            name: self.name,
            email: self.email,
            handle: self.handle,
            publication: self.primaryPublication,
          }
        },
      }),
    }

    return tools
  },
}

export default skill
