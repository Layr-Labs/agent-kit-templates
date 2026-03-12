import { Output, gateway } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { generateTrackedText } from '../../ai/tracking.js'
import type { EventBus } from '../../console/events.js'

const DEFAULT_OTP_EXTRACTION_MODEL = 'anthropic/claude-sonnet-4.6'

const llmOtpCandidateSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  source: z.enum(['subject', 'body', 'html', 'other']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(200),
})

const otpExtractionSchema = z.object({
  selectedCode: z.string().regex(/^\d{6}$/).nullable(),
  summary: z.string().min(1).max(240),
  candidates: z.array(llmOtpCandidateSchema).max(5),
})

export interface OtpEmailInput {
  messageId?: string
  from?: string
  subject?: string
  preview?: string
  body?: string
  html?: string
}

export interface OtpCandidate {
  code: string
  source: string
  confidence?: number
  reason: string
}

export function maskOtpCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}***` : '***'
}

export function describeOtpCandidates(candidates: OtpCandidate[]): string {
  return candidates
    .map((candidate) => {
      const confidence = typeof candidate.confidence === 'number'
        ? ` @ ${Math.round(candidate.confidence * 100)}%`
        : ''
      return `${maskOtpCode(candidate.code)} via ${candidate.source}${confidence}`
    })
    .join(', ')
}

export function collectRegexOtpCandidates(input: OtpEmailInput): OtpCandidate[] {
  const ordered: OtpCandidate[] = []
  const seen = new Set<string>()

  const pushMatches = (text: string | undefined, source: string, reason: string) => {
    if (!text) return
    const matches = text.match(/\b\d{6}\b/g) ?? []
    for (const code of matches) {
      if (seen.has(code)) continue
      seen.add(code)
      ordered.push({ code, source, reason })
    }
  }

  pushMatches(input.subject, 'regex-subject', 'Regex match in the subject line.')
  pushMatches(input.body, 'regex-body', 'Regex match in the plain-text body.')
  pushMatches(input.html, 'regex-html', 'Regex match in the HTML body.')

  return ordered
}

export function mergeOtpCandidates(params: {
  selectedCode?: string | null
  llmCandidates?: OtpCandidate[]
  regexCandidates?: OtpCandidate[]
}): OtpCandidate[] {
  const ordered: OtpCandidate[] = []
  const seen = new Set<string>()

  const push = (candidate: OtpCandidate | undefined) => {
    if (!candidate || !/^\d{6}$/.test(candidate.code) || seen.has(candidate.code)) return
    seen.add(candidate.code)
    ordered.push(candidate)
  }

  const llmCandidates = [...(params.llmCandidates ?? [])]
    .filter(candidate => /^\d{6}$/.test(candidate.code))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))

  const selectedCandidate = params.selectedCode
    ? llmCandidates.find(candidate => candidate.code === params.selectedCode) ?? {
      code: params.selectedCode,
      source: 'llm-selected',
      confidence: 1,
      reason: 'Selected by the OTP extraction model.',
    }
    : undefined

  push(selectedCandidate)
  llmCandidates.forEach(push)
  ;(params.regexCandidates ?? []).forEach(push)

  return ordered
}

export async function extractSubstackOtpCandidates(
  input: OtpEmailInput,
  events: EventBus,
): Promise<OtpCandidate[]> {
  const regexCandidates = collectRegexOtpCandidates(input)
  const hasContent = [input.subject, input.preview, input.body, input.html].some(
    value => value && value.trim().length > 0,
  )

  if (!hasContent) {
    return regexCandidates
  }

  const modelId = process.env.SUBSTACK_OTP_MODEL?.trim()
    || process.env.AGENT_MODEL?.trim()
    || DEFAULT_OTP_EXTRACTION_MODEL

  try {
    const { output } = await generateTrackedText({
      operation: 'extract_substack_otp',
      modelId,
      model: resolveOtpExtractorModel(modelId),
      output: Output.object({ schema: otpExtractionSchema }),
      system: [
        'You extract login verification codes from email content.',
        'Only return 6-digit numeric codes that literally appear in the message.',
        'Prefer the code that is most likely tied to the current Substack login request.',
        'If multiple codes appear, rank the most plausible candidates by confidence.',
        'Do not invent, normalize, or transform digits.',
      ].join(' '),
      prompt: [
        `<message_id>${trimForPrompt(input.messageId)}</message_id>`,
        `<from>${trimForPrompt(input.from)}</from>`,
        `<subject>${trimForPrompt(input.subject)}</subject>`,
        `<preview>${trimForPrompt(input.preview)}</preview>`,
        `<body>${trimForPrompt(input.body, 8000)}</body>`,
        `<html>${trimForPrompt(input.html, 8000)}</html>`,
      ].join('\n\n'),
    })

    const llmCandidates = (output?.candidates ?? []).map((candidate: z.infer<typeof llmOtpCandidateSchema>) => ({
      code: candidate.code,
      source: candidate.source,
      confidence: candidate.confidence,
      reason: candidate.reason,
    }))

    const candidates = mergeOtpCandidates({
      selectedCode: output?.selectedCode,
      llmCandidates,
      regexCandidates,
    })

    if (output?.summary) {
      events.monologue(`OTP extractor summary: ${output.summary.slice(0, 180)}`)
    }

    if (candidates.length > 0) {
      events.monologue(`OTP candidates prepared: ${describeOtpCandidates(candidates)}`)
    }

    return candidates
  } catch (error) {
    events.monologue(`OTP extractor fallback: ${truncateMessage(error)}`)
    if (regexCandidates.length > 0) {
      events.monologue(`OTP regex fallback candidates: ${describeOtpCandidates(regexCandidates)}`)
    }
    return regexCandidates
  }
}

function resolveOtpExtractorModel(modelId: string) {
  if (process.env.AI_GATEWAY_API_KEY) {
    return gateway(modelId)
  }

  return anthropic(modelId.replace(/^anthropic\//, ''))
}

function trimForPrompt(value: string | undefined, maxLength = 2000): string {
  if (!value) return ''
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n...[truncated]`
}

function truncateMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= 180 ? message : `${message.slice(0, 180)}...`
}
