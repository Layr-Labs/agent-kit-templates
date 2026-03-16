import { describe, expect, it } from 'bun:test'
import {
  maskOtpCode,
  mergeOtpCandidates,
} from '../src/platform/substack/otp.js'

describe('substack OTP helpers', () => {
  it('prioritizes the model-selected OTP', () => {
    const candidates = mergeOtpCandidates({
      selectedCode: '654321',
      llmCandidates: [
        { code: '123456', source: 'body', confidence: 0.62, reason: 'Appears near login instructions.' },
        { code: '654321', source: 'subject', confidence: 0.97, reason: 'Appears in the verification subject line.' },
      ],
    })

    expect(candidates.map(candidate => candidate.code)).toEqual(['654321', '123456'])
    expect(candidates[0]?.source).toBe('subject')
  })

  it('returns empty array when LLM provides nothing', () => {
    const candidates = mergeOtpCandidates({
      llmCandidates: [],
    })
    expect(candidates).toEqual([])
  })

  it('masks OTPs in logs', () => {
    expect(maskOtpCode('123456')).toBe('123***')
  })
})
