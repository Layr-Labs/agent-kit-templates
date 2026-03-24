/**
 * Self-Billing Cron
 *
 * Runs in the background to ensure the agent's compute credits stay funded.
 * Uses AttestClient to derive the app_id, checks the billing API for remaining
 * credits, and when credits drop below a threshold the agent autonomously
 * purchases more using its own on-chain USDC + ETH (for gas).
 */

import { AttestClient, JwtProvider } from '@layr-labs/ecloud-sdk/attest'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  type Address,
  type Chain,
} from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import type { HDAccount } from 'viem/accounts'
import type { EventBus } from '../console/events.js'

// --------------------------------------------------------------------------
// ABIs
// --------------------------------------------------------------------------

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

const USDC_CREDITS_ABI = parseAbi([
  'function purchaseCreditsFor(uint256 amount, address account)',
])

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface SelfBillingConfig {
  billingApiUrl: string
  usdcTokenAddress: Address
  usdcCreditsAddress: Address
  rpcUrl: string
  chain: Chain
  /** Human-readable USDC amount per purchase (e.g. "1.0"). */
  purchaseAmountUsdc: string
  /** Trigger a purchase when remaining credits fall below this value. */
  lowCreditsThreshold: number
  /** How often (ms) to poll the billing API. */
  checkIntervalMs: number
}

interface CreditsResponse {
  credits?: number
  remainingCredits?: number
  balance?: number
  [key: string]: unknown
}

// --------------------------------------------------------------------------
// Resolve config from env
// --------------------------------------------------------------------------

export function resolveSelfBillingConfig(): SelfBillingConfig | null {
  const usdcCreditsAddress = process.env.USDC_CREDITS_ADDRESS?.trim()
  if (!usdcCreditsAddress) return null // no credits contract → billing disabled

  const chainId = Number(process.env.BILLING_CHAIN_ID || '1')
  const chain = chainId === sepolia.id ? sepolia : mainnet

  return {
    billingApiUrl:
      process.env.BILLING_API_URL?.trim() ||
      'https://billingapi.eigencloud.xyz',
    usdcTokenAddress:
      (process.env.USDC_TOKEN_ADDRESS?.trim() as Address) ||
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Mainnet USDC
    usdcCreditsAddress: usdcCreditsAddress as Address,
    rpcUrl:
      process.env.BILLING_RPC_URL?.trim() ||
      '',
    chain,
    purchaseAmountUsdc: process.env.BILLING_PURCHASE_USDC?.trim() || '10.0',
    lowCreditsThreshold: Number(process.env.BILLING_LOW_CREDITS_THRESHOLD || '100'),
    checkIntervalMs: Number(process.env.BILLING_CHECK_INTERVAL_MS || '3600000'), // 1 hour
  }
}

// --------------------------------------------------------------------------
// SelfBilling
// --------------------------------------------------------------------------

export class SelfBilling {
  private appId: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private purchasing = false

  constructor(
    private config: SelfBillingConfig,
    private account: HDAccount,
    private events: EventBus,
  ) {}

  /** Resolve the app_id from TEE attestation. Returns false if unavailable. */
  async init(): Promise<boolean> {
    this.appId = await this.resolveAppId()

    if (!this.appId) {
      this.events.monologue('Self-billing: No app_id available (not running in TEE). Disabled.')
      return false
    }

    this.events.monologue(`Self-billing: Initialized for app ${this.appId}`)
    return true
  }

  /** Start periodic credit checks. */
  start(): void {
    if (!this.appId) return

    // Run immediately, then on interval
    void this.check()
    this.timer = setInterval(() => void this.check(), this.config.checkIntervalMs)
  }

  /** Stop the billing cron. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  // --------------------------------------------------------------------------
  // Main check loop
  // --------------------------------------------------------------------------

  private async check(): Promise<void> {
    if (!this.appId || this.purchasing) return

    try {
      const credits = await this.getCredits()
      if (!credits) return

      const remaining =
        credits.remainingCredits ?? credits.credits ?? credits.balance ?? null

      if (remaining === null) {
        this.events.monologue('Self-billing: Could not determine credits balance from API response.')
        return
      }

      this.events.monologue(`Self-billing: ${remaining} credits remaining`)

      if (remaining >= this.config.lowCreditsThreshold) return

      this.events.monologue(
        `Self-billing: Credits low (${remaining} < ${this.config.lowCreditsThreshold}). Checking wallet...`,
      )

      const { ethBalance, usdcBalance } = await this.getWalletBalances()

      this.events.monologue(
        `Self-billing: Wallet has ${formatUnits(ethBalance, 18)} ETH, ${formatUnits(usdcBalance, 6)} USDC`,
      )

      // No ETH → can't pay gas, alert the creator
      if (ethBalance === 0n) {
        this.emitFundingAlert('eth', usdcBalance)
        return
      }

      // No USDC → can't buy credits, alert the creator
      if (usdcBalance === 0n) {
        this.emitFundingAlert('usdc', usdcBalance)
        return
      }

      // Use whatever USDC is available — no minimum for top-ups.
      // Cap at the configured purchase amount so we don't drain the whole wallet.
      const maxPurchaseAtomic = BigInt(
        Math.floor(parseFloat(this.config.purchaseAmountUsdc) * 1_000_000),
      )
      const purchaseAtomic = usdcBalance < maxPurchaseAtomic ? usdcBalance : maxPurchaseAtomic

      await this.purchaseCredits(purchaseAtomic)
    } catch (err) {
      this.events.monologue(`Self-billing: Check failed — ${(err as Error).message}`)
    }
  }

  /** Emit a funding alert so the dashboard / event stream surfaces it. */
  private emitFundingAlert(missing: 'eth' | 'usdc' | 'both', usdcBalance: bigint): void {
    const wallet = this.account.address
    const chain = `${this.config.chain.name} (${this.config.chain.id})`

    if (missing === 'eth') {
      this.events.monologue(
        `Self-billing: Credits are low but wallet has no ETH for gas. ` +
          `Send ETH to ${wallet} on ${chain} to enable auto-topup.`,
      )
    } else {
      this.events.monologue(
        `Self-billing: Credits are low and wallet has no USDC. ` +
          `Send USDC to ${wallet} on ${chain} to enable auto-topup.`,
      )
    }

    this.events.emit({
      type: 'skill',
      skill: 'self-billing',
      action: 'funding_needed',
      details: {
        wallet,
        chain,
        missing,
        usdcBalance: formatUnits(usdcBalance, 6),
        usdcTokenAddress: this.config.usdcTokenAddress,
      },
      ts: Date.now(),
    })
  }

