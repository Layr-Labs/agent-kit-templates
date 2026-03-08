import { z } from 'zod'
import { ContentSigner } from '../crypto/signer.js'

export const upgradeEnvelopeSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  summary: z.string().min(1),
  proposedBy: z.string().min(1),
  timestamp: z.string().min(1),
  changes: z.record(z.string(), z.unknown()).optional(),
})

export type UpgradeEnvelope = z.infer<typeof upgradeEnvelopeSchema>

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function buildUpgradeSignatureMessage(payload: UpgradeEnvelope): string {
  return [
    'agent-upgrade-consent',
    payload.timestamp,
    payload.id,
    payload.proposedBy,
    payload.summary,
    payload.description,
  ].join('\n')
}

export async function verifyUpgradeRequest(opts: {
  headers: Record<string, string | string[] | undefined>
  payload: UpgradeEnvelope
}): Promise<Response | null> {
  const headerValue = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] ?? '') : (value ?? '')

  const address = headerValue(opts.headers['x-address'])
  const timestamp = headerValue(opts.headers['x-timestamp'])
  const signature = headerValue(opts.headers['x-signature'])

  if (!address || !timestamp || !signature) {
    return json(401, { error: 'Missing coordinator auth headers.' })
  }

  const expectedAddress = process.env.COORDINATOR_ADDRESS?.toLowerCase()
  if (expectedAddress && address.toLowerCase() !== expectedAddress) {
    return json(403, { error: 'Unexpected coordinator address.' })
  }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) {
    return json(400, { error: 'Invalid timestamp.' })
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts)
  if (ageSeconds > 300) {
    return json(401, { error: 'Upgrade request expired.' })
  }

  const verified = await ContentSigner.verify(
    buildUpgradeSignatureMessage(opts.payload),
    signature,
    address,
  )
  if (!verified) {
    return json(401, { error: 'Invalid coordinator signature.' })
  }

  return null
}
