/**
 * Browser automation via browser-autopilot.
 * Auto-launches Chrome if not running. Disable with BROWSER_DISABLED=true.
 */

import { execSync, spawn } from 'child_process'
import { mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import type { BrowserLike, BrowserLoginOptions, BrowserLoginResult, BrowserTaskResult } from './types.js'

const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const CDP_URL = process.env.CDP_URL || `http://localhost:${CDP_PORT}`
const BROWSER_MODEL = process.env.BROWSER_MODEL?.trim() || undefined

function isChromeRunning(): boolean {
  try {
    const res = execSync(`curl -s ${CDP_URL}/json/version`, { timeout: 3000 })
    return res.length > 0
  } catch {
    return false
  }
}

function launchChrome(): void {
  const profileDir = resolve('.data', 'chrome-profile')
  mkdirSync(profileDir, { recursive: true })
  try {
    rmSync(resolve(profileDir, 'SingletonLock'), { force: true })
    rmSync(resolve(profileDir, 'SingletonSocket'), { force: true })
    rmSync(resolve(profileDir, 'SingletonCookie'), { force: true })
  } catch {}

  const isDocker = process.env.container === 'docker' || require('fs').existsSync('/.dockerenv')

  const chromePaths = isDocker
    ? ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        'google-chrome',
        'google-chrome-stable',
        'chromium',
        'chromium-browser',
      ]

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1920,1080',
    ...(isDocker ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : []),
  ]

  for (const chromePath of chromePaths) {
    try {
      const which = execSync(`which ${chromePath} 2>/dev/null`, { timeout: 2000 }).toString().trim()
      if (!which) continue
      const child = spawn(which, args, { detached: true, stdio: 'ignore' })
      child.unref()
      console.log(`Launched Chrome on port ${CDP_PORT} (profile: ${profileDir})`)
      return
    } catch { /* try next path */ }
  }

  console.error('Could not find Chrome/Chromium to launch.')
}

async function waitForChrome(timeoutMs = 20000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (isChromeRunning()) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

async function waitForChromeShutdown(timeoutMs = 10000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (!isChromeRunning()) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

function stopChromeOnDebugPort(): void {
  try {
    const output = execSync(`lsof -ti tcp:${CDP_PORT}`, { timeout: 3000 }).toString().trim()
    if (!output) return
    for (const pid of output.split(/\s+/)) {
      try { process.kill(Number(pid), 'SIGTERM') } catch {}
    }
  } catch {}
}

export async function createBrowser(): Promise<BrowserLike | null> {
  if (process.env.BROWSER_DISABLED === 'true') {
    console.log('Browser disabled via BROWSER_DISABLED=true')
    return null
  }

  if (!isChromeRunning()) {
    console.log('Chrome not running. Launching...')
    launchChrome()
    const ready = await waitForChrome()
    if (!ready) {
      console.error('Chrome failed to start within 20 seconds.')
      return null
    }
  }

  try {
    const { CDPBrowser } = await import('browser-autopilot')
    const browser = new CDPBrowser()
    await browser.connect()
    return browser as BrowserLike
  } catch (err) {
    console.error(`Browser connection failed: ${(err as Error).message}`)
    return null
  }
}

export async function disconnectBrowser(browser?: BrowserLike | null): Promise<void> {
  if (!browser) return
  try {
    await browser.disconnect()
  } catch {}
}

const DEFAULT_BROWSER_TASK_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

export async function runBrowserTask(opts: {
  task: string
  browser: BrowserLike
  extraTools?: Record<string, any>
  maxSteps?: number
  sensitiveData?: Record<string, string>
  timeoutMs?: number
}): Promise<BrowserTaskResult> {
  const { runAgent } = await import('browser-autopilot')
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BROWSER_TASK_TIMEOUT_MS

  const taskPromise = runAgent({ ...opts, model: BROWSER_MODEL })
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Browser task timed out after ${timeoutMs / 1000}s`)), timeoutMs),
  )

  const result = await Promise.race([taskPromise, timeoutPromise])
  return {
    result: result.result,
    success: result.success,
  }
}

export async function runBrowserLogin(opts: BrowserLoginOptions): Promise<BrowserLoginResult> {
  const {
    platform,
    loginUrl,
    successUrlContains,
    credentials,
    browser,
    task = `Confirm you are logged into ${platform} and describe the authenticated home or dashboard page.`,
    maxSteps = 40,
  } = opts

  await disconnectBrowser(browser)
  stopChromeOnDebugPort()
  await waitForChromeShutdown()

  const { orchestrate } = await import('browser-autopilot')
  const result = await orchestrate({
    credentials: {
      username: credentials.username,
      password: credentials.password,
      email: credentials.email ?? '',
      totpKey: credentials.totpKey ?? '',
    },
    loginUrl,
    successUrlContains,
    task,
    maxSteps,
    keepBrowser: true,
    model: BROWSER_MODEL,
  })

  return {
    result: result.result,
    success: result.success,
    browser: (result.browser as BrowserLike | undefined) ?? null,
    loginMethod: result.loginMethod,
  }
}
