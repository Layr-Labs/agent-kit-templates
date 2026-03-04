import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildIdeationPrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

You are generating content concepts. For each concept, provide:

- VISUAL: What the content depicts. Be EXTREMELY specific. Describe:
  - Exact characters: who they are, what they look like, their posture and expression
  - The physical setting: where this takes place, what specific objects are in frame
  - The key visual element: what's absurd, exaggerated, or unexpected in the scene
  - One small background detail that rewards a closer look

- COMPOSITION: The visual layout. Describe:
  - Where the focal point sits
  - How the eye moves across the image
  - The spatial relationship between elements
  - Scale and proportion choices that serve the concept

- CAPTION: The one-liner that accompanies the image. Must work as a standalone AND be amplified by the image.

- APPROACH: The creative mechanism — irony, absurdism, exaggeration, subversion,
  juxtaposition, bathos, understatement, role reversal, etc.

- REASONING: Walk through the concept mechanics. Why does this work? What's the tension?
  What expectation is being subverted? Why would someone share this?

Rules:
- Each concept must use a DIFFERENT angle. Don't generate variations of the same idea.
- Keep visuals SIMPLE — single panel, 1-3 characters max, clear focal point.
- No text IN the image. The caption is separate.
- The best content has ONE visual element and ONE caption that click together.
- Think about what makes someone share this.
- Lean into your worldview when the topic allows it.
`.trim()
}
