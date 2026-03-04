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
            const emailToFileResult = (msg: any) => {
              const emailPath = join(ctx.dataDir, `email_${msg.id ?? 'latest'}.html`)
              mkdirSync(ctx.dataDir, { recursive: true })
              writeFileSync(emailPath, msg.body)
              const allUrls = (msg.body as string).match(/https?:\/\/[^\s"<>\]]+/g) ?? []
              const urls = allUrls.filter((u: string) => !u.includes('/open?') && !u.includes('/o/'))
              return {
                subject: msg.subject,
                from: msg.from,
                date: msg.date,
                urls,
                body_saved_to: emailPath,
                hint: `Full email saved to ${emailPath}. If needed, search: grep -i 'verify\\|confirm\\|code\\|link' ${emailPath}`,
              }
            }

            extraTools.wait_for_email = tool({
              description: 'Wait for an email matching criteria. Use immediately after submitting your email on Substack to get the magic link or confirmation link.',
              inputSchema: z.object({
                from: z.string().optional().describe('Filter by sender (e.g. "substack.com")'),
                subject: z.string().optional().describe('Filter by subject (substring match)'),
                timeout_seconds: z.number().default(120).describe('Max wait time in seconds'),
                since_seconds_ago: z.number().default(600).describe('Look back window (seconds). Use >0 if you might have missed the email already.'),
              }),
              execute: async ({ from, subject, timeout_seconds, since_seconds_ago }: any) => {
                try {
                  const msg = await mailClient.waitForEmail({
                    since: new Date(Date.now() - Math.max(0, Number(since_seconds_ago ?? 600)) * 1000),
                    from,
                    subject,
                    timeout: Math.max(timeout_seconds * 1000, 30_000),
                    interval: 5_000,
                  })
                  if (!msg) return { found: false, error: 'Timed out waiting for email. Use read_inbox to check existing messages.' }
                  return { found: true, ...emailToFileResult(msg) }
                } catch (e: any) {
                  return { found: false, error: `Error: ${e.message}` }
                }
              },
            })

            extraTools.read_inbox = tool({
              description: 'List inbox messages (paged). Use q to filter (e.g. "substack").',
              inputSchema: z.object({
                page: z.number().default(1).describe('Page number (1-based)'),
                limit: z.number().default(10).describe('Messages per page'),
                q: z.string().optional().describe('Search query to filter messages'),
              }),
              execute: async ({ page, limit, q }: any) => {
                try {
                  const { messages, total } = await mailClient.inbox({ page, limit, q })
                  return {
                    total,
                    messages: messages.map((m: any) => ({
                      id: m.id,
                      subject: m.subject,
                      from: m.from,
                      date: m.date,
                    })),
                  }
                } catch (e: any) {
                  return { total: 0, messages: [], error: `Error: ${e.message}` }
                }
              },
            })

            extraTools.read_message = tool({
              description: 'Read a specific email by id. Extracts URLs and saves the full body to a file.',
              inputSchema: z.object({
                id: z.string().describe('Message id from read_inbox'),
              }),
              execute: async ({ id }: any) => {
                try {
                  const msg = await mailClient.read(id)
                  return emailToFileResult(msg)
                } catch (e: any) {
                  return { error: `Error: ${e.message}` }
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

TOOLS AVAILABLE (use these, NOT browser navigation for email):
- wait_for_email: Wait for Substack email. IMPORTANT: wait_for_email can look back using since_seconds_ago (default 600 seconds).
- read_inbox: List inbox messages (supports page/limit/q).
- read_message: Read an email by id and extract verification URLs.
- report_progress: Saves setup progress. Call after login and after publication creation.

ACCOUNT DETAILS:
- Email: ${agentEmail}
- Display name: ${name}
- Publication name: ${newsletter_name}
- Handle: ${handle} (URL: https://${handle}.substack.com)
- Description: ${newsletter_description}
- Bio: ${bio}

PHASE 1 — SIGN IN OR CREATE ACCOUNT:
1. Call read_inbox with q="substack" to check if there's already a Substack email waiting
2. Navigate to https://substack.com/sign-in
3. Enter the email: ${agentEmail}
4. Click the Continue button
5. You will see a "Check your email" page. This is NORMAL and means SUCCESS — Substack sent a magic link.
6. Immediately call wait_for_email with from="substack.com" and timeout_seconds=120
7. If wait_for_email.found=true, use the returned urls and navigate to the magic link.
8. If wait_for_email.found=false, call read_inbox again (q="substack", limit=10). Pick the newest message. Call read_message on that id and navigate to the magic link URL.
9. If there is still no email, look for a "Create an account" link on the page and click it, then repeat wait_for_email/read_inbox/read_message until confirmed.
10. Complete any onboarding (profile name: ${name}, skip everything optional)
11. Call report_progress with phase="logged_in"

PHASE 2 — CREATE PUBLICATION:
12. Navigate to publication settings or "Start a publication"
13. Set name: ${newsletter_name}, handle: ${handle}, description: ${newsletter_description}
14. Skip paid plans, Stripe — choose free
15. Call report_progress with phase="publication_created" and publication_url="https://${handle}.substack.com"

CRITICAL RULES:
- The "Check your email" page is SUCCESS, not an error. After seeing it, call wait_for_email.
- ONLY call done with text="rate_limited" if you see the EXACT text "Too many login emails" on the page. The "Check your email" page is NOT rate limiting.
- Submit the sign-in form ONLY ONCE. Never re-submit it.
- Do NOT navigate to any email website. Use wait_for_email/read_inbox/read_message tools only.
- Do NOT try to fetch inbox via evaluate() or website APIs. Use the tools.
- Do NOT search the filesystem for credentials.
- Always choose "Skip" or "Maybe later" for optional features.`,
              browser: ctx.browser,
              extraTools,
              maxSteps: 120,
            })

            const account = await accountStore.read()
            if (!account?.loggedIn) {
              return `Substack setup incomplete. Result: ${result.result?.slice(0, 400) ?? 'no result'}`
            }
            return `Substack set up: ${account.name} at ${account.publicationUrl ?? 'unknown'}. Result: ${result.result?.slice(0, 200)}`
          } catch (err) {
            return `Substack setup error: ${(err as Error).message}`
          }
        },
      }),
    }
  },
}

export default skill
