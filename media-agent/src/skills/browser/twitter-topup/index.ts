import { tool } from 'ai'
import { z } from 'zod'
import { join } from 'path'
import { JsonStore } from '../../../store/json-store.js'
import type { Skill, SkillContext } from '../../types.js'

interface CardDetails {
  card_number: string
  cvv: string
  expiry: string
  billing_zip?: string
}

const skill: Skill = {
  name: 'twitter-topup',
  description: 'Add payment card to Twitter/X billing via browser',
  category: 'browser',
  dependencies: ['bitrefill'],

  async init(ctx: SkillContext) {
    return {
      topup_twitter_billing: tool({
        description: 'Add a payment card to Twitter/X billing settings. Uses the card from bitrefill skill or env vars.',
        inputSchema: z.object({
          skip_if_exists: z.boolean().default(true).describe('Skip if a payment method is already on file'),
        }),
        execute: async ({ skip_if_exists }) => {
          if (!ctx.browser) {
            return 'Browser not available. Cannot add card to Twitter without browser automation.'
          }

          // Get card details
          let card: CardDetails | null = null

          if (process.env.CARD_NUMBER) {
            card = {
              card_number: process.env.CARD_NUMBER,
              cvv: process.env.CARD_CVV ?? '',
              expiry: process.env.CARD_EXPIRY ?? '',
            }
          } else {
            const cardStore = new JsonStore<CardDetails>(join(ctx.dataDir, 'card_details.json'))
            card = await cardStore.read()
          }

          if (!card) {
            return 'No card available. Provision one first with the bitrefill skill or set CARD_NUMBER/CARD_CVV/CARD_EXPIRY env vars.'
          }

          try {
            const { runBrowserTask } = await import('../../../browser/index.js')

            const { result, success } = await runBrowserTask({
              task: `Navigate to https://x.com/settings/monetization or https://ads.x.com/billing. ${skip_if_exists ? 'First check if a payment method is already on file. If yes, report that and stop.' : ''} Add a new payment card.

Call get_card_details to retrieve the real card number, CVV, expiry, and billing ZIP before entering anything.
After you retrieve the card details, enter them into the billing form and confirm the payment method.

Do not guess card details. Do not search the filesystem for them.`,
              browser: ctx.browser,
              extraTools: {
                get_card_details: tool({
                  description: 'Get the payment card details needed to complete the billing form.',
                  inputSchema: z.object({}),
                  execute: async () => ({
                    card_number: card.card_number,
                    cvv: card.cvv,
                    expiry: card.expiry,
                    billing_zip: card.billing_zip ?? '',
                  }),
                }),
              },
              maxSteps: 30,
            })

            ctx.events.emit({
              type: 'skill',
              skill: 'twitter-topup',
              action: success ? 'Card added to Twitter billing' : `Failed: ${result}`,
              ts: Date.now(),
            })

            return success ? `Card added to Twitter billing: ****${card.card_number.slice(-4)}` : `Failed: ${result}`
          } catch (err) {
            return `Error: ${(err as Error).message}`
          }
        },
      }),
    }
  },
}

export default skill
