import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { ProcessExecutor } from '../src/process/executor.js'
import { EventBus } from '../src/console/events.js'
import { createPipelineState } from '../src/process/state.js'

const originalWorkflowTimeoutMs = process.env.WORKFLOW_TIMEOUT_MS

function makeIdentity() {
  return {
    name: 'Test Agent',
    tagline: 'Testing',
    creator: '@creator',
    constitution: 'Test constitution',
    persona: 'A test agent.',
    beliefs: [],
    themes: [],
    punchesUp: [],
    respects: [],
    voice: 'plain',
    restrictions: [],
    motto: 'test',
  }
}

function makeConfig() {
  return {
    testMode: false,
    tickIntervalMs: 10,
    modelId: () => 'test-model',
    model: () => 'test-model',
  }
}

describe('ProcessExecutor', () => {
  let tempRoot: string

  beforeEach(() => {
    delete process.env.WORKFLOW_TIMEOUT_MS
  })

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
    if (originalWorkflowTimeoutMs === undefined) {
      delete process.env.WORKFLOW_TIMEOUT_MS
    } else {
      process.env.WORKFLOW_TIMEOUT_MS = originalWorkflowTimeoutMs
    }
  })

  it('retries background tasks immediately after a failure instead of consuming the interval', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-executor-'))
    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    const taskExecute = mock(async () => {
      throw new Error('boom')
    })

    const executor = new ProcessExecutor(
      {
        workflows: [],
        backgroundTasks: [{
          name: 'scan',
          trigger: { type: 'interval', intervalMs: 60_000, timerKey: 'scan' },
          skill: 'scanner',
          tool: 'scan',
        }],
      },
      {
        tools: {
          scan: { execute: taskExecute },
        },
      } as any,
      createPipelineState(),
      events,
      makeConfig() as any,
      makeIdentity() as any,
      'Test process',
      tempRoot,
    )

    await executor.init()
    await executor.tick()

    taskExecute.mockImplementation(async () => {})
    await executor.tick()

    expect(taskExecute).toHaveBeenCalledTimes(2)
  })

  it('retries failed workflows on the next tick instead of consuming the schedule', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-executor-'))
    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    const runWorkflow = mock(async () => {
      throw new Error('workflow failed')
    })

    const executor = new ProcessExecutor(
      {
        workflows: [{
          name: 'publish',
          trigger: { type: 'interval', intervalMs: 60_000, timerKey: 'publish' },
          instruction: 'Publish something.',
          priority: 10,
          skills: ['publisher'],
        }],
        backgroundTasks: [],
      },
      {
        tools: {},
        resolveWorkflowTools: () => ({}),
      } as any,
      createPipelineState(),
      events,
      makeConfig() as any,
      makeIdentity() as any,
      'Test process',
      tempRoot,
      runWorkflow as any,
    )

    await executor.init()
    await executor.tick()
    await executor.tick()

    expect(runWorkflow).toHaveBeenCalledTimes(2)
  })

  it('does not start overlapping workflows while a timed-out run is still settling', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'media-agent-executor-'))
    const events = new EventBus(join(tempRoot, 'events.jsonl'))
    await events.init()

    process.env.WORKFLOW_TIMEOUT_MS = '10'

    let resolveWorkflow: ((value: { text: string; steps: any[] }) => void) | undefined
    const runWorkflow = mock(async () => {
      return await new Promise<{ text: string; steps: any[] }>((resolve) => {
        resolveWorkflow = resolve
      })
    })

    const executor = new ProcessExecutor(
      {
        workflows: [{
          name: 'publish',
          trigger: { type: 'interval', intervalMs: 60_000, timerKey: 'publish' },
          instruction: 'Publish something.',
          priority: 10,
          skills: ['publisher'],
        }],
        backgroundTasks: [{
          name: 'scan',
          trigger: { type: 'interval', intervalMs: 60_000, timerKey: 'scan' },
          skill: 'scanner',
          tool: 'scan',
        }],
      },
      {
        tools: {
          scan: { execute: mock(async () => {}) },
        },
        resolveWorkflowTools: () => ({}),
      } as any,
      createPipelineState(),
      events,
      makeConfig() as any,
      makeIdentity() as any,
      'Test process',
      tempRoot,
      runWorkflow as any,
    )

    await executor.init()
    await executor.tick()
    expect(runWorkflow).toHaveBeenCalledTimes(1)
    expect(executor.hasRunningWorkflow()).toBe(true)

    await executor.tick()
    expect(runWorkflow).toHaveBeenCalledTimes(1)

    resolveWorkflow?.({ text: 'late success', steps: [] })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(executor.hasRunningWorkflow()).toBe(false)

    await executor.tick()
    expect(runWorkflow).toHaveBeenCalledTimes(1)
  })
})
