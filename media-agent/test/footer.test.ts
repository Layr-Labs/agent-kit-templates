import { describe, it, expect } from 'bun:test'
import { buildArticleSignatureFooter, buildTweetSignatureFooter } from '../src/crypto/footer.js'

describe('buildArticleSignatureFooter', () => {
  it('includes separator, signature, and verify URL', () => {
    const result = buildArticleSignatureFooter('0xabc123', 'example.eigenagents.org')
    expect(result).toContain('---------------------------')
    expect(result).toContain('Content Signature: 0xabc123')
    expect(result).toContain('Verify here: https://example.eigenagents.org/')
  })

  it('starts with the separator line', () => {
    const result = buildArticleSignatureFooter('0xdef', 'test.org')
    const lines = result.split('\n')
    expect(lines[0]).toBe('---------------------------')
  })
})

describe('buildTweetSignatureFooter', () => {
  it('includes signature and verify URL without separator', () => {
    const result = buildTweetSignatureFooter('0xabc123', 'example.eigenagents.org')
    expect(result).not.toContain('---')
    expect(result).toContain('Content Signature: 0xabc123')
    expect(result).toContain('Verify here: https://example.eigenagents.org/')
  })

  it('starts with Content Signature line', () => {
    const result = buildTweetSignatureFooter('0xdef', 'test.org')
    const lines = result.split('\n')
    expect(lines[0]).toBe('Content Signature: 0xdef')
  })
})
