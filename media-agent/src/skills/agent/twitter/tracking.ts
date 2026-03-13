import { randomUUID } from 'crypto'
import type { SkillContext } from '../../types.js'
import type { Post } from '../../../types.js'

export function trackPost(
  ctx: SkillContext,
  opts: {
    platformId: string
    text: string
    type: Post['type']
  },
): void {
  const record: Post = {
    id: randomUUID(),
    platformId: opts.platformId,
    text: opts.text,
    type: opts.type,
    postedAt: Date.now(),
    engagement: { likes: 0, shares: 0, comments: 0, views: 0, lastChecked: 0 },
  }
  ctx.state.allPosts.push(record)
  try {
    ctx.db.run(
      `INSERT INTO posts (id, platform_id, text, type, posted_at) VALUES (?, ?, ?, ?, ?)`,
      [record.id, record.platformId, record.text, record.type, record.postedAt],
    )
  } catch {}
}
