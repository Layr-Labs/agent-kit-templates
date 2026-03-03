import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'

const PLATFORM_LOGIN_CONFIG = {
  twitter: {
    defaultUrl: 'https://x.com/login',
    allowedHosts: new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']),
  },
} as const

function isAllowedLoginUrl(platform: keyof typeof PLATFORM_LOGIN_CONFIG, url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && PLATFORM_LOGIN_CONFIG[platform].allowedHosts.has(parsed.hostname)
  } catch {
    return false
  }
}

const skill: Skill = {
  name: 'platform-login',
  description: 'Automated platform login via browser automation',
  category: 'browser',

  async init(ctx: SkillContext) {
    return {
      platform_login: tool({
        description: 'Log into a platform using browser automation. Credentials are pulled from environment variables.',
        inputSchema: z.object({
          platform: z.enum(['twitter']).describe('Platform name'),
          login_url: z.string().optional().describe('Optional login URL override (must be trusted HTTPS host)'),
        }),
        execute: async ({ platform, login_url }) => {
          if (!ctx.browser) {
            return 'Browser not available. Cannot login without browser-autopilot.'
          }

          const effectiveLoginUrl = login_url || PLATFORM_LOGIN_CONFIG[platform].defaultUrl
          if (!isAllowedLoginUrl(platform, effectiveLoginUrl)) {
            return `Rejected login URL for ${platform}. Use trusted HTTPS ${platform} host only.`
          }

          const username = process.env.TWITTER_USER || process.env.TWITTER_USERNAME
          const password = process.env.TWITTER_PASS

          if (!username || !password) {
            return 'Missing credentials: set TWITTER_USER (or TWITTER_USERNAME) and TWITTER_PASS.'
          }

          try {
            const { runBrowserTask } = await import('../../../browser/index.js')

            const result = await runBrowserTask({
              task: `Navigate to ${effectiveLoginUrl}. Log in with the provided credentials. Handle any 2FA or verification prompts. Confirm successful login by checking for dashboard/home elements.`,
              browser: ctx.browser,
              sensitiveData: {
                username,
                password,
              },
              maxSteps: 30,
            })

            if (result.success) {
              ctx.events.emit({
                type: 'skill',
                skill: 'platform-login',
                action: `Logged into ${platform}`,
                ts: Date.now(),
              })
              return `Successfully logged into ${platform}.`
            }

            return `Login failed: ${result.result}`
          } catch (err) {
            return `Login error: ${(err as Error).message}`
          }
        },
      }),
    }
  },
}

export default skill
