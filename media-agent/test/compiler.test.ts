import { describe, expect, it } from 'bun:test'
import { validateCompiledAgent } from '../src/process/compiler.js'
import type { CompiledAgent } from '../src/process/types.js'

function makeCompiled(overrides?: Partial<CompiledAgent>): CompiledAgent {
  return {
    version: 1,
    compilerVersion: 3,
    compiledAt: Date.now(),
    sourceHash: 'abc123',
    identity: {
      name: 'Test Agent',
      tagline: 'Testing',
      creator: '@creator',
      persona: 'A test agent.',
      beliefs: ['truth'],
      themes: ['testing'],
      punchesUp: ['bugs'],
      respects: ['evidence'],
      voice: 'plain',
      restrictions: ['do not fabricate'],
      motto: 'test',
    },
    governance: {
      upgradeRules: ['creator may upgrade skills'],
      financialCommitments: [],
      restrictions: ['do not fabricate'],
    },
    plan: {
      backgroundTasks: [{
        name: 'Scan',
        trigger: { type: 'interval', intervalMs: 1000, timerKey: 'scan' },
        skill: 'scanner',
        tool: 'scan',
      }],
      workflows: [{
        name: 'Publish',
        trigger: { type: 'interval', intervalMs: 2000, timerKey: 'publish' },
        instruction: 'Use scan, score_signals, then publish_image.',
        priority: 10,
        runOnce: false,
        skills: ['scanner', 'publisher'],
      }],
    },
    creativeProcess: 'Scan and publish.',
    ...overrides,
  }
}

describe('validateCompiledAgent', () => {
  it('accepts a valid compiled plan', () => {
    const result = validateCompiledAgent(makeCompiled(), {
      availableSkillNames: ['scanner', 'publisher'],
      availableToolNames: ['scan', 'publish_image'],
      platform: 'twitter',
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects duplicate timer keys', () => {
    const compiled = makeCompiled({
      plan: {
        backgroundTasks: [{
          name: 'Scan',
          trigger: { type: 'interval', intervalMs: 1000, timerKey: 'dup' },
          skill: 'scanner',
          tool: 'scan',
        }],
        workflows: [{
          name: 'Publish',
          trigger: { type: 'interval', intervalMs: 2000, timerKey: 'dup' },
          instruction: 'Use publish_image.',
          priority: 10,
          runOnce: false,
          skills: ['publisher'],
        }],
      },
    })

    const result = validateCompiledAgent(compiled, {
      availableSkillNames: ['scanner', 'publisher'],
      availableToolNames: ['scan', 'publish_image'],
      platform: 'twitter',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('reuses timerKey "dup"')
  })

  it('rejects unavailable background tools and skills', () => {
    const result = validateCompiledAgent(makeCompiled(), {
      availableSkillNames: [],
      availableToolNames: [],
      platform: 'twitter',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unavailable tool "scan"')
    expect(result.errors.join('\n')).toContain('unavailable skill "scanner"')
  })

  it('rejects unavailable skills in workflow scopes', () => {
    const compiled = makeCompiled({
      plan: {
        backgroundTasks: [],
        workflows: [{
          name: 'Bad Workflow',
          trigger: { type: 'interval', intervalMs: 2000, timerKey: 'wf' },
          instruction: 'Do stuff.',
          priority: 10,
          runOnce: false,
          skills: ['nonexistent-skill'],
        }],
      },
    })

    const result = validateCompiledAgent(compiled, {
      availableSkillNames: ['scanner'],
      availableToolNames: [],
      platform: 'substack',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('unavailable skill "nonexistent-skill"')
  })
})
