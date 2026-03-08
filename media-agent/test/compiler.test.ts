import { describe, expect, it } from 'bun:test'
import { buildCompilerToolCatalog } from '../src/process/tool-catalog.js'
import { validateCompiledAgent } from '../src/process/compiler.js'
import type { CompiledAgent } from '../src/process/types.js'
import type { InstalledSkillManifest } from '../src/skills/types.js'

function makeCompiled(overrides?: Partial<CompiledAgent>): CompiledAgent {
  return {
    version: 1,
    compilerVersion: 2,
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
      }],
    },
    creativeProcess: 'Scan and publish.',
    ...overrides,
  }
}

describe('validateCompiledAgent', () => {
  it('accepts a valid compiled plan', () => {
    const result = validateCompiledAgent(makeCompiled(), {
      availableSkillNames: ['scanner'],
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
        }],
      },
    })

    const result = validateCompiledAgent(compiled, {
      availableSkillNames: ['scanner'],
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

  it('rejects deprecated create_skill references', () => {
    const compiled = makeCompiled({
      plan: {
        backgroundTasks: [],
        workflows: [{
          name: 'Bad Workflow',
          trigger: { type: 'interval', intervalMs: 2000, timerKey: 'wf' },
          instruction: 'If needed, call create_skill to add a PDF parser.',
          priority: 10,
          runOnce: false,
        }],
      },
    })

    const result = validateCompiledAgent(compiled, {
      availableSkillNames: [],
      availableToolNames: [],
      platform: 'substack',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('deprecated tool "create_skill"')
  })

  it('rejects publish_article instructions on twitter', () => {
    const compiled = makeCompiled({
      plan: {
        backgroundTasks: [],
        workflows: [{
          name: 'Bad Twitter Workflow',
          trigger: { type: 'interval', intervalMs: 2000, timerKey: 'wf' },
          instruction: 'Research the topic and then publish_article.',
          priority: 10,
          runOnce: false,
        }],
      },
    })

    const result = validateCompiledAgent(compiled, {
      availableSkillNames: [],
      availableToolNames: ['publish_article'],
      platform: 'twitter',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toContain('publish_article on twitter')
  })
})

describe('buildCompilerToolCatalog', () => {
  it('includes installed skill tool declarations', () => {
    const manifest: InstalledSkillManifest = {
      apiVersion: 1,
      name: 'pdf-reader',
      version: '1.0.0',
      description: 'Reads PDFs',
      entrypoint: 'index.mjs',
      sourceEntrypoint: 'source/index.ts',
      enabled: true,
      tools: [{
        name: 'read_pdf',
        description: 'Read and extract text from PDF files',
      }],
    }

    const catalog = buildCompilerToolCatalog([manifest])
    const readPdf = catalog.find((tool) => tool.name === 'read_pdf')

    expect(readPdf).toBeDefined()
    expect(readPdf?.source).toBe('installed')
    expect(readPdf?.skill).toBe('pdf-reader')
  })
})
