export interface StyleConfig {
  name: string
  description: string
  visualIdentity: string
  compositionPrinciples: string
  renderingRules: string
}

export function buildStylePrompt(style: StyleConfig): string {
  return `
<artist_style name="${style.name}">
  <description>${style.description}</description>
  <visual_identity>${style.visualIdentity}</visual_identity>
  <composition_principles>${style.compositionPrinciples}</composition_principles>
  <rendering_rules>${style.renderingRules}</rendering_rules>
</artist_style>`.trim()
}
