import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { CookieEntry } from 'substack-skill'
import {
  authenticateVerifiedSession,
  resolveCdpJsonEndpoint,
  selectCdpTarget,
  type CdpBrowserTarget,
} from '../src/platform/substack/init.js'

const originalCdpUrl = process.env.CDP_URL
const originalCdpPort = process.env.CDP_PORT

afterEach(() => {
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
})
