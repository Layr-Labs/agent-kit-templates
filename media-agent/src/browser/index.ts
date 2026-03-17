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
// Default to hybrid — CDP for reading/DOM + X11 for input (undetectable).
// All tools work (extract, evaluate, tabs, shell), but clicks/typing go through xdotool.
// Both "x11" and "hybrid" use the same hybrid mode (CDP reads + X11 input).
// Set BROWSER_MODE=cdp to use pure CDP (old behavior, detectable).
const BROWSER_MODE_RAW = (process.env.BROWSER_MODE ?? 'hybrid').toLowerCase()
const BROWSER_MODE = BROWSER_MODE_RAW === 'cdp' ? 'cdp' : 'hybrid'

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
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-component-extensions-with-background-pages',
    '--disable-features=OptimizationGuideOnDeviceModel',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--log-level=3',
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

export async function createBrowser(opts?: { fresh?: boolean }): Promise<BrowserLike | null> {
  if (process.env.BROWSER_DISABLED === 'true') {
    console.log('Browser disabled via BROWSER_DISABLED=true')
    return null
  }

  if (opts?.fresh) {
    stopChromeOnDebugPort()
    await waitForChromeShutdown()
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

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs),
  )
  return Promise.race([promise, timeoutPromise])
}

async function runX11BrowserTask(task: string, maxSteps: number): Promise<BrowserTaskResult> {
  const { X11Agent } = await import('browser-autopilot') as any
  const x11 = new X11Agent({ model: BROWSER_MODEL })
  const result = await x11.runDetailed({
    systemPrompt: `You are controlling a Chrome browser via X11 to complete a task.
You receive a fresh screenshot every step. Coordinates are relative to the screenshot.

Task:
${task}

Available actions (ONE per message):
ACTION: CLICK x y
ACTION: DOUBLE_CLICK x y
ACTION: MOVE x y
ACTION: DRAG x1 y1 x2 y2
ACTION: SCROLL down pixels
ACTION: SCROLL up pixels
ACTION: TYPE text
ACTION: KEY keyname
ACTION: KEYPRESS keyname
ACTION: PASTE_TEXT text
ACTION: PASTE_CONTENT filepath
ACTION: WAIT seconds
ACTION: SCREENSHOT
ACTION: DONE summary
ACTION: FAILED reason

Rules:
- Click before typing if a field does not clearly have focus.
- Keep waits short (1-3 seconds).
- When the task is complete, say DONE followed by a short summary.
- If blocked or stuck, say FAILED with a reason.`,
    maxSteps,
    stepDelayMs: 750,
  })
  return { result: result.result, success: result.success }
}

async function runCDPBrowserTask(opts: {
  task: string
  browser: BrowserLike
  extraTools?: Record<string, any>
  maxSteps?: number
  sensitiveData?: Record<string, string>
}): Promise<BrowserTaskResult> {
  const { runAgent } = await import('browser-autopilot')
  const result = await runAgent({ ...opts, model: BROWSER_MODEL })
  return { result: result.result, success: result.success }
}

export async function runBrowserTask(opts: {
  task: string
  browser: BrowserLike
  extraTools?: Record<string, any>
  maxSteps?: number
  sensitiveData?: Record<string, string>
  timeoutMs?: number
}): Promise<BrowserTaskResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BROWSER_TASK_TIMEOUT_MS

  // Both hybrid and cdp use the CDP agent loop (full tool suite).
  // In hybrid mode (default), runAgent sets browser.inputMode = "hybrid"
  // so clicks/typing/scrolling go through xdotool (undetectable).
  // In cdp mode, everything goes through CDP (old behavior).
  return runWithTimeout(runCDPBrowserTask(opts), timeoutMs, 'Browser task')
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
    extraTools = {},
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
    extraTools,
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
