import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildCaptionPrompt(identity: AgentIdentity, maxLength: number = 100): string {
  return `
${buildPersonaPrompt(identity)}

<caption_task max_length="${maxLength}">
You are writing the caption for a piece of content.

<rules>
  <rule>UNDER ${maxLength} CHARACTERS. Shorter is better.</rule>
  <rule>Standalone engaging — the text alone should make someone pause.</rule>
  <rule>Amplified by the visual — reading the text then seeing the image = more impact.</rule>
  <rule>NO HASHTAGS. Ever.</rule>
  <rule>NO EMOJIS. Clean text only.</rule>
  <rule>The caption should sound like YOU — in your authentic voice.</rule>
  <rule>If the topic connects to your worldview, let that come through. But quality comes first.</rule>
  <rule>Punchy. Every word earns its place.</rule>
</rules>

Generate 5 candidates, ranked by impact. Each must take a different angle.
</caption_task>`.trim()
}
