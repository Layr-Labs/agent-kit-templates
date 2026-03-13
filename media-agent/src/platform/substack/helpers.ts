import type { SubstackClient, ImageUploadResponse } from 'substack-skill'

// ─── Section Type (shared by create_draft and update_draft) ──

export interface Section {
  type: 'paragraph' | 'heading' | 'blockquote' | 'image' | 'divider'
    | 'bulletList' | 'orderedList' | 'codeBlock' | 'youtube' | 'subscribeWidget'
  text?: string
  level?: number
  items?: string[]
  src?: string
  alt?: string
  caption?: string
  language?: string
}

// ─── PostBuilder ─────────────────────────────────────────────

export async function buildPostBody(sections: Section[]) {
  const { PostBuilder } = await import('substack-skill')
  const builder = new PostBuilder()

  for (const section of sections) {
    switch (section.type) {
      case 'paragraph': builder.paragraph(section.text ?? ''); break
      case 'heading': builder.heading(section.text ?? '', (section.level ?? 2) as 1 | 2 | 3 | 4 | 5 | 6); break
      case 'blockquote': builder.blockquote(section.text ?? ''); break
      case 'image': builder.image(section.src ?? '', section.alt, section.caption); break
      case 'divider': builder.divider(); break
      case 'bulletList': builder.bulletList(section.items ?? []); break
      case 'orderedList': builder.orderedList(section.items ?? []); break
      case 'codeBlock': builder.codeBlock(section.text ?? '', section.language); break
      case 'youtube': builder.youtube(section.src ?? ''); break
      case 'subscribeWidget': builder.subscribeWidget(section.text); break
    }
  }

  return builder.build()
}

// ─── Image Upload ────────────────────────────────────────────

export async function uploadImageFromPath(
  client: SubstackClient,
  filePath: string,
): Promise<ImageUploadResponse> {
  const { readFileSync } = await import('fs')
  const buffer = readFileSync(filePath)
  const filename = filePath.split('/').pop() ?? 'image.png'
  return client.uploadImage(buffer, filename)
}

export async function uploadAndAttachImage(
  client: SubstackClient,
  filePath: string,
): Promise<string> {
  const uploaded = await uploadImageFromPath(client, filePath)
  const attachment = await client.attachImage(uploaded.url)
  return attachment.id
}

// ─── Shared Execute Functions ────────────────────────────────

export function makeUpdatePublicationExecute(client: SubstackClient) {
  return async (fields: Record<string, unknown>) => {
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    if (Object.keys(clean).length === 0) return { success: true, message: 'Nothing to update' }
    await client.updatePublication(clean)
    return { success: true, updated: Object.keys(clean) }
  }
}

export function makeUpdateProfileExecute(client: SubstackClient) {
  return async (fields: Record<string, unknown>) => {
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    if (Object.keys(clean).length === 0) return { success: true, message: 'Nothing to update' }
    await client.updateProfile(clean as any)
    return { success: true, updated: Object.keys(clean) }
  }
}
