export interface StyleConfig {
  name: string
  description: string
  visualIdentity: string
  compositionPrinciples: string
  renderingRules: string
}

export function buildStylePrompt(style: StyleConfig): string {
  return `
ARTIST STYLE — "${style.name}"
${style.description}

VISUAL IDENTITY:
${style.visualIdentity}

COMPOSITION PRINCIPLES:
${style.compositionPrinciples}

RENDERING RULES:
${style.renderingRules}
`.trim()
}
