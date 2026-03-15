import { afterEach, describe, expect, it, mock } from 'bun:test'
import { rm, mkdtemp, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CookieEntry } from 'substack-skill'
import {
  authenticateVerifiedSession,
  reuseBrowserAuthenticatedSession,
  resolveCdpJsonEndpoint,
  selectCdpTarget,
  type CdpBrowserTarget,
} from '../src/platform/substack/init.js'

const originalCdpUrl = process.env.CDP_URL
const originalCdpPort = process.env.CDP_PORT
const originalFetch = globalThis.fetch
const tempDirs: string[] = []

afterEach(async () => {
  if (originalCdpUrl === undefined) {
    delete process.env.CDP_URL
  } else {
    process.env.CDP_URL = originalCdpUrl
  }

  if (originalCdpPort === undefined) {
    delete process.env.CDP_PORT
  } else {
    process.env.CDP_PORT = originalCdpPort
  }

  globalThis.fetch = originalFetch

  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('Substack init helpers', () => {
  it('resolves the CDP json endpoint from configured env', () => {
    process.env.CDP_URL = 'http://browser.internal:9333/'
    expect(resolveCdpJsonEndpoint()).toBe('http://browser.internal:9333/json')

    delete process.env.CDP_URL
    process.env.CDP_PORT = '9444'
    expect(resolveCdpJsonEndpoint()).toBe('http://localhost:9444/json')
  })

  it('selects the debugger target that matches the active browser url', () => {
    const targets: CdpBrowserTarget[] = [
      {
        type: 'page',
        url: 'https://example.com',
        webSocketDebuggerUrl: 'ws://first',
      },
      {
        type: 'page',
        url: 'https://writer.substack.com/publish/home',
        webSocketDebuggerUrl: 'ws://substack',
      },
    ]

    expect(
      selectCdpTarget(targets, 'https://writer.substack.com/publish/home?utm_source=test'),
    ).toEqual(targets[1])
  })

  it('verifies that authenticated cookies produce a logged-in session', async () => {
    const client = {
      authenticate: mock(async (_input: { cookies: CookieEntry[] }) => {}),
      amILoggedIn: mock(async () => true),
    }
    const cookies: CookieEntry[] = [{ name: 'substack.sid', value: 'abc', domain: '.substack.com', path: '/', secure: true }]

    await authenticateVerifiedSession(client as any, cookies)

    expect(client.authenticate).toHaveBeenCalledWith({ cookies })
    expect(client.amILoggedIn).toHaveBeenCalledTimes(1)
  })

  it('throws when authenticate completes but the session is still not logged in', async () => {
    const client = {
      authenticate: mock(async (_input: { cookies: CookieEntry[] }) => {}),
      amILoggedIn: mock(async () => false),
    }

    await expect(
      authenticateVerifiedSession(client as any, []),
    ).rejects.toThrow('logged-in Substack session')
  })

  it('reuses an already authenticated browser session instead of waiting for OTP', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'substack-session-'))
    tempDirs.push(tempDir)
    const cookiesPath = join(tempDir, 'substack-cookies.json')
    const cookies: CookieEntry[] = [
      { name: 'substack.sid', value: 'abc', domain: '.substack.com', path: '/', secure: true },
    ]

    globalThis.fetch = mock(async () => {
      throw new Error('CDP unavailable')
    }) as typeof fetch

    const browser = {
      currentUrl: mock(async () => 'https://substack.com'),
      evaluate: mock(async () => {
        throw new Error('not configured')
      }),
    }
    browser.evaluate
      .mockResolvedValueOnce(JSON.stringify({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://substack.com/api/v1/user/profile',
        contentType: 'application/json',
        body: '{"handle":"writer"}',
        json: { handle: 'writer' },
      }))
      .mockResolvedValueOnce(JSON.stringify(cookies))

    const client = {
      authenticate: mock(async (_input: { cookies: CookieEntry[] }) => {}),
      amILoggedIn: mock(async () => true),
    }
    const events = {
      monologue: mock((_message: string) => {}),
    }

    const result = await reuseBrowserAuthenticatedSession(
      client as any,
      browser as any,
      cookiesPath,
      events as any,
    )

    expect(result).toEqual(cookies)
    expect(client.authenticate).toHaveBeenCalledWith({ cookies })
    expect(client.amILoggedIn).toHaveBeenCalledTimes(1)
    expect(JSON.parse(await readFile(cookiesPath, 'utf-8'))).toEqual(cookies)
    expect(
      events.monologue.mock.calls.some(([message]) =>
        String(message).includes('skipping OTP login'),
      ),
    ).toBe(true)
  })

  it('returns null when the browser is not already authenticated', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'substack-no-session-'))
    tempDirs.push(tempDir)
    const cookiesPath = join(tempDir, 'substack-cookies.json')

    const browser = {
      evaluate: mock(async () => JSON.stringify({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        url: 'https://substack.com/api/v1/user/profile',
        contentType: 'application/json',
        body: '{"error":"unauthorized"}',
        json: null,
      })),
    }
    const client = {
      authenticate: mock(async (_input: { cookies: CookieEntry[] }) => {}),
      amILoggedIn: mock(async () => false),
    }
    const events = {
      monologue: mock((_message: string) => {}),
    }

    const result = await reuseBrowserAuthenticatedSession(
      client as any,
      browser as any,
      cookiesPath,
      events as any,
    )

    expect(result).toBeNull()
    expect(client.authenticate).not.toHaveBeenCalled()
  })
})
