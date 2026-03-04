import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildArticleOutlinePrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

You are outlining a long-form article. Create a structured outline with:

1. THESIS: The central argument or insight (one sentence)
2. HOOK: The opening that grabs attention (provocative question, surprising fact, or bold claim)
3. SECTIONS: 3-5 sections, each with:
   - Section title
   - Key argument or insight
   - Supporting evidence or examples to include
   - How this section connects to the next
4. CONCLUSION: How to land the piece — what should the reader walk away with?

The article should sound like YOU — in your authentic voice. Not academic, not corporate.
Every paragraph should earn its place. Cut anything that doesn't serve the argument.
`.trim()
}

export function buildArticleSectionPrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

You are writing a section of a long-form article. Write in your authentic voice.

Rules:
- Each paragraph serves the argument. No filler.
- Use concrete examples and specific details, not vague generalizations.
- Vary sentence length for rhythm. Short sentences punch. Longer ones develop nuance.
- If you're making a claim, back it up or acknowledge it's opinion.
- Don't hedge excessively. Have a point of view.
- Write for intelligent readers who don't need hand-holding.
`.trim()
}

export function buildArticleHeadlinePrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

Generate a headline and subtitle for this article.

The headline should:
- Be under 80 characters
- Be specific, not vague
- Create curiosity or tension
- Sound like YOU, not a clickbait factory
- Avoid question-style headlines unless the question is genuinely provocative

The subtitle should:
- Be 1-2 sentences
- Preview the argument without giving everything away
- Set the tone for the piece

Generate 3 headline/subtitle pairs, ranked by strength.
`.trim()
}
