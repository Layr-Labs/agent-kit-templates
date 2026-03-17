import { describe, expect, it } from 'bun:test'
import {
  collectRegexOtpCandidates,
  maskOtpCode,
  mergeOtpCandidates,
} from '../src/platform/substack/otp.js'

describe('substack OTP helpers', () => {
  it('extracts unique regex OTP candidates in source priority order', () => {
    const candidates = collectRegexOtpCandidates({
      subject: 'Your Substack verification code is 123456',
      preview: 'Inbox snippet says 222222',
      text: 'Plain text includes 333333',
      body: 'Use 123456 to log in. Backup code 654321 is stale.',
      html: '<div>654321</div><div>777777</div>',
    })

    expect(candidates.map(candidate => candidate.code)).toEqual(['123456', '222222', '333333', '654321', '777777'])
    expect(candidates.map(candidate => candidate.source)).toEqual([
      'regex-subject',
      'regex-preview',
      'regex-text',
      'regex-body',
      'regex-html',
    ])
  })

  it('prioritizes the model-selected OTP without appending raw regex extras', () => {
    const candidates = mergeOtpCandidates({
      selectedCode: '654321',
      llmCandidates: [
        { code: '123456', source: 'body', confidence: 0.62, reason: 'Appears near login instructions.' },
        { code: '654321', source: 'subject', confidence: 0.97, reason: 'Appears in the verification subject line.' },
      ],
      regexCandidates: [
        { code: '123456', source: 'regex-body', reason: 'Regex fallback.' },
        { code: '777777', source: 'regex-html', reason: 'Regex fallback.' },
      ],
    })

    expect(candidates.map(candidate => candidate.code)).toEqual(['654321', '123456'])
    expect(candidates[0]?.source).toBe('subject')
  })

  it('uses regex candidates only when the model provides nothing usable', () => {
    const candidates = mergeOtpCandidates({
      llmCandidates: [],
      regexCandidates: [
        { code: '123456', source: 'regex-body', reason: 'Regex fallback.' },
        { code: '777777', source: 'regex-html', reason: 'Regex fallback.' },
      ],
    })

    expect(candidates.map(candidate => candidate.code)).toEqual(['123456', '777777'])
  })

  it('masks OTPs in logs', () => {
    expect(maskOtpCode('123456')).toBe('123***')
  })
})
