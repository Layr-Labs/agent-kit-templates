import { tool } from 'ai'
import { z } from 'zod'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { JsonStore } from '../../../store/json-store.js'
import type { Skill, SkillContext } from '../../types.js'

interface SubstackAccount {
  email: string
  handle: string
  name: string
  publicationUrl?: string
  loggedIn: boolean
  setupAt: number
}

const skill: Skill = {
  name: 'substack-setup',
  description: 'Set up and manage a Substack account via browser automation. Handles signup, email verification, and publication creation.',
  category: 'browser',

  async init(ctx: SkillContext) {
    const accountStore = new JsonStore<SubstackAccount>(join(ctx.dataDir, 'substack-account.json'))

    // Get EigenMail client for email verification
    let mailClient: any = null
    try {
      const mnemonic = process.env.MNEMONIC
      if (mnemonic) {
        const { mnemonicToSeedSync } = await import('bip39')
        const { HDKey } = await import('viem/accounts')
        const seed = mnemonicToSeedSync(mnemonic)
        const hd = HDKey.fromMasterSeed(seed)
        const derived = hd.derive("m/44'/60'/0'/0/0")
        const privateKey = `0x${Buffer.from(derived.privateKey!).toString('hex')}` as `0x${string}`

        const { EigenMailClient } = await import('eigenmail-sdk')
        mailClient = new EigenMailClient({
          privateKey,
          apiUrl: process.env.EIGENMAIL_API_URL ?? 'https://api.eigenagents.org',
        })
        await mailClient.login()
      }
    } catch { /* mail client optional */ }

    return {
      check_substack_account: tool({
        description: 'Check if a Substack account is already set up for this agent',
        inputSchema: z.object({}),
        execute: async () => {
          const existing = await accountStore.read()
          if (existing) {
            return `Substack account exists: ${existing.name} (@${existing.handle}), logged_in=${existing.loggedIn}, url=${existing.publicationUrl ?? 'none'}`
          }
          return 'No Substack account configured. Use setup_substack_account to create one.'
        },
      }),

      setup_substack_account: tool({
        description: 'Create a new Substack account and publication via browser. Handles signup, email verification via EigenMail, and publication setup.',
        inputSchema: z.object({
          name: z.string().describe('Display name for the Substack profile'),
          handle: z.string().describe('Substack handle (URL slug)'),
          bio: z.string().describe('Short bio for the profile'),
          newsletter_name: z.string().describe('Name of the newsletter'),
          newsletter_description: z.string().describe('One-line description of the newsletter'),
        }),
        execute: async ({ name, handle, bio, newsletter_name, newsletter_description }) => {
          if (!ctx.browser) {
            return 'Browser not available. Cannot set up Substack.'
          }

          const existing = await accountStore.read()
          if (existing?.loggedIn && existing?.publicationUrl) {
            return `Account already set up: ${existing.name} at ${existing.publicationUrl}`
          }

          const agentEmail = (ctx as any).agentEmail ?? `${ctx.wallet.ethAddress.toLowerCase()}@eigenmail.xyz`

          ctx.events.emit({
            type: 'skill',
            skill: 'substack-setup',
            action: `Setting up Substack: ${name} (@${handle}) with email ${agentEmail}`,
            ts: Date.now(),
          })

          // Build email verification tools for the browser agent
          const extraTools: Record<string, any> = {}

          if (mailClient) {
            extraTools.wait_for_email = tool({
              description: 'Wait for a NEW verification email to arrive. Polls the inbox until a matching message appears. Use this after submitting your email on Substack to get the verification code or magic link.',
              inputSchema: z.object({
                from: z.string().optional().describe('Filter by sender (e.g. "substack.com")'),
                subject: z.string().optional().describe('Filter by subject (substring match)'),
                timeout_seconds: z.number().default(120).describe('Max wait time in seconds'),
              }),
              execute: async ({ from, subject, timeout_seconds }: any) => {
                try {
                  const msg = await mailClient.waitForEmail({
                    from,
                    subject,
                    timeout: Math.max(timeout_seconds * 1000, 30_000),
                    interval: 5_000,
                  })
                  if (!msg) return 'Timed out — no matching email arrived. Make sure you submitted the form first.'

                  const allUrls = (msg.body as string).match(/https?:\/\/[^\s"<>\]]+/g) ?? []
                  const urls = allUrls.filter((u: string) => !u.includes('/open?') && !u.includes('/o/'))

                  // Save email body to file for inspection
                  const emailPath = join(ctx.dataDir, 'email_latest.html')
                  mkdirSync(ctx.dataDir, { recursive: true })
                  writeFileSync(emailPath, msg.body)

                  return JSON.stringify({
                    subject: msg.subject,
                    from: msg.from,
                    urls,
                    body_saved_to: emailPath,
                    hint: 'Look for a 6-digit code or a verification/magic link URL in the urls list.',
                  }, null, 2)
                } catch (e: any) {
                  return `Error: ${e.message}`
                }
              },
            })

            extraTools.read_inbox = tool({
              description: 'List recent emails in the agent inbox.',
              inputSchema: z.object({
                limit: z.number().default(10),
              }),
              execute: async ({ limit }: any) => {
                try {
                  const { messages } = await mailClient.inbox({ limit })
                  return JSON.stringify(messages.map((m: any) => ({
                    id: m.id, subject: m.subject, from: m.from, date: m.date,
                  })), null, 2)
                } catch (e: any) {
                  return `Error: ${e.message}`
                }
              },
            })
          }

          extraTools.report_progress = tool({
            description: 'Report progress after completing a phase (logged_in, publication_created).',
            inputSchema: z.object({
              phase: z.enum(['logged_in', 'publication_created']),
              publication_url: z.string().optional(),
            }),
            execute: async ({ phase, publication_url }: any) => {
              const account: SubstackAccount = {
                email: agentEmail,
                handle,
                name,
                publicationUrl: publication_url,
                loggedIn: phase === 'logged_in' || phase === 'publication_created',
                setupAt: Date.now(),
              }
              await accountStore.write(account)
              ctx.events.monologue(`Substack setup progress: ${phase}`)
              return `Progress saved: ${phase}`
            },
          })

          try {
            const { runBrowserTask } = await import('../../../browser/index.js')

            const result = await runBrowserTask({
              task: `You are setting up a Substack publication.

You have special tools available beyond browser actions:
- wait_for_email: Polls the agent's email inbox for new messages. Use this to get verification codes/links from Substack. Call it with from="substack.com" after submitting your email on Substack's sign-in page.
- read_inbox: Lists recent emails in the agent's inbox.
- report_progress: Saves setup progress. Call after login and after publication creation.

DO NOT try to check email by navigating to any website or API URL. DO NOT navigate to eigenagents.org, agentmail.to, or any email provider website. Use the wait_for_email tool — it is a tool call, not a website.

ACCOUNT DETAILS:
- Email: ${agentEmail}
- Display name: ${name}
- Publication name: ${newsletter_name}
- Handle: ${handle} (URL: https://${handle}.substack.com)
- Description: ${newsletter_description}
- Bio: ${bio}

PHASE 1 — SIGN IN OR SIGN UP:
1. Navigate to https://substack.com and click "Start writing" or find sign-in
2. Enter the email: ${agentEmail}
3. Click continue/submit
4. Substack sends a verification email. Use the wait_for_email tool (NOT browser navigation): call wait_for_email with from="substack.com"
5. The wait_for_email result will contain either:
   - A 6-digit code → type it into the verification field on the page
   - URLs → find the verification/magic link and use the navigate tool to open it
6. Complete any onboarding (profile name: ${name}, skip everything optional)
7. Call report_progress with phase="logged_in"

PHASE 2 — CREATE PUBLICATION:
8. Navigate to publication settings or "Start a publication"
9. Set name: ${newsletter_name}, handle: ${handle}, description: ${newsletter_description}
10. Skip paid plans, Stripe — choose free
11. Call report_progress with phase="publication_created" and publication_url="https://${handle}.substack.com"

IMPORTANT:
- Always choose "Skip", "Maybe later", or "Continue" for optional features
- If a step fails, try a different approach
- Do NOT search the filesystem for credentials or passwords
- Do NOT navigate to email provider websites — use the wait_for_email tool instead`,
              browser: ctx.browser,
              extraTools,
              maxSteps: 120,
            })

            // Save account regardless of whether report_progress was called
            const existing = await accountStore.read()
            if (!existing || !existing.loggedIn) {
              const account: SubstackAccount = {
                email: agentEmail,
                handle,
                name,
                publicationUrl: `https://${handle}.substack.com`,
                loggedIn: true,
                setupAt: Date.now(),
              }
              await accountStore.write(account)
            }

            const account = await accountStore.read()
            return `Substack set up: ${account?.name} at ${account?.publicationUrl}. Result: ${result.result?.slice(0, 200)}`
          } catch (err) {
            return `Substack setup error: ${(err as Error).message}`
          }
        },
      }),
    }
  },
}

export default skill
