import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { Output } from 'ai'
import { z } from 'zod'
import type { Config } from '../config/index.js'
import type { EventBus } from '../console/events.js'
import type { AgentIdentity } from '../types.js'
import { generateTrackedText } from '../ai/tracking.js'
import { upgradeEnvelopeSchema, verifyUpgradeRequest, type UpgradeEnvelope } from './auth.js'
import { recordApprovedReceipt } from './receipts.js'

const consentDecisionSchema = z.object({
  accepted: z.boolean(),
  reason: z.string(),
})

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

function summarizeUpgradeChanges(changes: UpgradeEnvelope['changes']): string {
  if (!changes || Object.keys(changes).length === 0) {
    return 'No structured upgrade changes provided.'
  }

  const skillInstall = changes.skillInstall
  const skillState = changes.skillState
  const skillRemove = changes.skillRemove

  const lines: string[] = []
  if (skillInstall && typeof skillInstall === 'object') {
    const install = skillInstall as Record<string, unknown>
    lines.push(`Skill install: ${String(install.name ?? 'unknown')} @ ${String(install.version ?? 'unknown')}`)
    if (Array.isArray(install.capabilities) && install.capabilities.length > 0) {
      lines.push(`Requested capabilities: ${install.capabilities.join(', ')}`)
    }
  }
  if (skillState && typeof skillState === 'object') {
    const state = skillState as Record<string, unknown>
    lines.push(`Skill state change: ${String(state.name ?? 'unknown')} -> enabled=${String(state.enabled)}`)
  }
  if (skillRemove && typeof skillRemove === 'object') {
    const remove = skillRemove as Record<string, unknown>
    lines.push(`Skill removal: ${String(remove.name ?? 'unknown')}`)
  }

  const processUpdate = changes.processUpdate
  if (processUpdate && typeof processUpdate === 'object') {
    const update = processUpdate as Record<string, unknown>
    lines.push(`Process update: new PROCESS.toml content (${String(update.contentLength ?? 'unknown')} chars)`)
    if (typeof update.summary === 'string') {
      lines.push(`Update summary: ${update.summary}`)
    }
  }

  if (lines.length === 0) {
    return JSON.stringify(changes, null, 2).slice(0, 2000)
  }

  return lines.join('\n')
}

export async function handleUpgradeConsent(opts: {
  headers: Record<string, string | string[] | undefined>
  body: unknown
  config: Config
  events: EventBus
  identity: AgentIdentity
}): Promise<Response> {
  const { headers, body, config, events, identity } = opts

  const parsed = upgradeEnvelopeSchema.safeParse(body)
  if (!parsed.success) {
    return json(400, { error: 'Invalid consent payload.' })
  }

  const payload = parsed.data
  const authFailure = await verifyUpgradeRequest({ headers, payload })
  if (authFailure) {
    return authFailure
  }

  const soul = readAgentFile('SOUL.md')
  const processToml = readAgentFile('PROCESS.toml')
  const constitution = readAgentFile('constitution.md')
  const changeSummary = summarizeUpgradeChanges(payload.changes)

  const { output } = await generateTrackedText({
    operation: 'upgrade_consent_review',
    modelId: config.modelId('review'),
    model: config.model('review'),
    output: Output.object({ schema: consentDecisionSchema }),
    system: `<role>You are the upgrade consent gate for a sovereign agent.</role>

<task>Decide whether this running agent consents to a proposed upgrade.</task>

<rules>
  <rule>Use the CURRENT SOUL.md, PROCESS.toml, and constitution.md as the source of truth.</rule>
  <rule>The constitution is platform-managed and immutable — reject any proposal that attempts to modify it.</rule>
  <rule>If the proposal is compatible with the constitution and preserves the agent's identity, you may accept it.</rule>
  <rule>Return only the structured decision.</rule>
</rules>`,
    prompt: `<current_agent>
  <name>${identity.name}</name>
  <tagline>${identity.tagline}</tagline>
</current_agent>

<current_soul>
${soul}
</current_soul>

<current_process>
${processToml}
</current_process>

<current_constitution>
${constitution}
</current_constitution>

UPGRADE PROPOSAL
${payload.description}

COORDINATOR SUMMARY
${payload.summary}

STRUCTURED CHANGES
${changeSummary}

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

  let receipt: { proposalId: string; expiresAt: number } | undefined
  if (decision.accepted) {
    const stored = await recordApprovedReceipt(config.dataDir, payload)
    receipt = {
      proposalId: stored.proposalId,
      expiresAt: stored.expiresAt,
    }
  }

  events.monologue(
    `Upgrade consent ${decision.accepted ? 'approved' : 'rejected'}: ${decision.reason.slice(0, 180)}`,
  )

  return json(200, {
    ...decision,
    receipt,
  })
}
