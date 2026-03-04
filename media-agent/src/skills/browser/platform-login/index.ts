import { tool } from 'ai'
import { z } from 'zod'
import type { Skill, SkillContext } from '../../types.js'

const skill: Skill = {
  name: 'platform-login',
  description: 'Automated platform login via browser automation',
  category: 'browser',

  async init(ctx: SkillContext) {
    return {
      platform_login: tool({
        description: 'Log into a platform using browser automation. Credentials are pulled from environment variables.',
        inputSchema: z.object({
          platform: z.string().describe('Platform name (e.g., twitter, substack, instagram)'),
          login_url: z.string().describe('URL of the login page'),
          username_env: z.string().default('PLATFORM_USERNAME').describe('Env var containing the username'),
          password_env: z.string().default('PLATFORM_PASSWORD').describe('Env var containing the password'),
        }),
        execute: async ({ platform, login_url, username_env, password_env }) => {
          if (!ctx.browser) {
            return 'Browser not available. Cannot login without browser-autopilot.'
          }

          const username = process.env[username_env]
          const password = process.env[password_env]

          if (!username || !password) {
            return `Missing credentials: set ${username_env} and ${password_env} environment variables.`
          }

          try {
            const { runBrowserTask } = await import('../../../browser/index.js')

            const result = await runBrowserTask({
              task: `Navigate to ${login_url}. Log in with the provided credentials. Handle any 2FA or verification prompts. Confirm successful login by checking for dashboard/home elements.`,
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
