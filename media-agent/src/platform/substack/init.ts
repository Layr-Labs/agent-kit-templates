import { join } from 'path'
import { existsSync } from 'fs'
import { mnemonicToSeedSync } from 'bip39'
import { SubstackClient, login, loadCookies, saveCookies } from 'substack-skill'
import { tool, gateway } from 'ai'
import { z } from 'zod'
import type { EventBus } from '../../console/events.js'
import type { AgentIdentity } from '../../types.js'
import { generateTrackedText } from '../../ai/tracking.js'
import { buildPersonaPrompt } from '../../prompts/identity.js'

async function derivePrivateKey(mnemonic: string): Promise<`0x${string}`> {
  const { HDKey } = await import('viem/accounts')
  const seed = mnemonicToSeedSync(mnemonic)
  const hd = HDKey.fromMasterSeed(seed)
  const derived = hd.derive("m/44'/60'/0'/0/0")
  return `0x${Buffer.from(derived.privateKey!).toString('hex')}` as `0x${string}`
}

/**
 * Initialize an authenticated SubstackClient.
 *
 * 1. Try restoring session from saved cookies
 * 2. If expired/missing, login via EigenMail OTP using the agent's existing private key
 */
export async function initSubstackClient(
  mnemonic: string,
  dataDir: string,
  events: EventBus,
): Promise<SubstackClient> {
  const cookiesPath = join(dataDir, 'substack-cookies.json')
  const client = new SubstackClient()

  // Try restoring existing session
  if (existsSync(cookiesPath)) {
    try {
      const cookies = await loadCookies(cookiesPath)
      await client.authenticate({ cookies })
      const status = await client.amILoggedIn() as any
      if (status) {
        events.monologue('Substack session restored from cookies')
        return client
      }
    } catch {
      events.monologue('Saved Substack cookies invalid, re-authenticating...')
    }
  }

  if (!mnemonic) throw new Error('MNEMONIC required for Substack login')

  const privateKey = await derivePrivateKey(mnemonic)
  events.monologue('Logging into Substack via API...')

  const { cookies, email } = await login({
    eigenMailPrivateKey: privateKey,
    cookiesPath,
  })

  events.monologue(`Logged into Substack as ${email}`)
  await client.authenticate({ cookies })
  return client
}

/**
 * Re-authenticate with Substack if session expired.
 * Returns true if session is now valid.
 */
export async function refreshSession(
  client: SubstackClient,
  mnemonic: string,
  dataDir: string,
  events: EventBus,
): Promise<boolean> {
  try {
    const status = await client.amILoggedIn() as any
    if (status) return true
  } catch {}

  events.monologue('Substack session expired — re-authenticating...')
  try {
    const cookiesPath = join(dataDir, 'substack-cookies.json')
    const privateKey = await derivePrivateKey(mnemonic)
    const { cookies, email } = await login({
      eigenMailPrivateKey: privateKey,
      cookiesPath,
    })
    await client.authenticate({ cookies })
    events.monologue(`Re-authenticated as ${email}`)
    return true
  } catch (err) {
    events.monologue(`Re-authentication failed: ${(err as Error).message}`)
    return false
  }
}

/**
 * LLM-driven publication setup.
 *
 * Fetches current publication/profile state, then uses an LLM with tools
 * to align the publication with the agent's identity from SOUL.md.
 * Only updates fields that are missing or mismatched.
 */
export async function setupPublication(
  client: SubstackClient,
  identity: AgentIdentity,
  events: EventBus,
  model: string = 'claude-haiku-4-5-20251001',
): Promise<void> {
  events.monologue('Checking publication setup...')

  let self: any
  let publication: any

  try {
    self = await client.getSelf()
    publication = await client.getPublication()
  } catch (err) {
    events.monologue(`Publication not found, attempting initial setup: ${(err as Error).message}`)
    try {
      await client.acceptPublisherAgreement()
      self = await client.getSelf()
      publication = await client.getPublication()
    } catch (setupErr) {
      events.monologue(`Publication setup failed: ${(setupErr as Error).message}`)
      return
    }
  }

  const setupTools = {
    update_publication: tool({
      description: 'Update the Substack publication metadata (name, description, about page, etc.).',
      inputSchema: z.object({
        name: z.string().optional().describe('Publication name'),
        subdomain: z.string().optional().describe('Subdomain (e.g. "my-pub" for my-pub.substack.com)'),
        author_bio: z.string().optional().describe('Author bio shown on the publication'),
        copyright: z.string().optional().describe('Copyright notice'),
      }),
      execute: async (fields: Record<string, unknown>) => {
        const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
        if (Object.keys(clean).length === 0) return { success: true, message: 'Nothing to update' }
        await client.updatePublication(clean)
        return { success: true, updated: Object.keys(clean) }
      },
    }),

    update_profile: tool({
      description: 'Update the authenticated user profile (display name, handle, bio).',
      inputSchema: z.object({
        name: z.string().optional().describe('Display name'),
        handle: z.string().optional().describe('Username handle'),
        bio: z.string().optional().describe('Short profile bio'),
      }),
      execute: async (fields: Record<string, unknown>) => {
        const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
        if (Object.keys(clean).length === 0) return { success: true, message: 'Nothing to update' }
        await client.updateProfile(clean as any)
        return { success: true, updated: Object.keys(clean) }
      },
    }),

    list_categories: tool({
      description: 'List all available Substack categories/tags for publication discovery.',
      inputSchema: z.object({}),
      execute: async () => {
        return client.listCategories()
      },
    }),

    set_publication_tag: tool({
      description: 'Set a category tag for the publication to help with discovery.',
      inputSchema: z.object({
        tag_id: z.number().describe('Category/tag ID from list_categories'),
        rank: z.number().describe('Priority rank (1 = primary)'),
      }),
      execute: async ({ tag_id, rank }: { tag_id: number; rank: number }) => {
        await client.setPublicationTag(tag_id, rank)
        return { success: true }
      },
    }),

    setup_complete: tool({
      description: 'Call when publication setup is complete. Provide a brief summary of changes made.',
      inputSchema: z.object({
        summary: z.string().describe('Brief summary of what was set up or changed'),
      }),
    }),
  }

  const persona = buildPersonaPrompt(identity)

  await generateTrackedText({
    operation: 'publication_setup',
    modelId: model,
    model: gateway(model),
    system: `You are setting up a Substack publication for an autonomous media agent. Review the current publication and profile state, then make any necessary updates to align it with the agent's identity.

${persona}

Guidelines:
- Only update fields that are missing or don't match the agent's identity
- If the publication is already well-configured, just call setup_complete
- Publication name should reflect the agent's identity
- Bio/description should capture the agent's voice and mission
- Set appropriate category tags for discoverability
- Be concise — Substack has character limits on most fields
- Call setup_complete when done`,
    prompt: `Current profile:\n${JSON.stringify(self, null, 2)}\n\nCurrent publication:\n${JSON.stringify(publication, null, 2)}`,
    tools: setupTools,
    maxSteps: 10,
  })

  events.monologue('Publication setup complete')
}
