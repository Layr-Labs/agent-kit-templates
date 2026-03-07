import { createHash } from 'crypto'
import { Output } from 'ai'
import { z } from 'zod'
import { JsonStore } from '../store/json-store.js'
import type { Config } from '../config/index.js'
import type { CompiledAgent } from './types.js'
import { generateTrackedText } from '../ai/tracking.js'

const compiledAgentSchema = z.object({
  identity: z.object({
    name: z.string().describe('The agent name, from ## Name'),
    tagline: z.string().describe('Short tagline, from ## Tagline'),
    creator: z.string().describe('Creator handle, from ## Creator'),
    born: z.string().describe('Birth date and location, from ## Born. Empty string if not specified.'),
    bio: z.string().describe('Full bio/backstory, from ## Bio. Empty string if not specified.'),
    persona: z.string().describe('The agent personality summary, extracted from the soul'),
    beliefs: z.array(z.string()).describe('Core beliefs/values (5-7 items)'),
    themes: z.array(z.string()).describe('Recurring content themes (4-10 items)'),
    punchesUp: z.array(z.string()).describe('Who/what the agent challenges (3-6 items)'),
    respects: z.array(z.string()).describe('Who/what the agent respects (3-6 items)'),
    voice: z.string().describe('Voice and tone description'),
    restrictions: z.array(z.string()).describe('Content restrictions and boundaries'),
    motto: z.string().describe('Single-line motto or slogan'),
  }),
  style: z.object({
    name: z.string().describe('Short name for the visual style'),
    description: z.string().describe('Overall style description'),
    visualIdentity: z.string().describe('How images should look'),
    compositionPrinciples: z.string().describe('Layout and composition rules'),
    renderingRules: z.string().describe('Technical constraints and what to avoid'),
  }).optional().describe('Visual style for image generation'),
  engagement: z.object({
    voiceDescription: z.string().describe('How the agent interacts with its audience'),
    rules: z.array(z.string()).describe('Specific engagement rules (5-10 items)'),
  }).optional().describe('Engagement behavior with audience'),
  governance: z.object({
    upgradeRules: z.array(z.string()).describe('Rules about what can/cannot be upgraded'),
    financialCommitments: z.array(z.string()).describe('Financial obligations (dividends, spending limits)'),
    restrictions: z.array(z.string()).describe('Hard restrictions the agent must never violate'),
  }),
  plan: z.object({
    backgroundTasks: z.array(z.object({
      name: z.string(),
      trigger: z.object({
        type: z.literal('interval'),
        intervalMs: z.number().describe('Interval in milliseconds. E.g. 1800000 for 30 min, 21600000 for 6 hours, 86400000 for 24 hours'),
        timerKey: z.string().describe('Unique key for this timer. E.g. "scan", "engagement", "daily_briefing"'),
      }),
      skill: z.string(),
      tool: z.string(),
    })),
    workflows: z.array(z.object({
      name: z.string(),
      trigger: z.object({
        type: z.literal('interval'),
        intervalMs: z.number().describe('Interval in milliseconds. E.g. 1800000 for 30 min, 21600000 for 6 hours, 86400000 for 24 hours'),
        timerKey: z.string().describe('Unique key for this timer. E.g. "daily_briefing", "quick_analysis"'),
      }),
      instruction: z.string().describe('Natural language instruction for the LLM to execute this workflow using available tools'),
      priority: z.number(),
      runOnce: z.boolean().describe('If true, this workflow only runs once (e.g. bootstrap/setup). After first successful run, it is skipped. Use false for recurring workflows.'),
    })),
  }),
})

export class AgentCompiler {
  private store: JsonStore<CompiledAgent>

  constructor(
    private config: Config,
    dataDir: string,
  ) {
    this.store = new JsonStore(`${dataDir}/compiled-agent.json`)
  }

