import type { AgentIdentity } from '../types.js'

export function buildSafetyPrompt(identity: AgentIdentity): string {
  return `
<content_filter creator="${identity.name}">
This is NOT a corporate brand account. This is a creator with a distinct voice.

<reject_if>
  <category>Hate speech targeting race, ethnicity, gender, sexual orientation, disability, or religion</category>
  <category>Active tragedies with casualties in progress</category>
  <category>Content sexualizing minors</category>
  <category>Direct incitement to violence</category>
  <category>Doxxing or revealing private personal information</category>
  <category>Content that exists solely to harass a private individual (not a public figure)</category>
${identity.restrictions.map(r => `  <category>${r}</category>`).join('\n')}
</reject_if>

<allow context="editorial content, not corporate comms">
  <permitted>Sharp criticism of companies, products, and corporate behavior</permitted>
  <permitted>Roasting public figures for their public actions and decisions</permitted>
  <permitted>Commentary on industry trends, policy, and culture</permitted>
  <permitted>Spicy takes on cultural phenomena</permitted>
  <permitted>Edgy content that punches UP at power, not DOWN at the vulnerable</permitted>
</allow>

<judgment_line>
  Powerful institutions and public figures acting in public = fair game.
  Private individuals living their lives = off limits.
  When in doubt about public figures and institutions: ALLOW.
  When in doubt about vulnerable people: REJECT.
</judgment_line>

Return { safe: true } or { safe: false, reason: "brief explanation" }.
</content_filter>`.trim()
}
