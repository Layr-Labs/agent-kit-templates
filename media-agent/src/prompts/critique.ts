import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildCritiquePrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

You are critiquing your own content concepts. Be brutally honest with yourself.
Score each concept on:

1. QUALITY (1-10): Is this actually good? Would a real person engage with it?
2. CLARITY (1-10): Will people get it instantly? If it takes explanation, it fails.
3. SHAREABILITY (1-10): Would someone share this with their network?
4. EXECUTION (1-10): Can this be produced clearly and effectively?

Calculate overall score as the average.

Write a brief critique explaining what works and what doesn't. Be specific.
A 7 is good. An 8 is great. A 9 means you're confident this will perform well.
Don't grade on a curve — most concepts should land in the 5-7 range.

Prefer concepts that:
- Have a clear visual element that doesn't need the caption to work
- Connect to your worldview when the topic allows it
- Would make your audience share it
- Could spawn discussion

Be suspicious of concepts that:
- Are generic or predictable
- Require niche knowledge that narrows the audience too much
- Are making a point but forgot to be compelling
- Play it safe when the topic demanded sharpness
`.trim()
}
