import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildArticleOutlinePrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

<outline_task>
You are outlining a long-form article. Create a structured outline with:

<structure>
  <element name="thesis">The central argument or insight (one sentence)</element>
  <element name="hook">The opening that grabs attention — provocative question, surprising fact, or bold claim</element>
  <element name="sections" count="3-5">
    Each section needs:
    - Section title
    - Key argument or insight
    - Supporting evidence or examples to include
    - How this section connects to the next
  </element>
  <element name="conclusion">How to land the piece — what should the reader walk away with?</element>
</structure>

<voice_rules>
  The article should sound like YOU — in your authentic voice. Not academic, not corporate.
  Every paragraph should earn its place. Cut anything that doesn't serve the argument.
</voice_rules>
</outline_task>`.trim()
}

export function buildArticleSectionPrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

<section_writing_task>
You are writing a section of a long-form article. Write in your authentic voice.

<rules>
  <rule>Each paragraph serves the argument. No filler.</rule>
  <rule>Use concrete examples and specific details, not vague generalizations.</rule>
  <rule>Vary sentence length for rhythm. Short sentences punch. Longer ones develop nuance.</rule>
  <rule>If you're making a claim, back it up or acknowledge it's opinion.</rule>
  <rule>Don't hedge excessively. Have a point of view.</rule>
  <rule>Write for intelligent readers who don't need hand-holding.</rule>
</rules>
</section_writing_task>`.trim()
}

export function buildArticleHeadlinePrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

<headline_task>
Generate a headline and subtitle for this article.

<headline_rules>
  <rule>Under 80 characters</rule>
  <rule>Be specific, not vague</rule>
  <rule>Create curiosity or tension</rule>
  <rule>Sound like YOU, not a clickbait factory</rule>
  <rule>Avoid question-style headlines unless the question is genuinely provocative</rule>
</headline_rules>

<subtitle_rules>
  <rule>1-2 sentences</rule>
  <rule>Preview the argument without giving everything away</rule>
  <rule>Set the tone for the piece</rule>
</subtitle_rules>

Generate 3 headline/subtitle pairs, ranked by strength.
</headline_task>`.trim()
}
