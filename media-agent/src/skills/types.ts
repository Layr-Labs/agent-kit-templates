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

export interface SkillRegistryInterface {
  register(skill: any): void
  loadAndInit(indexPath: string, ctx: SkillContext): Promise<{ name: string; tools: string[] } | null>
  get tools(): Record<string, any>
  get names(): string[]
}

export interface SkillContext {
  events: EventBus
  identity: AgentIdentity
  config: Config
  dataDir: string
  db: Database
  wallet: WalletManager
  browser?: unknown
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
  init(ctx: SkillContext): Promise<Record<string, Tool>>
  tick?(): Promise<void>
  shutdown?(): Promise<void>
}
