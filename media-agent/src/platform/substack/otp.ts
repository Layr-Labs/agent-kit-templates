import { Output } from 'ai'
import { z } from 'zod'
import { generateTrackedText } from '../../ai/tracking.js'
import type { EventBus } from '../../console/events.js'
import { getGatewayProvider } from '../../config/models.js'

const DEFAULT_OTP_EXTRACTION_MODEL = 'anthropic/claude-sonnet-4.6'
const OTP_DEBUG_CODE_REGEX = /\b\d{6}\b/g

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
  text?: string
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

function isSubstackLoginDebugEnabled(): boolean {
  const raw = process.env.SUBSTACK_LOGIN_DEBUG?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function logOtpDebug(events: EventBus, message: string): void {
  if (!isSubstackLoginDebugEnabled()) return
  events.monologue(`[substack-debug] ${message}`)
}

function redactOtpLikeText(value: string | undefined, maxLength = 120): string {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  const redacted = compact.replace(OTP_DEBUG_CODE_REGEX, (match) => maskOtpCode(match))
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}...`
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

export function findOtpCodesInText(text: string | undefined): string[] {
  if (!text) return []
  return text.match(/\b\d{6}\b/g) ?? []
}

export function collectRegexOtpCandidates(input: OtpEmailInput): OtpCandidate[] {
  const ordered: OtpCandidate[] = []
  const seen = new Set<string>()

  const pushMatches = (text: string | undefined, source: string, reason: string) => {
    if (!text) return
    const matches = findOtpCodesInText(text)
    for (const code of matches) {
      if (seen.has(code)) continue
      seen.add(code)
      ordered.push({ code, source, reason })
    }
  }

  pushMatches(input.subject, 'regex-subject', 'Regex match in the subject line.')
  pushMatches(input.preview, 'regex-preview', 'Regex match in the inbox preview/snippet.')
  pushMatches(input.text, 'regex-text', 'Regex match in the plain-text message.')
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
  const hasContent = [input.subject, input.preview, input.text, input.body, input.html].some(
    value => value && value.trim().length > 0,
  )

  if (!hasContent) {
    logOtpDebug(
      events,
      `OTP extractor received empty message payload | subjectLen=${input.subject?.length ?? 0} | previewLen=${input.preview?.length ?? 0} | textLen=${input.text?.length ?? 0} | bodyLen=${input.body?.length ?? 0} | htmlLen=${input.html?.length ?? 0} | regexCandidates=${regexCandidates.length}`,
    )
    return regexCandidates
  }

  const modelId = process.env.SUBSTACK_OTP_MODEL?.trim()
    || process.env.AGENT_MODEL?.trim()
    || DEFAULT_OTP_EXTRACTION_MODEL

  logOtpDebug(
    events,
    [
      `OTP extractor input | model=${modelId}`,
      `subjectLen=${input.subject?.length ?? 0}`,
      `previewLen=${input.preview?.length ?? 0}`,
      `textLen=${input.text?.length ?? 0}`,
      `bodyLen=${input.body?.length ?? 0}`,
      `htmlLen=${input.html?.length ?? 0}`,
      `regexCandidates=${regexCandidates.length}`,
      input.subject ? `subject=${JSON.stringify(redactOtpLikeText(input.subject, 100))}` : '',
      input.preview ? `preview=${JSON.stringify(redactOtpLikeText(input.preview, 100))}` : '',
    ].filter(Boolean).join(' | '),
  )

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
        `<text>${trimForPrompt(input.text, 8000)}</text>`,
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
    } else {
      logOtpDebug(events, `OTP extractor returned no candidates | regexCandidates=${regexCandidates.length}`)
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
  return getGatewayProvider()(modelId)
}

function trimForPrompt(value: string | undefined, maxLength = 2000): string {
  if (!value) return ''
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n...[truncated]`
}

function truncateMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= 180 ? message : `${message.slice(0, 180)}...`
}
