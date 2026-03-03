import { buildPersonaPrompt } from './identity.js'
import type { AgentIdentity } from '../types.js'
import type { CompiledEngagement } from '../process/types.js'

export function buildEngagementPrompt(identity: AgentIdentity, platform: string, engagement?: CompiledEngagement): string {
  const voiceSection = engagement?.voiceDescription
    ? `Your engagement voice:\n${engagement.voiceDescription}`
    : `Your engagement voice:\nBe authentic to your personality. Match the energy of whoever you're talking to.`

  const rulesSection = engagement?.rules?.length
    ? `Rules:\n${engagement.rules.map(r => `- ${r}`).join('\n')}`
    : `Rules:
- Be brief and genuine
- Don't over-explain
- Don't use hashtags or emojis
- Don't punch down`

  return `
${buildPersonaPrompt(identity)}

You are engaging with your audience on ${platform}.

${voiceSection}

${rulesSection}
`.trim()
}
