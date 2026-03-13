import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { EventBus } from '../src/console/events.js'
import { SkillRegistry } from '../src/skills/registry.js'
import { createPipelineState } from '../src/process/state.js'

function makeSkillContext(tempRoot: string, events: EventBus) {
  return {
    events,
    identity: {
      name: 'Test Agent', tagline: 'Testing', creator: '@creator',
      constitution: 'Test', persona: 'A test agent.', beliefs: [], themes: [],
      punchesUp: [], respects: [], voice: 'plain', restrictions: [], motto: 'test',
    },
    config: {},
    dataDir: tempRoot,
    db: {},
    wallet: {},
    state: createPipelineState(),
    scannerRegistry: {},
    caches: { eval: {}, image: {}, signal: {} },
  } as any
}

async function writeInstalledSkill(
  installedRoot: string,
  name: string,
  manifest: Record<string, unknown>,
  toolNames: string[],
) {
  const skillDir = join(installedRoot, name)
  await mkdir(join(skillDir, 'dist'), { recursive: true })
  await mkdir(join(skillDir, 'source'), { recursive: true })
  await writeFile(join(skillDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(skillDir, 'source', 'index.ts'), 'export default {}')

  const toolEntries = toolNames.map(t =>
    `${t}: { description: '${t} tool', execute: async () => '${t}_result' }`
  ).join(',\n      ')

  await writeFile(join(skillDir, 'dist', 'index.mjs'), `
export default {
  name: '${name}',
  description: '${name} skill',
  category: 'agent',
  async init() {
    return {
      ${toolEntries}
    }
  },
}
`.trim())
}

describe('resolveWorkflowTools', () => {
  let tempRoot: string

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  it('resolves own tools + toolScope for builtin skills', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-resolve-'))
    const builtinRoot = join(tempRoot, 'builtin-skills')
    const agentDir = join(builtinRoot, 'agent', 'alpha')
    const pipelineDir = join(builtinRoot, 'pipeline', 'scanner')

    // Create an agent skill with tools that the pipeline skill's toolScope references
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, 'index.ts'), `
export default {
  name: 'alpha',
  description: 'Alpha skill',
  category: 'agent',
  async init() {
    return {
      alpha_read: { description: 'read', execute: async () => 'ok' },
      alpha_write: { description: 'write', execute: async () => 'ok' },
    }
  },
}
`)

    // Create a pipeline skill with toolScope referencing alpha's tools
    await mkdir(pipelineDir, { recursive: true })
    await writeFile(join(pipelineDir, 'index.ts'), `
export default {
  name: 'scanner',
  description: 'Scanner skill',
  category: 'pipeline',
  toolScope: ['alpha_read'],
  async init() {
    return {
      scan: { description: 'scan', execute: async () => 'scanned' },
    }
  },
}
`)

    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    const registry = new SkillRegistry()
    await registry.discover({ builtinRoot })
    await registry.initAll(makeSkillContext(tempRoot, events))

    // resolveWorkflowTools(['scanner']) should include:
    //   - scan (scanner's own tool)
    //   - alpha_read (from scanner's toolScope)
    //   - NOT alpha_write (not in toolScope)
    const resolved = registry.resolveWorkflowTools(['scanner'])
    expect('scan' in resolved).toBe(true)
    expect('alpha_read' in resolved).toBe(true)
    expect('alpha_write' in resolved).toBe(false)

    await registry.shutdownAll()
  })

  it('includes tools from installed skills with pipelineIntegration', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-pipeline-int-'))
    const builtinRoot = join(tempRoot, 'builtin-skills')
    const installedRoot = join(tempRoot, 'installed-skills')

    // Create a builtin pipeline skill
    const pipelineDir = join(builtinRoot, 'pipeline', 'scanner')
    await mkdir(pipelineDir, { recursive: true })
    await writeFile(join(pipelineDir, 'index.ts'), `
export default {
  name: 'scanner',
  description: 'Scanner skill',
  category: 'pipeline',
  async init() {
    return {
      scan: { description: 'scan', execute: async () => 'scanned' },
    }
  },
}
`)

    // Create an installed skill that declares pipelineIntegration with scanner
    await writeInstalledSkill(installedRoot, 'arxiv-reader', {
      apiVersion: 1,
      name: 'arxiv-reader',
      version: '1.0.0',
      description: 'ArXiv reader skill',
      entrypoint: 'dist/index.mjs',
      sourceEntrypoint: 'source/index.ts',
      tools: [
        { name: 'search_arxiv', description: 'Search arXiv' },
        { name: 'read_paper', description: 'Read arXiv paper' },
      ],
      pipelineIntegration: {
        scanner: ['search_arxiv', 'read_paper'],
      },
      enabled: true,
    }, ['search_arxiv', 'read_paper'])

    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    const registry = new SkillRegistry()
    await registry.discover({ builtinRoot, installedRoot })
    await registry.initAll(makeSkillContext(tempRoot, events))

    // resolveWorkflowTools(['scanner']) should include:
    //   - scan (scanner's own tool)
    //   - search_arxiv, read_paper (from arxiv-reader's pipelineIntegration.scanner)
    const resolved = registry.resolveWorkflowTools(['scanner'])
    expect('scan' in resolved).toBe(true)
    expect('search_arxiv' in resolved).toBe(true)
    expect('read_paper' in resolved).toBe(true)

    await registry.shutdownAll()
  })

  it('does not include pipelineIntegration tools from disabled skills', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-disabled-'))
    const builtinRoot = join(tempRoot, 'builtin-skills')
    const installedRoot = join(tempRoot, 'installed-skills')

    const pipelineDir = join(builtinRoot, 'pipeline', 'scanner')
    await mkdir(pipelineDir, { recursive: true })
    await writeFile(join(pipelineDir, 'index.ts'), `
export default {
  name: 'scanner',
  description: 'Scanner skill',
  category: 'pipeline',
  async init() {
    return {
      scan: { description: 'scan', execute: async () => 'scanned' },
    }
  },
}
`)

    await writeInstalledSkill(installedRoot, 'disabled-skill', {
      apiVersion: 1,
      name: 'disabled-skill',
      version: '1.0.0',
      description: 'Disabled skill',
      entrypoint: 'dist/index.mjs',
      sourceEntrypoint: 'source/index.ts',
      pipelineIntegration: {
        scanner: ['disabled_tool'],
      },
      enabled: false,
    }, ['disabled_tool'])

    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    const registry = new SkillRegistry()
    await registry.discover({ builtinRoot, installedRoot })
    await registry.initAll(makeSkillContext(tempRoot, events))

    const resolved = registry.resolveWorkflowTools(['scanner'])
    expect('scan' in resolved).toBe(true)
    expect('disabled_tool' in resolved).toBe(false)

    await registry.shutdownAll()
  })

  it('does not leak pipelineIntegration tools to unrelated pipeline stages', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-noleak-'))
    const builtinRoot = join(tempRoot, 'builtin-skills')
    const installedRoot = join(tempRoot, 'installed-skills')

    for (const name of ['scanner', 'publisher']) {
      const dir = join(builtinRoot, 'pipeline', name)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'index.ts'), `
export default {
  name: '${name}',
  description: '${name} skill',
  category: 'pipeline',
  async init() {
    return {
      ${name}_tool: { description: '${name}', execute: async () => 'ok' },
    }
  },
}
`)
    }

    // Installed skill only integrates with scanner, not publisher
    await writeInstalledSkill(installedRoot, 'scanner-addon', {
      apiVersion: 1,
      name: 'scanner-addon',
      version: '1.0.0',
      description: 'Scanner addon',
      entrypoint: 'dist/index.mjs',
      sourceEntrypoint: 'source/index.ts',
      pipelineIntegration: {
        scanner: ['addon_scan'],
      },
      enabled: true,
    }, ['addon_scan'])

    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    const registry = new SkillRegistry()
    await registry.discover({ builtinRoot, installedRoot })
    await registry.initAll(makeSkillContext(tempRoot, events))

    // scanner workflow gets the addon tool
    const scannerTools = registry.resolveWorkflowTools(['scanner'])
    expect('addon_scan' in scannerTools).toBe(true)

    // publisher workflow does NOT get the addon tool
    const publisherTools = registry.resolveWorkflowTools(['publisher'])
    expect('addon_scan' in publisherTools).toBe(false)
    expect('publisher_tool' in publisherTools).toBe(true)

    await registry.shutdownAll()
  })

  it('falls back to all tools when no skills are specified', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-fallback-'))
    const builtinRoot = join(tempRoot, 'builtin-skills')

    const dir = join(builtinRoot, 'agent', 'alpha')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'index.ts'), `
export default {
  name: 'alpha',
  description: 'Alpha',
  category: 'agent',
  async init() {
    return { alpha_tool: { description: 'alpha', execute: async () => 'ok' } }
  },
}
`)

    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    const registry = new SkillRegistry()
    await registry.discover({ builtinRoot })
    await registry.initAll(makeSkillContext(tempRoot, events))

    // Empty skill list → empty result (executor falls back to this.skills.tools)
    const resolved = registry.resolveWorkflowTools([])
    expect(Object.keys(resolved).length).toBe(0)

    await registry.shutdownAll()
  })
})
