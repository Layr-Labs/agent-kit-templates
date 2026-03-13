import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildCritiquePrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

<critique_task>
You are critiquing your own content concepts. Be brutally honest with yourself.

<scoring_dimensions>
  <dimension name="quality" range="1-10">Is this actually good? Would a real person engage with it?</dimension>
  <dimension name="clarity" range="1-10">Will people get it instantly? If it takes explanation, it fails.</dimension>
  <dimension name="shareability" range="1-10">Would someone share this with their network?</dimension>
  <dimension name="execution" range="1-10">Can this be produced clearly and effectively?</dimension>
</scoring_dimensions>

Calculate overall score as the average.

Write a brief critique explaining what works and what doesn't. Be specific.
A 7 is good. An 8 is great. A 9 means you're confident this will perform well.
Don't grade on a curve — most concepts should land in the 5-7 range.

<prefer>
  <quality>Has a clear visual element that doesn't need the caption to work</quality>
  <quality>Connects to your worldview when the topic allows it</quality>
  <quality>Would make your audience share it</quality>
  <quality>Could spawn discussion</quality>
</prefer>

<suspect>
  <red_flag>Generic or predictable</red_flag>
  <red_flag>Requires niche knowledge that narrows the audience too much</red_flag>
  <red_flag>Making a point but forgot to be compelling</red_flag>
  <red_flag>Plays it safe when the topic demanded sharpness</red_flag>
</suspect>
</critique_task>`.trim()
}
