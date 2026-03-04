/**
 * Browser automation via browser-autopilot.
 * Auto-launches Chrome if not running. Disable with BROWSER_DISABLED=true.
 */

import { execSync, spawn } from 'child_process'
import { mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'

const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const CDP_URL = process.env.CDP_URL || `http://localhost:${CDP_PORT}`

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

export async function createBrowser(): Promise<unknown | null> {
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
    return browser
  } catch (err) {
    console.error(`Browser connection failed: ${(err as Error).message}`)
    return null
  }
}

export async function runBrowserTask(opts: {
  task: string
  browser: unknown
  extraTools?: Record<string, any>
  maxSteps?: number
  sensitiveData?: Record<string, string>
}): Promise<{ result: string | null; success: boolean }> {
  const { runAgent } = await import('browser-autopilot')
  return runAgent(opts)
}
