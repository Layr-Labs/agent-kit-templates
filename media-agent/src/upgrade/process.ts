import { z } from 'zod'
import { writeFileSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { EventBus } from '../console/events.js'
import type { SkillRegistry } from '../skills/registry.js'
import type { ProcessExecutor } from '../process/executor.js'
import type { Config } from '../config/index.js'
import type { AgentIdentity } from '../types.js'
import { upgradeEnvelopeSchema, verifyUpgradeRequest } from './auth.js'
import { consumeApprovedReceipt } from './receipts.js'
import { loadProcessPlan } from '../process/plan-loader.js'
import { AgentCompiler, validateCompiledAgent } from '../process/compiler.js'

const processUpgradeRequestSchema = upgradeEnvelopeSchema.extend({
  processContent: z.string().min(1).max(50000).describe('New PROCESS.toml content'),
})

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function handleProcessUpgrade(opts: {
  headers: Record<string, string | string[] | undefined>
  body: unknown
  config: Config
  registry: SkillRegistry
  executor: ProcessExecutor
  events: EventBus
  identity: AgentIdentity
}): Promise<Response> {
  const parsed = processUpgradeRequestSchema.safeParse(opts.body)
  if (!parsed.success) {
    return json(400, { error: 'Invalid process upgrade payload.', issues: parsed.error.flatten() })
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
    dataDir: opts.config.dataDir,
    payload: envelope,
    action: 'processUpdate',
  })
  if (!receipt.ok) {
    return json(409, { error: receipt.error })
  }

  const tomlPath = resolve(process.cwd(), 'PROCESS.toml')
  let previousContent = ''

  try {
    previousContent = readFileSync(tomlPath, 'utf-8')
  } catch {}

  try {
    // Write new PROCESS.toml
    writeFileSync(tomlPath, payload.processContent, 'utf-8')

    // Load and validate the new plan
    const { plan, description } = loadProcessPlan(tomlPath)

    // Recompile identity with the new plan
    const soul = readFileSync(resolve(process.cwd(), 'SOUL.md'), 'utf-8')
    const constitution = readFileSync(resolve(process.cwd(), 'constitution.md'), 'utf-8')

    const compiler = new AgentCompiler(opts.config, opts.config.dataDir)
    const compiled = await compiler.compile(soul, constitution, plan, description)

    const validation = validateCompiledAgent(compiled, {
      availableSkillNames: opts.registry.names,
      availableToolNames: Object.keys(opts.registry.tools),
      platform: opts.config.platform,
    })

    if (!validation.ok) {
      writeFileSync(tomlPath, previousContent, 'utf-8')
      return json(400, {
        error: 'Process upgrade produced an invalid plan. Rolled back.',
        validationErrors: validation.errors,
      })
    }

    // Hot-swap the plan
    opts.executor.replacePlan(compiled.plan, compiled.creativeProcess)
    Object.assign(opts.identity, compiled.identity)

    opts.events.emit({
      type: 'skill',
      skill: 'upgrade',
      action: `Updated PROCESS.toml via creator upgrade`,
      details: { proposalId: payload.id, proposedBy: payload.proposedBy },
      ts: Date.now(),
    })

    opts.events.monologue(
      `PROCESS.toml updated via creator upgrade (proposal ${payload.id}). ` +
      `${compiled.plan.workflows.length} workflows, ${compiled.plan.backgroundTasks.length} background tasks.`,
    )

    return json(200, {
      updated: true,
      proposalId: payload.id,
      workflows: compiled.plan.workflows.length,
      backgroundTasks: compiled.plan.backgroundTasks.length,
    })
  } catch (err) {
    // Rollback on any failure
    try { writeFileSync(tomlPath, previousContent, 'utf-8') } catch {}
    return json(400, { error: `Process upgrade failed: ${(err as Error).message}` })
  }
}
