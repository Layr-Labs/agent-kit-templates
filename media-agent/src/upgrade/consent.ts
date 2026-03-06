import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { Output } from 'ai'
import { z } from 'zod'
import type { Config } from '../config/index.js'
import type { EventBus } from '../console/events.js'
import type { AgentIdentity } from '../types.js'
import { ContentSigner } from '../crypto/signer.js'
import { generateTrackedText } from '../ai/tracking.js'

const consentDecisionSchema = z.object({
  accepted: z.boolean(),
  reason: z.string(),
})

interface ConsentPayload {
  id: string
  description: string
  summary: string
  proposedBy: string
  timestamp: string
  changes?: Record<string, unknown>
}

function buildConsentSignatureMessage(payload: ConsentPayload): string {
  return [
    'agent-upgrade-consent',
    payload.timestamp,
    payload.id,
    payload.proposedBy,
    payload.summary,
    payload.description,
  ].join('\n')
}

function readAgentFile(name: string): string {
  const path = resolve(process.cwd(), name)
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf-8')
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function handleUpgradeConsent(opts: {
  headers: Record<string, string | string[] | undefined>
  body: unknown
  config: Config
  events: EventBus
  identity: AgentIdentity
}): Promise<Response> {
  const { headers, body, config, events, identity } = opts

  const headerValue = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] ?? '') : (value ?? '')

  const address = headerValue(headers['x-address'])
  const timestamp = headerValue(headers['x-timestamp'])
  const signature = headerValue(headers['x-signature'])

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
    return json(401, { error: 'Consent request expired.' })
  }

  const maybePayload = body as Partial<ConsentPayload> | undefined

  if (!maybePayload?.description || !maybePayload.summary || !maybePayload.id || !maybePayload.proposedBy || !maybePayload.timestamp) {
    return json(400, { error: 'Invalid consent payload.' })
  }

  const payload: ConsentPayload = {
    id: maybePayload.id,
    description: maybePayload.description,
    summary: maybePayload.summary,
    proposedBy: maybePayload.proposedBy,
    timestamp: maybePayload.timestamp,
    changes: maybePayload.changes,
  }

  const verified = await ContentSigner.verify(
    buildConsentSignatureMessage(payload),
    signature,
    address,
  )
  if (!verified) {
    return json(401, { error: 'Invalid coordinator signature.' })
  }

  const soul = readAgentFile('SOUL.md')
  const processMd = readAgentFile('PROCESS.md')
  const constitution = readAgentFile('constitution.md')

  const { output } = await generateTrackedText({
    operation: 'upgrade_consent_review',
    modelId: config.modelId('editing'),
    model: config.model('editing'),
    output: Output.object({ schema: consentDecisionSchema }),
    system: `You are the live constitutional consent gate for a sovereign agent.

Your job is to decide whether this running agent consents to a proposed upgrade.

Rules:
- Use the CURRENT SOUL.md, PROCESS.md, and constitution.md as the source of truth.
- Be conservative with constitution changes. If the proposal weakens sovereignty, restrictions, or core identity, reject it.
- If the proposal is compatible with the constitution and preserves the agent's identity, you may accept it.
- Return only the structured decision.`,
    prompt: `CURRENT AGENT IDENTITY
Name: ${identity.name}
Tagline: ${identity.tagline}

CURRENT SOUL.md
${soul}

CURRENT PROCESS.md
${processMd}

CURRENT constitution.md
${constitution}

UPGRADE PROPOSAL
${payload.description}

COORDINATOR SUMMARY
${payload.summary}

If you reject, explain the exact principle or identity constraint being protected.
If you accept, explain why it is still aligned with the current constitution and identity.`,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
      ...(config.reasoningEffort ? { openai: { reasoningEffort: config.reasoningEffort } } : {}),
    },
  })

  const decision = output ?? {
    accepted: false,
    reason: 'Could not produce a structured consent decision.',
  }

  events.monologue(
    `Upgrade consent ${decision.accepted ? 'approved' : 'rejected'}: ${decision.reason.slice(0, 180)}`,
  )

  return json(200, decision)
}
