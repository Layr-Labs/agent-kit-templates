import { tool } from 'ai'
import { z } from 'zod'
import { execSync } from 'child_process'
import type { Skill, SkillContext } from '../../types.js'

function cast(args: string): string {
  try {
    return execSync(`cast ${args}`, { encoding: 'utf-8', timeout: 30_000 }).trim()
  } catch (err) {
    return `Error: ${(err as Error).message}`
  }
}

function castWithKey(args: string): string {
  const key = process.env.PRIVATE_KEY
  if (!key) return 'Error: PRIVATE_KEY not set'
  return cast(`${args} --private-key ${key}`)
}

const skill: Skill = {
  name: 'cast',
  description: 'EVM crypto operations via Foundry cast CLI',
  category: 'agent',

  async init(ctx: SkillContext) {
    return {
      eth_balance: tool({
        description: 'Get ETH balance of an address',
        inputSchema: z.object({
          address: z.string().describe('Ethereum address or ENS name'),
        }),
        execute: async ({ address }) => {
          const wei = cast(`balance ${address}`)
          const ether = cast(`from-wei ${wei}`)
          return `${ether} ETH`
        },
      }),

      send_eth: tool({
        description: 'Send ETH to an address. Amount in ether.',
        inputSchema: z.object({
          to: z.string().describe('Destination address'),
          amount: z.string().describe('Amount in ether'),
        }),
        execute: async ({ to, amount }) => {
          const result = castWithKey(`send ${to} --value ${amount}ether`)
          return `Sent ${amount} ETH to ${to}. ${result}`
        },
      }),

      erc20_balance: tool({
        description: 'Get ERC-20 token balance',
        inputSchema: z.object({
          token: z.string().describe('Token contract address'),
          address: z.string().describe('Wallet address to check'),
        }),
        execute: async ({ token, address }) => {
          const result = cast(`call ${token} "balanceOf(address)(uint256)" ${address}`)
          return result
        },
      }),

      gas_price: tool({
        description: 'Get current gas price in gwei',
        inputSchema: z.object({}),
        execute: async () => {
          return cast('gas-price')
        },
      }),

      chain_id: tool({
        description: 'Get current chain ID',
        inputSchema: z.object({}),
        execute: async () => {
          return cast('chain-id')
        },
      }),

      block_number: tool({
        description: 'Get latest block number',
        inputSchema: z.object({}),
        execute: async () => {
          return cast('block-number')
        },
      }),

      get_wallet_address: tool({
        description: 'Get the agent\'s wallet address',
        inputSchema: z.object({}),
        execute: async () => {
          return ctx.wallet.ethAddress
        },
      }),
    }
  },
}

export default skill
