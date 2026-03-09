import type { Tool } from 'ai'
import type { EventBus } from '../console/events.js'
import type { AgentIdentity } from '../types.js'
import type { Database } from '../db/index.js'
import type { WalletManager } from '../crypto/wallet.js'
import type { ContentSigner } from '../crypto/signer.js'
import type { Config } from '../config/index.js'
import type { PipelineState } from '../process/state.js'
import type { ScannerRegistry } from '../pipeline/scanner.js'
import type { PlatformAdapter } from '../platform/types.js'
import type { Cache } from '../cache/cache.js'
import type { StyleConfig } from '../prompts/style.js'
import type { BrowserLike } from '../browser/types.js'

export type SkillSource = 'builtin' | 'installed'

export interface SkillToolInfo {
  name: string
  description: string
}

export interface InstalledSkillManifest {
  apiVersion: 1
  name: string
  version: string
  description: string
  entrypoint: string
  sourceEntrypoint: string
  capabilities?: string[]
  tools?: SkillToolInfo[]
  /** Maps pipeline skill name → tool names from this skill to include in that pipeline stage. */
  pipelineIntegration?: Record<string, string[]>
  enabled?: boolean
}

export interface SkillInfo {
  name: string
  description: string
  category: Skill['category']
  source: SkillSource
  version?: string
  enabled?: boolean
  capabilities?: string[]
  declaredTools?: SkillToolInfo[]
  tools: string[]
}

export interface SkillRegistryInterface {
  get tools(): Record<string, any>
  get names(): string[]
  list(): SkillInfo[]
  installedManifests(): InstalledSkillManifest[]
  resolveWorkflowTools(skillNames: string[]): Record<string, any>
}

export interface SkillContext {
  events: EventBus
  identity: AgentIdentity
  config: Config
  dataDir: string
  db: Database
  wallet: WalletManager
  browser?: BrowserLike
  state: PipelineState
  scannerRegistry: ScannerRegistry
  platform?: PlatformAdapter
  signer?: ContentSigner
  compiledStyle?: StyleConfig
  caches: {
    eval: Cache
    image: Cache
    signal: Cache<any>
  }
  registry?: SkillRegistryInterface
}

export interface Skill {
  readonly name: string
  readonly description: string
  readonly category: 'agent' | 'browser' | 'pipeline'
  readonly dependencies?: string[]
  /** External tool names this skill needs when included in a workflow scope. */
  readonly toolScope?: string[]
  init(ctx: SkillContext): Promise<Record<string, Tool>>
  tick?(): Promise<void>
  shutdown?(): Promise<void>
}
