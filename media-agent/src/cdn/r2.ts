import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { readFile } from 'fs/promises'
import { basename } from 'path'

export type MediaPrefix = 'images' | 'videos' | 'voice'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

interface R2Config {
  enabled: boolean
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  publicUrl: string
}

let client: S3Client | null = null

function getClient(r2: R2Config): S3Client {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      },
    })
  }
  return client
}

export async function uploadToR2(
  localPath: string,
  prefix: MediaPrefix,
  r2: R2Config,
): Promise<string | null> {
  if (!r2.enabled) return null

  try {
    const filename = basename(localPath)
    const key = `${prefix}/${filename}`
    const ext = '.' + (filename.split('.').pop()?.toLowerCase() ?? '')
    const body = await readFile(localPath)

    await getClient(r2).send(new PutObjectCommand({
      Bucket: r2.bucketName,
      Key: key,
      Body: body,
      ContentType: MIME[ext] ?? 'application/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    }))

    console.log(`[r2] Uploaded ${key} (${body.length} bytes)`)
    return `${r2.publicUrl}/${key}`
  } catch (err) {
    console.error(`[r2] Upload failed for ${localPath}:`, (err as Error).message)
    return null
  }
}

export async function uploadBufferToR2(
  buffer: Buffer,
  filename: string,
  prefix: MediaPrefix,
  r2: R2Config,
): Promise<string | null> {
  if (!r2.enabled) return null

  try {
    const key = `${prefix}/${filename}`
    const ext = '.' + (filename.split('.').pop()?.toLowerCase() ?? '')

    await getClient(r2).send(new PutObjectCommand({
      Bucket: r2.bucketName,
      Key: key,
      Body: buffer,
      ContentType: MIME[ext] ?? 'application/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    }))

    console.log(`[r2] Uploaded ${key} (${buffer.length} bytes)`)
    return `${r2.publicUrl}/${key}`
  } catch (err) {
    console.error(`[r2] Buffer upload failed for ${filename}:`, (err as Error).message)
    return null
  }
}

export function toCdnUrl(localPathOrUrl: string, prefix: MediaPrefix, r2: R2Config): string {
  if (localPathOrUrl.startsWith('https://')) return localPathOrUrl
  const filename = basename(localPathOrUrl)
  if (r2.enabled) return `${r2.publicUrl}/${prefix}/${filename}`
  return `/${prefix}/${filename}`
}
