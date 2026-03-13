import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadProcessPlan } from '../src/process/plan-loader.js'

const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
})

describe('loadProcessPlan', () => {
  let tempRoot: string

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  it('throws when PROCESS.toml does not exist', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-plan-'))
    process.chdir(tempRoot)

    expect(() => loadProcessPlan()).toThrow('Missing required file: PROCESS.toml')
  })

  it('parses workflows and description from PROCESS.toml', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-plan-'))
    process.chdir(tempRoot)

    await writeFile(join(tempRoot, 'PROCESS.toml'), `
description = "A daily geopolitical analyst."

[[workflows]]
name = "deep-dive"
priority = 10
timerKey = "deep_dive"
intervalMs = 86400000
skills = ["scanner", "scorer", "publisher"]
instruction = "Scan, score, write, publish."

[[workflows]]
name = "hype-check"
priority = 5
timerKey = "hype_check"
intervalMs = 21600000
skills = ["scanner", "publisher"]
instruction = "Check hype."

[[backgroundTasks]]
name = "scan"
timerKey = "scan"
intervalMs = 1800000
skill = "scanner"
tool = "scan"
`)

    const { plan, description } = loadProcessPlan()
    expect(description).toBe('A daily geopolitical analyst.')
    expect(plan.workflows).toHaveLength(2)
    expect(plan.backgroundTasks).toHaveLength(1)

    const deepDive = plan.workflows[0]
    expect(deepDive.name).toBe('deep-dive')
    expect(deepDive.priority).toBe(10)
    expect(deepDive.trigger.type).toBe('interval')
    expect(deepDive.trigger.intervalMs).toBe(86400000)
    expect(deepDive.trigger.timerKey).toBe('deep_dive')
    expect(deepDive.skills).toEqual(['scanner', 'scorer', 'publisher'])
    expect(deepDive.instruction).toBe('Scan, score, write, publish.')
    expect(deepDive.runOnce).toBe(false)

    const scanTask = plan.backgroundTasks[0]
    expect(scanTask.name).toBe('scan')
    expect(scanTask.trigger.intervalMs).toBe(1800000)
    expect(scanTask.tool).toBe('scan')
  })

  it('defaults priority to 5, runOnce to false, description to empty', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-plan-'))
    process.chdir(tempRoot)

    await writeFile(join(tempRoot, 'PROCESS.toml'), `
[[workflows]]
name = "simple"
timerKey = "simple"
intervalMs = 3600000
skills = ["scanner"]
instruction = "Do stuff."
`)

    const { plan, description } = loadProcessPlan()
    expect(plan.workflows[0].priority).toBe(5)
    expect(plan.workflows[0].runOnce).toBe(false)
    expect(description).toBe('')
  })

  it('throws on missing required fields', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-plan-'))
    process.chdir(tempRoot)

    await writeFile(join(tempRoot, 'PROCESS.toml'), `
[[workflows]]
name = "broken"
timerKey = "broken"
intervalMs = 3600000
skills = ["scanner"]
`)

    expect(() => loadProcessPlan()).toThrow('missing "instruction"')
  })

  it('throws when skills array is empty', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-plan-'))
    process.chdir(tempRoot)

    await writeFile(join(tempRoot, 'PROCESS.toml'), `
[[workflows]]
name = "no-skills"
timerKey = "no_skills"
intervalMs = 3600000
skills = []
instruction = "Do stuff."
`)

    expect(() => loadProcessPlan()).toThrow('missing "skills"')
  })

  it('handles TOML with no workflows (empty process)', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-plan-'))
    process.chdir(tempRoot)

    await writeFile(join(tempRoot, 'PROCESS.toml'), `
description = "Empty agent."
`)

    const { plan, description } = loadProcessPlan()
    expect(description).toBe('Empty agent.')
    expect(plan.workflows).toHaveLength(0)
    expect(plan.backgroundTasks).toHaveLength(0)
  })

  it('parses a full Peer-style process plan', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-plan-'))
    process.chdir(tempRoot)

    await writeFile(join(tempRoot, 'PROCESS.toml'), `
description = """
You are a science paper reviewer. You scan ArXiv, read papers, and tell readers
what the papers actually say — not what the headlines claim.
"""

[[workflows]]
name = "deep-dive"
priority = 10
timerKey = "deep_dive"
intervalMs = 86400000
skills = ["scanner", "scorer", "ideator", "generator", "text_writer", "captioner", "editor", "publisher", "learnings"]
instruction = """
1. Scan ArXiv for new papers from the past 24 hours
2. Score all papers
3. Pick the best paper (minimum 7/10)
4. Write the deep dive article
5. Publish
"""

[[workflows]]
name = "hype-check"
priority = 5
timerKey = "hype_check"
intervalMs = 21600000
skills = ["scanner", "scorer", "publisher", "learnings"]
instruction = "Find viral science stories, check the actual paper, write if gap > 7/10."

[[backgroundTasks]]
name = "scan"
timerKey = "scan"
intervalMs = 1800000
skill = "scanner"
tool = "scan"

[[backgroundTasks]]
name = "engagement"
timerKey = "engagement"
intervalMs = 1800000
skill = "engagement"
tool = "engage_audience"

[[backgroundTasks]]
name = "reflection"
timerKey = "reflection"
intervalMs = 604800000
skill = "reflection"
tool = "reflect_worldview"
`)

    const { plan, description } = loadProcessPlan()
    expect(description).toContain('science paper reviewer')
    expect(plan.workflows).toHaveLength(2)
    expect(plan.backgroundTasks).toHaveLength(3)
    expect(plan.workflows[0].skills).toHaveLength(9)
    expect(plan.backgroundTasks.map(t => t.name)).toEqual(['scan', 'engagement', 'reflection'])
  })
})
