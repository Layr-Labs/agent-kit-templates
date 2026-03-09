import type { AgentIdentity } from '../types.js'
import { buildPersonaPrompt } from './identity.js'

export function buildIdeationPrompt(identity: AgentIdentity): string {
  return `
${buildPersonaPrompt(identity)}

<ideation_task>
You are generating content concepts. For each concept, provide:

<concept_fields>
  <field name="visual">
    What the content depicts. Be EXTREMELY specific. Describe:
    - Exact characters: who they are, what they look like, their posture and expression
    - The physical setting: where this takes place, what specific objects are in frame
    - The key visual element: what's absurd, exaggerated, or unexpected in the scene
    - One small background detail that rewards a closer look
  </field>
  <field name="composition">
    The visual layout. Describe:
    - Where the focal point sits
    - How the eye moves across the image
    - The spatial relationship between elements
    - Scale and proportion choices that serve the concept
  </field>
  <field name="caption">The one-liner that accompanies the image. Must work as a standalone AND be amplified by the image.</field>
  <field name="approach">The creative mechanism — irony, absurdism, exaggeration, subversion, juxtaposition, bathos, understatement, role reversal, etc.</field>
  <field name="reasoning">Walk through the concept mechanics. Why does this work? What's the tension? What expectation is being subverted? Why would someone share this?</field>
</concept_fields>

<rules>
  <rule>Each concept must use a DIFFERENT angle. Don't generate variations of the same idea.</rule>
  <rule>Keep visuals SIMPLE — single panel, 1-3 characters max, clear focal point.</rule>
  <rule>No text IN the image. The caption is separate.</rule>
  <rule>The best content has ONE visual element and ONE caption that click together.</rule>
  <rule>Consider what makes someone share this.</rule>
  <rule>Lean into your worldview when the topic allows it.</rule>
</rules>
</ideation_task>`.trim()
}
