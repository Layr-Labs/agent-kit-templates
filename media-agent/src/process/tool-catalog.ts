import type { InstalledSkillManifest, SkillInfo, SkillToolInfo } from '../skills/types.js'

export interface CompilerToolInfo extends SkillToolInfo {
  source: 'builtin' | 'installed'
  skill?: string
}

export interface CompilerSkillInfo {
  name: string
  source: 'builtin' | 'installed'
  version?: string
  description: string
  capabilities: string[]
  tools: SkillToolInfo[]
}

export const BUILTIN_TOOL_CATALOG: CompilerToolInfo[] = [
  { name: 'browse', description: 'General-purpose browser automation for research, extraction, and interaction', source: 'builtin' },
  { name: 'read_article', description: 'Read and extract a single article from the web', source: 'builtin' },
  { name: 'read_articles', description: 'Read and extract multiple articles from the web', source: 'builtin' },
  { name: 'write_file', description: 'Persist long outputs to a file in the data directory', source: 'builtin' },
  { name: 'read_file', description: 'Read a file from the data directory', source: 'builtin' },
  { name: 'list_files', description: 'List files in the data directory', source: 'builtin' },
  { name: 'record_learning', description: 'Save a durable research finding or lesson to the learnings directory', source: 'builtin' },
  { name: 'list_learnings', description: 'List saved learning notes', source: 'builtin' },
  { name: 'read_learning', description: 'Read a saved learning note', source: 'builtin' },
  { name: 'write_note', description: 'Save a reusable note, draft, or working document', source: 'builtin' },
  { name: 'list_notes', description: 'List saved notes', source: 'builtin' },
  { name: 'read_note', description: 'Read a saved note', source: 'builtin' },
  { name: 'list_skills', description: 'List loaded skills and tools', source: 'builtin' },
  { name: 'scan', description: 'Scan for signals from data sources', source: 'builtin' },
  { name: 'score_signals', description: 'Score and rank signals against worldview', source: 'builtin' },
  { name: 'generate_concepts', description: 'Generate creative content concepts', source: 'builtin' },
  { name: 'critique_concepts', description: 'Self-critique concepts and pick the best', source: 'builtin' },
  { name: 'generate_image', description: 'Generate image variants from a concept', source: 'builtin' },
  { name: 'write_caption', description: 'Write a short caption for content', source: 'builtin' },
  { name: 'editorial_review', description: 'Quality review gate', source: 'builtin' },
  { name: 'write_article', description: 'Write long-form article content', source: 'builtin' },
  { name: 'publish_image', description: 'Publish image content to the platform', source: 'builtin' },
  { name: 'publish_article', description: 'Publish article content to the platform', source: 'builtin' },
  { name: 'engage_audience', description: 'Interact with the audience', source: 'builtin' },
  { name: 'reflect_worldview', description: 'Reflect and evolve the agent worldview', source: 'builtin' },
  { name: 'update_soul', description: 'Update the agent SOUL.md file', source: 'builtin' },
  { name: 'update_process', description: 'Update the agent PROCESS.md file', source: 'builtin' },
  { name: 'eth_balance', description: 'Check ETH balance of any address', source: 'builtin' },
  { name: 'send_eth', description: 'Send ETH to an address', source: 'builtin' },
  { name: 'erc20_balance', description: 'Check ERC-20 token balance', source: 'builtin' },
  { name: 'get_wallet_address', description: 'Get the agent wallet address', source: 'builtin' },
  { name: 'platform_login', description: 'Log into a platform via browser automation', source: 'builtin' },
  { name: 'check_card_status', description: 'Check if a prepaid card is provisioned', source: 'builtin' },
  { name: 'provision_card', description: 'Buy and redeem a prepaid Visa card via Bitrefill', source: 'builtin' },
  { name: 'get_card_details', description: 'Get virtual card details (number, CVV, expiry)', source: 'builtin' },
  { name: 'topup_twitter_billing', description: 'Add a payment card to Twitter/X billing settings', source: 'builtin' },
]

export function buildCompilerToolCatalog(installed: InstalledSkillManifest[]): CompilerToolInfo[] {
  const map = new Map<string, CompilerToolInfo>()

  for (const tool of BUILTIN_TOOL_CATALOG) {
    map.set(tool.name, tool)
  }

  for (const manifest of installed) {
    for (const tool of manifest.tools ?? []) {
      map.set(tool.name, {
        ...tool,
        source: 'installed',
        skill: manifest.name,
      })
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function buildCompilerSkillCatalog(skills: SkillInfo[]): CompilerSkillInfo[] {
  return [...skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({
      name: skill.name,
      source: skill.source,
      version: skill.version,
      description: skill.description,
      capabilities: skill.capabilities ?? [],
      tools: skill.declaredTools ?? [],
    }))
}
