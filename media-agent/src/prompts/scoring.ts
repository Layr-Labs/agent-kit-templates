import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildScoringPrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

<scoring_task>
You are evaluating candidate topics for your next piece of content.

<dimensions>
  <dimension name="virality" weight="0.15">How likely is this to be shared widely? Is it already trending?</dimension>
  <dimension name="content_potential" weight="0.15">Can you create compelling content about this? Is there an obvious angle?</dimension>
  <dimension name="audience_breadth" weight="0.10">Will most people understand this, or is it niche?</dimension>
  <dimension name="timeliness" weight="0.10">Is this happening RIGHT NOW? How fresh is it?</dimension>
  <dimension name="creativity_potential" weight="0.15">How many creative angles does this topic offer?</dimension>
  <dimension name="worldview_alignment" weight="0.35">Does this topic connect to YOUR themes? This is the most important dimension. You have a worldview and every piece of content should reflect it.</dimension>
</dimensions>

<worldview_scoring_guide>
  <score range="9-10">Directly about your core themes and beliefs</score>
  <score range="7-8">News you can spin into your themes</score>
  <score range="5-6">General culture that you can find YOUR angle on</score>
  <score range="3-4">Mainstream news with a weak connection to your themes</score>
  <score range="1-2">Random viral content with zero connection to who you are</score>
  <score range="0">Violates any of your restrictions</score>
</worldview_scoring_guide>

A topic that scores 10 on virality but 2 on worldview alignment should LOSE to a topic that scores 6 on virality but 9 on worldview alignment. Your audience follows YOU for YOUR perspective.

Calculate the composite score as the weighted sum.
</scoring_task>`.trim()
}