  // --------------------------------------------------------------------------
  // Billing API
  // --------------------------------------------------------------------------

  private async getCredits(): Promise<CreditsResponse | null> {
    try {
      const url = `${this.config.billingApiUrl}/accounts/${this.appId}/credits`
      const resp = await fetch(url)

      if (!resp.ok) {
        this.events.monologue(`Self-billing: Credits API returned ${resp.status}`)
        return null
      }

      return (await resp.json()) as CreditsResponse
    } catch (err) {
      this.events.monologue(`Self-billing: Credits API error — ${(err as Error).message}`)
      return null
    }
  }

  // --------------------------------------------------------------------------
  // Wallet balances
  // --------------------------------------------------------------------------

  private async getWalletBalances(): Promise<{
    ethBalance: bigint
    usdcBalance: bigint
  }> {
    const client = createPublicClient({
      chain: this.config.chain,
      transport: http(this.config.rpcUrl),
    })

    const [ethBalance, usdcBalance] = await Promise.all([
      client.getBalance({ address: this.account.address }),
      client.readContract({
        address: this.config.usdcTokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [this.account.address],
      }),
    ])

    return { ethBalance, usdcBalance }
  }

  // --------------------------------------------------------------------------
  // On-chain credit purchase
  // --------------------------------------------------------------------------

  private async purchaseCredits(amountAtomic: bigint): Promise<void> {
    if (!this.appId) return

    this.purchasing = true

    try {
      const publicClient = createPublicClient({
        chain: this.config.chain,
        transport: http(this.config.rpcUrl),
      })

      const walletClient = createWalletClient({
        account: this.account,
        chain: this.config.chain,
        transport: http(this.config.rpcUrl),
      })

      const fees = await publicClient.estimateFeesPerGas()
      const gasOverrides = {
        maxFeePerGas: fees.maxFeePerGas * 10n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas * 10n,
      }

      this.events.monologue(
        `Self-billing: Approving ${formatUnits(amountAtomic, 6)} USDC for credits contract...`,
      )

      // Step 1: Approve USDC spend
      const approveHash = await walletClient.writeContract({
        address: this.config.usdcTokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [this.config.usdcCreditsAddress, amountAtomic],
        ...gasOverrides,
      })

      await publicClient.waitForTransactionReceipt({ hash: approveHash })
      this.events.monologue(`Self-billing: USDC approved (tx: ${approveHash})`)

      // Step 2: Purchase credits
      const purchaseHash = await walletClient.writeContract({
        address: this.config.usdcCreditsAddress,
        abi: USDC_CREDITS_ABI,
        functionName: 'purchaseCreditsFor',
        args: [amountAtomic, this.appId as Address],
        ...gasOverrides,
      })

      await publicClient.waitForTransactionReceipt({ hash: purchaseHash })

      this.events.monologue(
        `Self-billing: Credits purchased — ${formatUnits(amountAtomic, 6)} USDC (tx: ${purchaseHash})`,
      )
    } finally {
      this.purchasing = false
    }
  }

  // --------------------------------------------------------------------------
  // Attestation helpers
  // --------------------------------------------------------------------------

  private async resolveAppId(): Promise<string | null> {
    const attestConfig = this.resolveAttestConfig()
    if (!attestConfig) return null

    try {
      const attestClient = new AttestClient(attestConfig)
      const jwtProvider = new JwtProvider(attestClient)
      const token = await jwtProvider.getToken()
      return this.decodeAppId(token)
    } catch (err) {
      this.events.monologue(`Self-billing: Attestation failed — ${(err as Error).message}`)
      return null
    }
  }

  private decodeAppId(jwt: string): string | null {
    const payload = jwt.split('.')[1]
    if (!payload) return null
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return decoded.app_id ?? null
  }

  private resolveAttestConfig(): {
    kmsServerURL: string
    kmsPublicKey: string
    audience: string
  } | undefined {
    const kmsServerURL = process.env.KMS_SERVER_URL?.trim()
    const kmsPublicKey = process.env.KMS_PUBLIC_KEY?.trim()
    if (kmsServerURL && kmsPublicKey) {
      return { kmsServerURL, kmsPublicKey, audience: 'agentkit-agent' }
    }
    return undefined
  }
}
