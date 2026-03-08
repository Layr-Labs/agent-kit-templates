import { z } from 'zod'
import type { EventBus } from '../console/events.js'
import {
  computeInstalledSkillBundleHash,
  installedSkillBundleSchema,
  installSkillBundle,
  removeInstalledSkill,
  setInstalledSkillEnabled,
} from '../skills/installed.js'
import type { SkillRegistry } from '../skills/registry.js'
import { upgradeEnvelopeSchema, verifyUpgradeRequest } from './auth.js'
import { consumeApprovedReceipt } from './receipts.js'

const installSkillRequestSchema = upgradeEnvelopeSchema.extend({
  skillInstall: installedSkillBundleSchema,
})

const setSkillStateRequestSchema = upgradeEnvelopeSchema.extend({
  skillState: z.object({
    name: z.string().min(1),
    enabled: z.boolean(),
  }),
})

const removeSkillRequestSchema = upgradeEnvelopeSchema.extend({
  skillRemove: z.object({
    name: z.string().min(1),
  }),
})

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function handleSkillInstallUpgrade(opts: {
  headers: Record<string, string | string[] | undefined>
  body: unknown
  dataDir: string
  installedRoot: string
  registry: SkillRegistry
  events: EventBus
}): Promise<Response> {
  const parsed = installSkillRequestSchema.safeParse(opts.body)
  if (!parsed.success) {
    return json(400, { error: 'Invalid skill install payload.', issues: parsed.error.flatten() })
  }

  const payload = parsed.data
  const envelope = {
    id: payload.id,
    description: payload.description,
    summary: payload.summary,
    proposedBy: payload.proposedBy,
    timestamp: payload.timestamp,
    changes: payload.changes,
  }
  const authFailure = await verifyUpgradeRequest({ headers: opts.headers, payload: envelope })
  if (authFailure) return authFailure

  const receipt = await consumeApprovedReceipt({
    dataDir: opts.dataDir,
    payload: envelope,
    action: 'skillInstall',
  })
  if (!receipt.ok) {
    return json(409, { error: receipt.error })
  }

  const declaredHash = (() => {
    const value = payload.changes?.skillInstall
    if (!value || typeof value !== 'object') return undefined
    const bundleHash = (value as Record<string, unknown>).bundleHash
    return typeof bundleHash === 'string' ? bundleHash : undefined
  })()
  const computedHash = computeInstalledSkillBundleHash(payload.skillInstall)
  if (declaredHash && declaredHash !== computedHash) {
    return json(400, { error: `Skill install payload hash mismatch. expected=${declaredHash} computed=${computedHash}` })
  }

  try {
    const installed = await installSkillBundle(opts.installedRoot, payload.skillInstall)
    await opts.registry.reloadInstalledSkills()
    if (installed.manifest.enabled !== false && !opts.registry.get(installed.manifest.name)) {
      return json(400, {
        error: `Skill bundle was written but could not be loaded: ${installed.manifest.name}@${installed.manifest.version}`,
      })
    }

    opts.events.emit({
      type: 'skill',
      skill: 'upgrade',
      action: `Installed creator skill ${installed.manifest.name}@${installed.manifest.version}`,
      details: {
        source: 'installed',
        bundleHash: installed.bundleHash,
        capabilities: installed.manifest.capabilities ?? [],
      },
      ts: Date.now(),
    })

    return json(200, {
      installed: true,
      name: installed.manifest.name,
      version: installed.manifest.version,
      bundleHash: installed.bundleHash,
    })
  } catch (err) {
    return json(400, { error: `Skill install failed: ${(err as Error).message}` })
  }
}

export async function handleSkillStateUpgrade(opts: {
  headers: Record<string, string | string[] | undefined>
  body: unknown
  dataDir: string
  installedRoot: string
  registry: SkillRegistry
  events: EventBus
}): Promise<Response> {
  const parsed = setSkillStateRequestSchema.safeParse(opts.body)
  if (!parsed.success) {
    return json(400, { error: 'Invalid skill state payload.', issues: parsed.error.flatten() })
  }

  const payload = parsed.data
  const envelope = {
    id: payload.id,
    description: payload.description,
    summary: payload.summary,
    proposedBy: payload.proposedBy,
    timestamp: payload.timestamp,
    changes: payload.changes,
  }
  const authFailure = await verifyUpgradeRequest({ headers: opts.headers, payload: envelope })
  if (authFailure) return authFailure

  const receipt = await consumeApprovedReceipt({
    dataDir: opts.dataDir,
    payload: envelope,
    action: 'skillState',
  })
  if (!receipt.ok) {
    return json(409, { error: receipt.error })
  }

  try {
    const manifest = await setInstalledSkillEnabled(
      opts.installedRoot,
      payload.skillState.name,
      payload.skillState.enabled,
    )
    await opts.registry.reloadInstalledSkills()
    if (payload.skillState.enabled && !opts.registry.get(manifest.name)) {
      return json(400, {
        error: `Skill was enabled on disk but could not be loaded: ${manifest.name}@${manifest.version}`,
      })
    }

    opts.events.emit({
      type: 'skill',
      skill: 'upgrade',
      action: `${manifest.enabled === false ? 'Disabled' : 'Enabled'} creator skill ${manifest.name}@${manifest.version}`,
      details: { source: 'installed' },
      ts: Date.now(),
    })

    return json(200, {
      updated: true,
      name: manifest.name,
      version: manifest.version,
      enabled: manifest.enabled !== false,
    })
  } catch (err) {
    return json(400, { error: `Skill state update failed: ${(err as Error).message}` })
  }
}

export async function handleSkillRemoveUpgrade(opts: {
  headers: Record<string, string | string[] | undefined>
  body: unknown
  dataDir: string
  installedRoot: string
  registry: SkillRegistry
  events: EventBus
}): Promise<Response> {
  const parsed = removeSkillRequestSchema.safeParse(opts.body)
  if (!parsed.success) {
    return json(400, { error: 'Invalid skill removal payload.', issues: parsed.error.flatten() })
  }

  const payload = parsed.data
  const envelope = {
    id: payload.id,
    description: payload.description,
    summary: payload.summary,
    proposedBy: payload.proposedBy,
    timestamp: payload.timestamp,
    changes: payload.changes,
  }
  const authFailure = await verifyUpgradeRequest({ headers: opts.headers, payload: envelope })
  if (authFailure) return authFailure

  const receipt = await consumeApprovedReceipt({
    dataDir: opts.dataDir,
    payload: envelope,
    action: 'skillRemove',
  })
  if (!receipt.ok) {
    return json(409, { error: receipt.error })
  }

  try {
    await removeInstalledSkill(opts.installedRoot, payload.skillRemove.name)
    await opts.registry.reloadInstalledSkills()

    opts.events.emit({
      type: 'skill',
      skill: 'upgrade',
      action: `Removed creator skill ${payload.skillRemove.name}`,
      details: { source: 'installed' },
      ts: Date.now(),
    })

    return json(200, {
      removed: true,
      name: payload.skillRemove.name,
    })
  } catch (err) {
    return json(400, { error: `Skill removal failed: ${(err as Error).message}` })
  }
}
