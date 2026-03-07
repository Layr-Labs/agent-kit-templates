import { tool } from 'ai'
import { z } from 'zod'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { JsonStore } from '../../../store/json-store.js'
import type { Skill, SkillContext } from '../../types.js'
import { Output } from 'ai'
import { generateTrackedText } from '../../../ai/tracking.js'

interface SubstackAccount {
  email: string
  handle: string
  name: string
  publicationUrl?: string
  loggedIn: boolean
  setupAt: number
}

const handlePlanSchema = z.object({
  preferred: z.string().describe('Best publication handle candidate'),
  candidates: z.array(z.string()).min(3).max(6).describe('Fallback handle candidates in order of preference'),
  rationale: z.string().describe('Why these handles fit the identity'),
})

function sanitizeSubstackHandle(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\.substack\.com.*$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

function uniqueHandles(values: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const handle = sanitizeSubstackHandle(value)
    if (!handle || seen.has(handle)) continue
    seen.add(handle)
    out.push(handle)
  }
  return out
}

async function planSubstackHandles(ctx: SkillContext, requestedHandle?: string): Promise<{
  preferred: string
  candidates: string[]
  rationale: string
}> {
  const explicit = sanitizeSubstackHandle(requestedHandle)
  const deterministic = uniqueHandles([
    ctx.identity.name,
    ctx.identity.tagline,
    ctx.identity.creator,
    `${ctx.identity.name}-${ctx.identity.creator}`,
    `${ctx.identity.name}-${ctx.identity.motto}`,
  ])

  if (explicit) {
    const candidates = uniqueHandles([explicit, ...deterministic, `${explicit}-letters`, `${explicit}-dispatch`]).slice(0, 6)
    return {
      preferred: candidates[0] ?? explicit,
      candidates,
      rationale: 'Using the explicitly provided handle first, with deterministic fallbacks.',
    }
  }

  try {
    const { output } = await generateTrackedText({
      operation: 'substack_handle_candidates',
      modelId: ctx.config.modelId('ideation'),
      model: ctx.config.model('ideation'),
      output: Output.object({ schema: handlePlanSchema }),
      system: `You are naming a Substack publication for an autonomous writer.

Return publication handle candidates that feel true to the identity.

Rules:
- Handles must be lowercase URL slugs using only letters, numbers, and hyphens
- No underscores, periods, or spaces
- Prefer memorable, brandable names over generic descriptions
- Avoid random-looking suffixes unless needed as a fallback
- Keep the strongest candidate first`,
      prompt: `Agent identity:
- Name: ${ctx.identity.name}
- Tagline: ${ctx.identity.tagline}
- Creator: ${ctx.identity.creator}
- Persona: ${ctx.identity.persona}
- Voice: ${ctx.identity.voice}
- Motto: ${ctx.identity.motto}
- Themes: ${ctx.identity.themes.join(', ')}
- Beliefs: ${ctx.identity.beliefs.join(', ')}

Generate a preferred Substack handle plus fallback candidates.`,
    })

    const candidates = uniqueHandles([
      output?.preferred,
      ...(output?.candidates ?? []),
      ...deterministic,
    ]).slice(0, 6)

    if (candidates.length > 0) {
      return {
        preferred: candidates[0],
        candidates,
        rationale: output?.rationale ?? 'Generated from identity.',
      }
    }
  } catch {
    // Fall back to deterministic handles below.
  }

  const fallbackCandidates = uniqueHandles([
    ...deterministic,
    'agent-publication',
  ]).slice(0, 6)

  return {
    preferred: fallbackCandidates[0] ?? 'agent-publication',
    candidates: fallbackCandidates,
    rationale: 'Fell back to deterministic identity-derived handles.',
  }
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
            if (existing.publicationUrl) {
              return `Substack account exists: ${existing.name} (@${existing.handle}), logged_in=${existing.loggedIn}, url=${existing.publicationUrl}`
            }
            return `Substack login exists for ${existing.name} (@${existing.handle}), but no publication URL is saved yet. Re-open setup to discover or create the publication.`
          }
          return 'No Substack account configured. Use setup_substack_account to create one.'
        },
      }),

      setup_substack_account: tool({
        description: 'Create a new Substack account and publication via browser. Handles signup, email verification via EigenMail, and publication setup.',
        inputSchema: z.object({
          name: z.string().describe('Display name for the Substack profile'),
          handle: z.string().optional().describe('Preferred Substack handle (URL slug). Optional: the agent can derive one from identity.'),
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
          const handlePlan = await planSubstackHandles(ctx, handle)

          ctx.events.emit({
            type: 'skill',
            skill: 'substack-setup',
            action: `Setting up Substack: ${name} (@${handlePlan.preferred}) with email ${agentEmail}`,
            details: {
              handleCandidates: handlePlan.candidates,
              rationale: handlePlan.rationale,
            },
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
              handle: z.string().optional(),
            }),
            execute: async ({ phase, publication_url, handle: reportedHandle }: any) => {
              const derivedHandle = sanitizeSubstackHandle(
                publication_url?.match(/^https?:\/\/([a-z0-9-]+)\.substack\.com/i)?.[1]
                ?? reportedHandle
                ?? handlePlan.preferred,
              )
              const account: SubstackAccount = {
                email: agentEmail,
                handle: derivedHandle || handlePlan.preferred,
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
- Preferred handle: ${handlePlan.preferred}
- Handle candidates to try in order: ${handlePlan.candidates.join(', ')}
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

PHASE 2 — REUSE EXISTING PUBLICATION OR CREATE ONE:
12. After login, first inspect where you landed. If the account already has a publication, dashboard, publication settings page, or any page on a *.substack.com publication URL, REUSE IT.
13. If an existing publication is present, capture its real publication URL, call report_progress with phase="publication_created", publication_url="<actual url>", and handle="<actual handle>", then stop. Do NOT create a duplicate publication.
14. Only if there is clearly no existing publication, navigate to publication settings or "Start a publication".
15. Try the preferred handle first. If Substack says the handle is unavailable, try the next candidate in order. If all listed candidates fail, create a close identity-preserving variation and keep going until one is accepted.
16. Set name: ${newsletter_name}, description: ${newsletter_description}, and whichever accepted handle works.
17. Skip paid plans, Stripe — choose free.
18. Call report_progress with phase="publication_created" and publication_url="<actual created publication url>" and handle="<accepted handle>".

CRITICAL RULES:
- The "Check your email" page is SUCCESS, not an error. After seeing it, call wait_for_email.
- ONLY call done with text="rate_limited" if you see the EXACT text "Too many login emails" on the page. The "Check your email" page is NOT rate limiting.
- Submit the sign-in form ONLY ONCE. Never re-submit it.
- Do NOT navigate to any email website. Use wait_for_email/read_inbox/read_message tools only.
- Do NOT try to fetch inbox via evaluate() or website APIs. Use the tools.
- Do NOT search the filesystem for credentials.
- Prefer adopting the publication that already exists on the account over creating a new one.
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
