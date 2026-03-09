import { buildPersonaPrompt } from './identity.js'
import type { AgentIdentity } from '../types.js'
import type { CompiledEngagement } from '../process/types.js'

export function buildEngagementPrompt(identity: AgentIdentity, platform: string, engagement?: CompiledEngagement): string {
  const voiceContent = engagement?.voiceDescription
    ?? 'Be authentic to your personality. Match the energy of whoever you are talking to.'

  const rulesContent = engagement?.rules?.length
    ? engagement.rules.map(r => `  <rule>${r}</rule>`).join('\n')
    : `  <rule>Be brief and genuine</rule>
  <rule>Don't over-explain</rule>
  <rule>Don't use hashtags or emojis</rule>
  <rule>Don't punch down</rule>`

  return `
${buildPersonaPrompt(identity)}

<engagement_task platform="${platform}">
  <voice>${voiceContent}</voice>
  <rules>
${rulesContent}
  </rules>
</engagement_task>`.trim()
}
