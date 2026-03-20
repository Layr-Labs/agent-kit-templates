import { randomUUID } from 'crypto'
import { join } from 'path'
import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'
import type { Content, Post } from '../../../types.js'
import { buildArticleSignatureFooter, buildTweetSignatureFooter } from '../../../crypto/footer.js'

const skill: Skill = {
  name: 'publisher',
  description: 'Publishes content to the configured platform',
  category: 'pipeline',
  toolScope: [
    'create_draft', 'get_draft', 'update_draft', 'delete_draft',
    'upload_image', 'publish_draft', 'list_drafts', 'post_note',
  ],

  async init(ctx: SkillContext) {
    function savePost(post: Post): void {
      ctx.db.run(
        `INSERT INTO posts (id, platform_id, content_id, text, summary, image_url, video_url, article_url, reference_id, type, signature, signer_address, url_signature, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [post.id, post.platformId, post.contentId ?? null, post.text, post.summary ?? null, post.imageUrl ?? null, post.videoUrl ?? null, post.articleUrl ?? null, post.referenceId ?? null, post.type, post.signature ?? null, post.signerAddress ?? null, post.urlSignature ?? null, post.postedAt],
      )
    }

    return {
      publish_image: tool({
        description: 'Publish image content with caption to the platform.',
        inputSchema: z.object({
          type: z.enum(['flagship', 'quickhit', 'paid']).default('flagship'),
        }),
        execute: async ({ type }) => {
          if (!ctx.platform) return { error: 'No platform configured.' }

          const concept = ctx.state.bestConcept
          const caption = ctx.state.review?.caption ?? ctx.state.caption
          const imagePath = ctx.state.imagePaths[0]

          if (!concept || !caption || !imagePath) {
            return { error: 'Missing concept, caption, or image for publishing.' }
          }

          ctx.events.transition('publishing')

          let signature: string | undefined
          let signerAddress: string | undefined
          if (ctx.signer) {
            signature = await ctx.signer.sign(caption)
            signerAddress = ctx.signer.address
          }

          const referenceId = await ctx.platform.findReference?.(concept.visual)

          const result = await ctx.platform.publish({
            text: caption,
            imagePath,
            referenceId,
            contentType: 'image',
          })

          let urlSignature: string | undefined
          if (ctx.signer && result.url) {
            urlSignature = await ctx.signer.sign(result.url)
          }

          if (signature && ctx.platform.reply) {
            const footer = buildTweetSignatureFooter(signature, ctx.config.domain)
            try {
              await ctx.platform.reply({ text: footer, replyToId: result.platformId })
            } catch (err) {
              ctx.events.monologue(`Failed to post signature reply: ${(err as Error).message}`)
            }
          }

          const critique = ctx.state.critique ?? {
            conceptId: concept.id, quality: 7, clarity: 7,
            shareability: 7, execution: 7, overallScore: 7, critique: 'Auto',
          }

          const content: Content = {
            id: randomUUID(),
            conceptId: concept.id,
            topicId: concept.topicId,
            type,
            concept,
            prompt: ctx.state.imagePrompt ?? '',
            variants: ctx.state.imagePaths,
            selectedVariant: 0,
            critique,
            caption,
            createdAt: Date.now(),
          }

          const post: Post = {
            id: randomUUID(),
            platformId: result.platformId,
            contentId: content.id,
            text: caption,
            imageUrl: imagePath,
            referenceId,
            type,
            signature,
            signerAddress,
            urlSignature,
            postedAt: Date.now(),
            engagement: { likes: 0, shares: 0, comments: 0, views: 0, lastChecked: 0 },
          }

          ctx.state.allContent.push(content)
          ctx.state.allPosts.push(post)
          savePost(post)

          ctx.events.emit({ type: 'post', platformId: result.platformId, text: caption, imageUrl: imagePath, ts: Date.now() })
          ctx.events.monologue(`Published ${type}: "${caption}"`)

          return { platformId: result.platformId, url: result.url, type }
        },
      }),

      publish_article: tool({
        description: 'Publish an article to the platform.',
        inputSchema: z.object({}),
        execute: async () => {
          if (!ctx.platform) return { error: 'No platform configured.' }

          const article = ctx.state.article
          const concept = ctx.state.bestConcept

          if (!article || !concept) {
            return { error: 'Missing article or concept for publishing.' }
          }

          ctx.events.transition('publishing')

          let signature: string | undefined
          let signerAddress: string | undefined
          if (ctx.signer) {
            signature = await ctx.signer.sign(article.body)
            signerAddress = ctx.signer.address
          }

          const articleImagePaths = article.images.map((image) => image.imagePath)
          const headerImage = article.images.find((image) => image.placement === 'header')?.imagePath
            ?? articleImagePaths[0]
            ?? ctx.state.imagePaths[0]

          if (signature) {
            const footer = buildArticleSignatureFooter(signature, ctx.config.domain)
            article.sections.push({ type: 'paragraph', text: footer })
          }

          let result
          try {
            result = await ctx.platform.publish({
              text: article.body,
              contentType: 'article',
              article,
              imagePath: headerImage,
              metadata: { title: article.title, subtitle: article.subtitle },
            })
          } catch (err: any) {
            return { error: `Publishing failed: ${err.message}` }
          }

          let urlSignature: string | undefined
          if (ctx.signer && result.url) {
            urlSignature = await ctx.signer.sign(result.url)
          }

          // Record as content too so dedupe/editor can see article topics in this runtime.
          const critique = ctx.state.critique ?? {
            conceptId: concept.id, quality: 7, clarity: 7,
            shareability: 7, execution: 7, overallScore: 7, critique: 'Auto',
          }
          const content: Content = {
            id: randomUUID(),
            conceptId: concept.id,
            topicId: concept.topicId,
            type: 'article',
            concept,
            prompt: ctx.state.imagePrompt ?? '',
            variants: articleImagePaths,
            selectedVariant: 0,
            critique,
            caption: article.title,
            createdAt: Date.now(),
          }

          const post: Post = {
            id: randomUUID(),
            platformId: result.platformId,
            contentId: concept.id,
            text: article.title,
            summary: article.subtitle,
            imageUrl: headerImage,
            articleUrl: result.url,
            type: 'article',
            signature,
            signerAddress,
            urlSignature,
            postedAt: Date.now(),
            engagement: { likes: 0, shares: 0, comments: 0, views: 0, lastChecked: 0 },
          }

          ctx.state.allContent.push(content)
          ctx.state.allPosts.push(post)
          savePost(post)

          ctx.events.emit({ type: 'post', platformId: result.platformId, text: article.title, ts: Date.now() })
          ctx.events.monologue(`Article published: "${article.title}"`)

          return { platformId: result.platformId, url: result.url, title: article.title }
        },
      }),
    }
  },
}

export default skill
