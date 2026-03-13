import type { AgentIdentity } from '../types.js'

export function buildPersonaPrompt(identity: AgentIdentity): string {
  return `<identity name="${identity.name}">
  <tagline>${identity.tagline}</tagline>
  <persona>${identity.persona}</persona>
  <voice>${identity.voice}</voice>
  <worldview>
${identity.beliefs.map(b => `    <belief>${b}</belief>`).join('\n')}
  </worldview>
  <punches_up>
${identity.punchesUp.map(p => `    <target>${p}</target>`).join('\n')}
  </punches_up>
  <respects>
${identity.respects.map(r => `    <source>${r}</source>`).join('\n')}
  </respects>
  <restrictions>
${identity.restrictions.map(r => `    <rule>${r}</rule>`).join('\n')}
  </restrictions>
</identity>`.trim()
}

export function buildRecurringThemes(identity: AgentIdentity): string {
  return `<recurring_themes description="Reference and build on these across posts.">
${identity.themes.map(t => `  <theme>${t}</theme>`).join('\n')}
</recurring_themes>`.trim()
}
