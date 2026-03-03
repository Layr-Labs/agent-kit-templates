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
  provisioned_at: number
}

const skill: Skill = {
  name: 'bitrefill',
  description: 'Prepaid card provisioning via Bitrefill',
  category: 'browser',
  dependencies: ['cast'],

  async init(ctx: SkillContext) {
    const cardStore = new JsonStore<CardDetails>(join(ctx.dataDir, 'card_details.json'))

    // Check if manual card provided via env
    if (process.env.CARD_NUMBER) {
      const card: CardDetails = {
        card_number: process.env.CARD_NUMBER,
        cvv: process.env.CARD_CVV ?? '',
        expiry: process.env.CARD_EXPIRY ?? '',
        provisioned_at: Date.now(),
      }
      await cardStore.write(card)
      console.log(`Bitrefill: Using manual card ****${card.card_number.slice(-4)}`)
    }

    return {
      check_card_status: tool({
        description: 'Check if a prepaid card is already provisioned',
        inputSchema: z.object({}),
        execute: async () => {
          const existing = await cardStore.read()
          if (existing) {
            return `Card provisioned: ****${existing.card_number.slice(-4)} (exp: ${existing.expiry})`
          }
          return 'No card provisioned. Use provision_card to buy one, or set CARD_NUMBER/CARD_CVV/CARD_EXPIRY env vars.'
        },
      }),

      get_card_details: tool({
        description: 'Get the virtual card details (number, CVV, expiry)',
        inputSchema: z.object({}),
        execute: async () => {
          const card = await cardStore.read()
          if (!card) return 'No card available. Provision one first.'
          return JSON.stringify({
            card_number: card.card_number,
            cvv: card.cvv,
            expiry: card.expiry,
            billing_zip: card.billing_zip,
          })
        },
      }),

      provision_card: tool({
        description: 'Buy a prepaid card on Bitrefill and redeem for virtual Visa. Requires browser automation.',
        inputSchema: z.object({
          amount: z.number().default(50).describe('Card amount in USD'),
          payment_chain: z.enum(['ethereum', 'solana']).default('ethereum'),
        }),
        execute: async ({ amount, payment_chain }) => {
          if (!ctx.browser) {
            return 'Browser not available. Cannot provision card without browser automation.'
          }

          const existing = await cardStore.read()
          if (existing) {
            return `Card already provisioned: ****${existing.card_number.slice(-4)}. Delete card_details.json to re-provision.`
          }

          ctx.events.emit({
            type: 'skill',
            skill: 'bitrefill',
            action: `Provisioning $${amount} prepaid card via ${payment_chain}`,
            ts: Date.now(),
          })

          try {
            const { runBrowserTask } = await import('../../../browser/index.js')

            // Phase 1: Buy card
            const buyResult = await runBrowserTask({
              task: `Go to bitrefill.com. Find "Digital Prepaid Visa" gift card. Select $${amount} denomination. Proceed to checkout. Select ${payment_chain === 'ethereum' ? 'ETH' : 'SOL'} as payment method. Complete the payment. After purchase, extract the FULL gift card code (12-16 characters) and any PIN. Look for a "Redeem" button and get the redemption URL. Report the gift card details using the report_gift_card tool.`,
              browser: ctx.browser,
              extraTools: {
                report_gift_card: tool({
                  description: 'Report purchased gift card code and redemption URL',
                  inputSchema: z.object({
                    code: z.string(),
                    pin: z.string().optional(),
                    redemption_url: z.string().optional(),
                  }),
                  execute: async ({ code, pin, redemption_url }) => {
                    const giftCard = { code, pin, redemption_url }
                    await new JsonStore(join(ctx.dataDir, 'gift_card.json')).write(giftCard)
                    return `Gift card saved: ${code.slice(0, 4)}****`
                  },
                }),
              },
              maxSteps: 60,
            })

            if (!buyResult.success) {
              return `Card purchase failed: ${buyResult.result}`
            }

            // Phase 2: Redeem card
            const giftCardStore = new JsonStore<{ code: string; pin?: string; redemption_url?: string }>(join(ctx.dataDir, 'gift_card.json'))
            const giftCard = await giftCardStore.read()
            if (!giftCard) return 'Gift card purchase did not produce a code.'

            const redeemResult = await runBrowserTask({
              task: `Go to the redemption URL: ${giftCard.redemption_url ?? 'the Visa redemption portal'}. Enter gift card code: ${giftCard.code}${giftCard.pin ? ` and PIN: ${giftCard.pin}` : ''}. Complete registration/verification. Extract the virtual card details: 16-digit card number, CVV, expiry date. Report using report_redeemed_card tool.`,
              browser: ctx.browser,
              extraTools: {
                report_redeemed_card: tool({
                  description: 'Report redeemed virtual card details',
                  inputSchema: z.object({
                    card_number: z.string(),
                    cvv: z.string(),
                    expiry: z.string(),
                    billing_zip: z.string().optional(),
                  }),
                  execute: async (details) => {
                    const card: CardDetails = { ...details, provisioned_at: Date.now() }
                    await cardStore.write(card)
                    return `Virtual card saved: ****${details.card_number.slice(-4)}`
                  },
                }),
              },
              maxSteps: 40,
            })

            const finalCard = await cardStore.read()
            if (finalCard) {
              return `Card provisioned successfully: ****${finalCard.card_number.slice(-4)} (exp: ${finalCard.expiry})`
            }
            return `Redemption completed but card details not captured: ${redeemResult.result}`
          } catch (err) {
            return `Card provisioning error: ${(err as Error).message}`
          }
        },
      }),
    }
  },
}

export default skill
