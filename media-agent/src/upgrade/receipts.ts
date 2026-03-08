import { createHash } from 'crypto'
import { JsonStore } from '../store/json-store.js'
import type { UpgradeEnvelope } from './auth.js'

export interface UpgradeConsentReceipt {
  proposalId: string
  payloadHash: string
  approvedAt: number
  expiresAt: number
  usedAt?: number
  usedBy?: string
}

type ReceiptStore = Record<string, UpgradeConsentReceipt>

const RECEIPT_TTL_MS = 10 * 60 * 1000

export function getUpgradeReceiptStorePath(dataDir: string): string {
  return `${dataDir}/upgrade-consents.json`
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function buildUpgradePayloadHash(payload: UpgradeEnvelope): string {
  return createHash('sha256')
    .update(stableStringify(payload))
    .digest('hex')
}

async function pruneReceipts(store: JsonStore<ReceiptStore>): Promise<ReceiptStore> {
  const now = Date.now()
  return store.update((current) => {
    const next: ReceiptStore = {}
    for (const [proposalId, receipt] of Object.entries(current ?? {})) {
      if (receipt.expiresAt > now) {
        next[proposalId] = receipt
      }
    }
    return next
  }, {})
}

export async function recordApprovedReceipt(dataDir: string, payload: UpgradeEnvelope): Promise<UpgradeConsentReceipt> {
  const store = new JsonStore<ReceiptStore>(getUpgradeReceiptStorePath(dataDir))
  const receipts = await pruneReceipts(store)

  const receipt: UpgradeConsentReceipt = {
    proposalId: payload.id,
    payloadHash: buildUpgradePayloadHash(payload),
    approvedAt: Date.now(),
    expiresAt: Date.now() + RECEIPT_TTL_MS,
  }

  receipts[payload.id] = receipt
  await store.write(receipts)
  return receipt
}

export async function consumeApprovedReceipt(params: {
  dataDir: string
  payload: UpgradeEnvelope
  action: string
}): Promise<{ ok: true; receipt: UpgradeConsentReceipt } | { ok: false; error: string }> {
  const store = new JsonStore<ReceiptStore>(getUpgradeReceiptStorePath(params.dataDir))
  const receipts = await pruneReceipts(store)
  const receipt = receipts[params.payload.id]

  if (!receipt) {
    return { ok: false, error: `No approved consent receipt found for proposal ${params.payload.id}.` }
  }
  if (receipt.usedAt) {
    return { ok: false, error: `Consent receipt for proposal ${params.payload.id} was already used by ${receipt.usedBy ?? 'another action'}.` }
  }

  const payloadHash = buildUpgradePayloadHash(params.payload)
  if (receipt.payloadHash !== payloadHash) {
    return { ok: false, error: `Consent receipt for proposal ${params.payload.id} does not match this upgrade payload.` }
  }

  const nextReceipt: UpgradeConsentReceipt = {
    ...receipt,
    usedAt: Date.now(),
    usedBy: params.action,
  }

  receipts[params.payload.id] = nextReceipt
  await store.write(receipts)
  return { ok: true, receipt: nextReceipt }
}