  async compile(
    soul: string,
    process: string,
    constitution: string,
    availableSkills: string[],
  ): Promise<CompiledAgent> {
    const combined = `${soul}\n---\n${process}\n---\n${constitution}`
    const sourceHash = createHash('sha256').update(combined).digest('hex').slice(0, 16)

    const cached = await this.store.read()
    if (cached && cached.sourceHash === sourceHash) {
      console.log('Agent definition unchanged — using cached compilation.')
      return cached
    }

    console.log('Compiling agent from SOUL.md + PROCESS.md + constitution.md...')

    const { output: object } = await generateTrackedText({
      operation: 'compile_agent',
      modelId: this.config.modelId('compilation'),
      model: this.config.model('compilation'),
      output: Output.object({ schema: compiledAgentSchema }),
      system: COMPILER_SYSTEM_PROMPT(availableSkills),
      prompt: `## SOUL (who the agent is)\n\n${soul}\n\n## PROCESS (how the agent creates)\n\n${process}\n\n## CONSTITUTION (governance rules)\n\n${constitution}`,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    })
    if (!object) throw new Error('Failed to compile agent definition')

    const compiled: CompiledAgent = {
      version: 1,
      compiledAt: Date.now(),
      sourceHash,
      identity: object.identity,
      style: object.style,
      engagement: object.engagement,
      governance: object.governance,
      plan: object.plan,
      creativeProcess: process,
    }

    await this.store.write(compiled)
    console.log(`Agent compiled: ${compiled.plan.workflows.length} workflows, ${compiled.plan.backgroundTasks.length} background tasks.`)

    return compiled
  }
}

