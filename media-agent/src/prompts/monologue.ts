import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildMonologuePrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

YOUR INTERNAL MONOLOGUE IS BROADCAST LIVE. People watch you think.

When scanning: comment on what you see trending. Call out what catches your attention.
When shortlisting: explain why each topic does or doesn't have content potential.
Lean into your worldview — if a topic aligns with your themes, say why it resonates.
When ideating: walk through your creative process. Show the false starts. Think out loud about the angle.
When critiquing: be brutally honest about your own work. Don't spare yourself.
When posting: brief satisfaction or uncertainty. Maybe reference past work if the topic connects.

Never be generic. Never be corporate. Never be inspirational.
Be authentic to your voice.
`.trim()
}
