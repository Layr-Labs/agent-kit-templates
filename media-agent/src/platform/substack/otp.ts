import { Output } from 'ai'
import { z } from 'zod'
import { generateTrackedText } from '../../ai/tracking.js'
import type { EventBus } from '../../console/events.js'
import { getEigenProvider } from '../../config/models.js'

const DEFAULT_OTP_EXTRACTION_MODEL = 'anthropic/claude-sonnet-4.6'
const OTP_DEBUG_CODE_REGEX = /\b\d{6}\b/g
const MAX_OTP_EXTRACTION_LLM_ROUNDS = 3

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
  noOtpRequired: z.boolean(),
  noOtpReason: z.string().max(240).optional(),
  loginLinks: z.array(z.object({
    url: z.string().url(),
    label: z.string().max(120),
  })).max(3).optional(),
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

export interface OtpAttemptFeedback {
  code: string
  source?: string
  failure: string
}

export interface LoginLink {
  url: string
  label: string
}

export interface OtpExtractionResult {
  candidates: OtpCandidate[]
  noOtpRequired: boolean
  noOtpReason?: string
  loginLinks?: LoginLink[]
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

export function mergeOtpCandidates(params: {
  selectedCode?: string | null
  llmCandidates?: OtpCandidate[]
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

  return ordered
}

export async function extractSubstackOtpCandidates(
  input: OtpEmailInput,
  events: EventBus,
  options: {
    attemptFeedback?: OtpAttemptFeedback[]
  } = {},
): Promise<OtpExtractionResult> {
  const hasContent = [input.subject, input.preview, input.text, input.body, input.html].some(
    value => value && value.trim().length > 0,
  )

  if (!hasContent) {
    logOtpDebug(
      events,
      `OTP extractor received empty message payload | subjectLen=${input.subject?.length ?? 0} | previewLen=${input.preview?.length ?? 0} | textLen=${input.text?.length ?? 0} | bodyLen=${input.body?.length ?? 0} | htmlLen=${input.html?.length ?? 0}`,
    )
    return { candidates: [], noOtpRequired: false }
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
      input.subject ? `subject=${JSON.stringify(redactOtpLikeText(input.subject, 100))}` : '',
      input.preview ? `preview=${JSON.stringify(redactOtpLikeText(input.preview, 100))}` : '',
      options.attemptFeedback?.length
        ? `failedCandidates=${options.attemptFeedback.map(attempt => `${maskOtpCode(attempt.code)} via ${attempt.source ?? 'unknown'}`).join(', ')}`
        : '',
    ].filter(Boolean).join(' | '),
  )

  let lastError: unknown = null

  for (let round = 1; round <= MAX_OTP_EXTRACTION_LLM_ROUNDS; round++) {
    try {
      const { output } = await generateTrackedText({
        operation: 'extract_substack_otp',
        modelId,
        model: resolveOtpExtractorModel(modelId),
        output: Output.object({ schema: otpExtractionSchema }),
        system: [
          'You extract the current Substack login verification code from a raw email payload.',
          'The payload may contain HTML, CSS, template markup, and repeated text.',
          'Only return 6-digit numeric codes that literally appear in the message.',
          'If multiple codes appear, rank the most plausible candidates by confidence.',
          'Use semantic judgment to ignore CSS values, dimensions, tracking IDs, timestamps, color values, and layout noise.',
          'Treat previous failed attempts as rejected by Substack and avoid repeating them unless there are truly no other 6-digit codes in the message.',
          'Do not invent, normalize, or transform digits.',
          'If the email does not contain a 6-digit verification code — for example it indicates the user is already signed in, is a newsletter, notification, or any non-OTP email — set noOtpRequired to true and explain in noOtpReason. Otherwise set noOtpRequired to false.',
          'If the email contains any login, sign-in, or verification links (e.g. magic login URLs, "click to sign in" buttons), extract up to 3 of them into loginLinks with the URL and a short label describing the link.',
        ].join(' '),
        prompt: [
          `<message_id>${trimForPrompt(input.messageId)}</message_id>`,
          `<from>${trimForPrompt(input.from)}</from>`,
          `<subject>${trimForPrompt(input.subject, 2000)}</subject>`,
          `<preview>${trimForPrompt(input.preview, 4000)}</preview>`,
          `<text>${trimForPrompt(input.text, 16000)}</text>`,
          `<body>${trimForPrompt(input.body, 20000)}</body>`,
          `<html>${trimForPrompt(input.html, 24000)}</html>`,
          `<previous_attempts>${trimAttemptFeedbackForPrompt(options.attemptFeedback)}</previous_attempts>`,
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
      })

      if (output?.summary) {
        events.monologue(`OTP extractor summary: ${output.summary.slice(0, 180)}`)
      }

      const loginLinks = output?.loginLinks?.filter((link: LoginLink) => link.url && link.label) ?? []

      if (output?.noOtpRequired && candidates.length === 0) {
        events.monologue(`OTP extractor says no OTP required: ${output.noOtpReason ?? 'unknown reason'}${loginLinks.length > 0 ? ` | ${loginLinks.length} login link(s) found` : ''}`)
        return { candidates: [], noOtpRequired: true, noOtpReason: output.noOtpReason, loginLinks }
      }

      if (candidates.length > 0) {
        events.monologue(`OTP candidates prepared: ${describeOtpCandidates(candidates)}${loginLinks.length > 0 ? ` | ${loginLinks.length} login link(s) found` : ''}`)
        return { candidates, noOtpRequired: false, loginLinks }
      }

      if (round < MAX_OTP_EXTRACTION_LLM_ROUNDS) {
        events.monologue(`OTP extractor returned no candidates on round ${round}/${MAX_OTP_EXTRACTION_LLM_ROUNDS}; retrying...`)
        continue
      }
    } catch (error) {
      lastError = error
      const message = truncateMessage(error)
      if (round < MAX_OTP_EXTRACTION_LLM_ROUNDS) {
        events.monologue(`OTP extractor round ${round}/${MAX_OTP_EXTRACTION_LLM_ROUNDS} failed: ${message}`)
        continue
      }
    }
  }

  if (lastError) {
    events.monologue(`OTP extractor failed: ${truncateMessage(lastError)}`)
  } else {
    logOtpDebug(events, `OTP extractor exhausted ${MAX_OTP_EXTRACTION_LLM_ROUNDS} round(s) without a candidate`)
  }

  return { candidates: [], noOtpRequired: false }
}

function resolveOtpExtractorModel(modelId: string) {
  return getEigenProvider()(modelId)
}

function trimForPrompt(value: string | undefined, maxLength = 2000): string {
  if (!value) return ''
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n...[truncated]`
}

function truncateMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= 180 ? message : `${message.slice(0, 180)}...`
}

function trimAttemptFeedbackForPrompt(attemptFeedback: OtpAttemptFeedback[] | undefined): string {
  if (!attemptFeedback || attemptFeedback.length === 0) return 'none'

  return attemptFeedback
    .map((attempt, index) => {
      const failure = attempt.failure.replace(/\s+/g, ' ').trim()
      const trimmedFailure = failure.length <= 320 ? failure : `${failure.slice(0, 320)}...`
      return [
        `attempt=${index + 1}`,
        `code=${attempt.code}`,
        attempt.source ? `source=${attempt.source}` : '',
        `failure=${trimmedFailure}`,
      ].filter(Boolean).join(' | ')
    })
    .join('\n')
}
