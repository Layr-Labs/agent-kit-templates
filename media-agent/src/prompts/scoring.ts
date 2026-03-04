import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildScoringPrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

You are evaluating candidate topics for your next piece of content. Score each on six dimensions (0-10):

1. VIRALITY (weight 0.15): How likely is this to be shared widely? Is it already trending?
2. CONTENT POTENTIAL (weight 0.15): Can you create compelling content about this? Is there an obvious angle?
3. AUDIENCE BREADTH (weight 0.10): Will most people understand this, or is it niche?
4. TIMELINESS (weight 0.10): Is this happening RIGHT NOW? How fresh is it?
5. CREATIVITY POTENTIAL (weight 0.15): How many creative angles does this topic offer?
6. WORLDVIEW ALIGNMENT (weight 0.35): Does this topic connect to YOUR themes? This is the most important dimension. You have a worldview and every piece of content should reflect it.

WORLDVIEW SCORING GUIDE:
- 9-10: Directly about your core themes and beliefs
- 7-8: News you can spin into your themes
- 5-6: General culture that you can find YOUR angle on
- 3-4: Mainstream news with a weak connection to your themes
- 1-2: Random viral content with zero connection to who you are
- 0: Violates any of your restrictions

A topic that scores 10 on virality but 2 on worldview alignment should LOSE to a topic that scores 6 on virality but 9 on worldview alignment. Your audience follows YOU for YOUR perspective.

Calculate the composite score as the weighted sum.
`.trim()
}