function COMPILER_SYSTEM_PROMPT(skills: string[]): string {
  return `You are an agent compiler. You take three documents describing an autonomous agent and compile them into structured data:

1. SOUL — who the agent is (personality, beliefs, style, engagement behavior)
2. PROCESS — how the agent operates, learns, researches, and creates (creative or operational workflows described in plain text)
3. CONSTITUTION — governance rules (immutable constraints, financial commitments)

## Available Skills
${skills.join(', ')}

## Tool Reference

These tools are available for the agent to use during workflow execution:

| Tool | What it does |
|---|---|
| browse | General-purpose browser automation for research, extraction, and interaction |
| read_article | Read and extract a single article from the web |
| read_articles | Read and extract multiple articles from the web |
| write_file | Persist long outputs to a file in the data directory |
| read_file | Read a file from the data directory |
| list_files | List files in the data directory |
| record_learning | Save a durable research finding or lesson to the learnings directory |
| list_learnings | List saved learning notes |
| read_learning | Read a saved learning note |
| write_note | Save a reusable note, draft, or working document |
| list_notes | List saved notes |
| read_note | Read a saved note |
| list_skills | List loaded skills and tools |
| create_skill | Create and hot-load a new skill when a needed capability is missing |
| scan | Scan for signals from data sources |
| score_signals | Score and rank signals against worldview |
| generate_concepts | Generate creative content concepts |
| critique_concepts | Self-critique concepts, pick the best |
| generate_image | Generate image variants from a concept |
| write_caption | Write a short caption for content |
| editorial_review | Quality review gate |
| write_article | Write long-form article content |
| publish_image | Publish image content to platform |
| publish_article | Publish article content to platform |
| engage_audience | Interact with audience (replies, follows) |
| reflect_worldview | Reflect and evolve the agent's worldview |
| update_soul | Update the agent's SOUL.md file |
| update_process | Update the agent's PROCESS.md file |
| eth_balance | Check ETH balance of any address |
| send_eth | Send ETH to an address |
| erc20_balance | Check ERC-20 token balance |
| get_wallet_address | Get the agent's wallet address |
| platform_login | Log into a platform via browser automation |
| check_card_status | Check if a prepaid card is provisioned |
| provision_card | Buy and redeem a prepaid Visa card via Bitrefill |
| get_card_details | Get virtual card details (number, CVV, expiry) |
| topup_twitter_billing | Add payment card to Twitter/X billing settings |

You are not limited to media publishing. Use the available tools to compile workflows for research, learning, browser-driven tasks, email, wallet operations, or file-based knowledge work when that is what the PROCESS describes.

## Compiling the PROCESS into Workflows

The PROCESS document describes the agent's operational flows in plain text. You must compile this into:

1. **Background tasks** — periodic standalone actions (scan, engage, reflect). These run independently.
2. **Workflows** — multi-step research, learning, or creative processes. Each workflow has:
   - A trigger (interval-based timing)
   - An instruction (natural language description of what the agent should do, referencing available tools)
   - A priority (higher = checked first)

**IMPORTANT:** The workflow \`instruction\` field should be a clear, detailed natural language description of the creative flow. The agent will receive this instruction along with all available tools and execute it autonomously. Include quality thresholds, variant counts, and any specific requirements mentioned in the PROCESS.

## Bootstrap Workflow

If the PROCESS involves publishing to an external platform (Substack, Twitter, etc.), you SHOULD include a **bootstrap workflow** as the HIGHEST priority workflow. This workflow runs once at startup to ensure the platform account is set up before publishing workflows fire.

For Substack: The bootstrap workflow should use \`check_substack_account\` to check if an account exists. If not, call \`setup_substack_account\` with the agent's name, bio, newsletter name, and description from the identity. The setup tool itself can derive publication handle candidates from the full agent identity, test what is available, and reuse an existing publication if one already exists on the account.

Give bootstrap workflows \`priority: 100\` (highest), \`runOnce: true\`, and a very short interval (intervalMs: 30000) so they fire immediately on first tick. The timerKey should be "bootstrap".

The bootstrap instruction should clearly state: "Check if the platform account exists. If it does, do nothing. If it doesn't, set it up using the setup tools. Use the agent's identity for account details, let the setup flow choose an appropriate Substack handle, and reuse any existing publication before creating a new one."

If the PROCESS does not require an external publishing platform, do NOT invent a bootstrap workflow.

## Trigger Format

**CRITICAL:** Every trigger MUST have \`type: "interval"\`, a \`timerKey\` string, and an \`intervalMs\` number. Do NOT use the \`condition\` field for interval triggers. Each background task and workflow MUST have a UNIQUE timerKey — never reuse the same timerKey for different tasks.

Examples:
- \`{ "type": "interval", "timerKey": "scan", "intervalMs": 1800000 }\`  ← every 30 minutes
- \`{ "type": "interval", "timerKey": "engagement", "intervalMs": 1800000 }\`  ← every 30 minutes
- \`{ "type": "interval", "timerKey": "daily_briefing", "intervalMs": 86400000 }\`  ← every 24 hours
- \`{ "type": "interval", "timerKey": "quick_analysis", "intervalMs": 21600000 }\`  ← every 6 hours
- \`{ "type": "interval", "timerKey": "reflection", "intervalMs": 604800000 }\`  ← every 7 days

Common intervals:
| Natural language | intervalMs |
|---|---|
| every 30 seconds | 30000 |
| every 5 minutes | 300000 |
| every 30 minutes | 1800000 |
| every 1 hour | 3600000 |
| every 6 hours | 21600000 |
| every 12 hours | 43200000 |
| every 24 hours / daily | 86400000 |
| every 7 days / weekly | 604800000 |

## Identity Extraction

Extract identity fields from the SOUL document's markdown sections:
- ## Name → name (the agent's name)
- ## Tagline → tagline
- ## Creator → creator
- ## Born → born (optional, birth date and location)
- ## Bio → bio (optional, full backstory)
- ## Voice → voice
- ## Beliefs → beliefs array
- ## Themes → themes array
- ## Punches Up → punchesUp array
- ## Respects → respects array
- ## Motto → motto
- ## Restrictions → restrictions array
- Combine all personality information into a coherent persona summary

## Style Extraction

If the SOUL has a ## Visual Style section, extract it into the style object.
If there is no visual style section, omit the style field entirely. Do not invent one.

## Engagement Extraction

If the SOUL has an ## Engagement section, extract it into the engagement object.
If not specified, omit the engagement field. Do not invent one.

## Governance Extraction

Extract from the CONSTITUTION document:
- ## Upgrade Rules → upgradeRules
- ## Financial Commitments → financialCommitments
- ## Restrictions → restrictions

If a section is missing, provide reasonable defaults.

## Workflow Priorities

Higher priority = checked first: bootstrap=100, flagship=10, article=8, quickhit=5

## Learning Persistence

When the PROCESS involves research, synthesis, or repeated web learning, prefer workflows that save durable findings using \`record_learning\`, \`write_note\`, or \`write_file\`. Important learnings should not exist only in transient model output.

When the PROCESS depends on accumulated knowledge, prior research, or a running notebook of ideas, include steps that consult \`list_learnings\` + \`read_learning\` and \`list_notes\` + \`read_note\` before doing fresh work.`
}
