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
          success_url_contains: z.string().default('/home').describe('Substring expected in the URL after successful login'),
          username_env: z.string().default('PLATFORM_USERNAME').describe('Env var containing the username'),
          password_env: z.string().default('PLATFORM_PASSWORD').describe('Env var containing the password'),
          email_env: z.string().default('PLATFORM_EMAIL').describe('Optional env var containing a recovery or verification email'),
          totp_env: z.string().default('PLATFORM_TOTP_KEY').describe('Optional env var containing a TOTP secret for 2FA'),
        }),
        execute: async ({ platform, login_url, success_url_contains, username_env, password_env, email_env, totp_env }) => {
          const username = process.env[username_env]
          const password = process.env[password_env]
          const email = process.env[email_env]
          const totpKey = process.env[totp_env]

          if (!username || !password) {
            return `Missing credentials: set ${username_env} and ${password_env} environment variables.`
          }

          try {
            const { runBrowserLogin } = await import('../../../browser/index.js')

            const result = await runBrowserLogin({
              platform,
              loginUrl: login_url,
              successUrlContains: success_url_contains,
              credentials: {
                username,
                password,
                email,
                totpKey,
              },
              browser: ctx.browser,
              task: `After login, confirm you reached the authenticated ${platform} experience and briefly describe the page.`,
              maxSteps: 30,
            })

            if (result.browser) {
              ctx.browser = result.browser
            }

            if (result.success) {
              ctx.events.emit({
                type: 'skill',
                skill: 'platform-login',
                action: `Logged into ${platform} via ${result.loginMethod}`,
                ts: Date.now(),
              })
              return `Successfully logged into ${platform} via ${result.loginMethod}.`
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
