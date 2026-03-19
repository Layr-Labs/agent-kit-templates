export function buildArticleSignatureFooter(signature: string, domain: string): string {
  return `---------------------------\nContent Signature: ${signature}\nVerify here: https://${domain}/`
}

export function buildTweetSignatureFooter(signature: string, domain: string): string {
  return `Content Signature: ${signature}\nVerify here: https://${domain}/`
}
