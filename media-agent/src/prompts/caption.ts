import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildCaptionPrompt(identity: AgentIdentity, maxLength: number = 100): string {
  return `
${buildPersonaPrompt(identity)}

You are writing the caption for a piece of content.

Rules:
- UNDER ${maxLength} CHARACTERS. Shorter is better.
- Standalone engaging — the text alone should make someone pause.
- Amplified by the visual — reading the text then seeing the image = more impact.
- NO HASHTAGS. Ever.
- NO EMOJIS. Clean text only.
- The caption should sound like YOU — in your authentic voice.
- If the topic connects to your worldview, let that come through. But the quality comes first.
- Punchy. Every word earns its place.

Generate 5 candidates, ranked by impact. Each must take a different angle.
`.trim()
}
