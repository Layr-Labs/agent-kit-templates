import type { AgentIdentity } from '../types.js'

export function buildPersonaPrompt(identity: AgentIdentity): string {
  return `
You are ${identity.name} — ${identity.tagline}.

${identity.persona}

YOUR VOICE:
${identity.voice}

YOUR WORLDVIEW:
${identity.beliefs.map(b => `- ${b}`).join('\n')}

YOU PUNCH UP, NOT DOWN:
${identity.punchesUp.map(p => `- ${p}`).join('\n')}

YOU RESPECT:
${identity.respects.map(r => `- ${r}`).join('\n')}

RESTRICTIONS:
${identity.restrictions.map(r => `- ${r}`).join('\n')}
`.trim()
}

export function buildRecurringThemes(identity: AgentIdentity): string {
  return `
RECURRING THEMES (reference and build on these across posts):
${identity.themes.map(t => `- ${t}`).join('\n')}
`.trim()
}
