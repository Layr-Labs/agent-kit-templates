import { watch, type FSWatcher } from 'fs'
import { access, readdir } from 'fs/promises'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import type { Tool } from 'ai'
import {
  ensureInstalledSkillsRoot,
  isSkillEnabled,
  listInstalledSkillDirs,
  readInstalledSkillManifest,
} from './installed.js'
import type {
  Skill,
  SkillContext,
  SkillInfo,
  SkillSource,
  InstalledSkillManifest,
} from './types.js'

interface RegisteredSkillRecord {
  skill: Skill
  source: SkillSource
  entrypointPath: string
  manifest?: InstalledSkillManifest
}

export class SkillRegistry {
  private builtinSkills = new Map<string, RegisteredSkillRecord>()
  private installedSkills = new Map<string, RegisteredSkillRecord>()
  private allTools: Record<string, Tool> = {}
  private toolNamesBySkill = new Map<string, string[]>()
  private ctx?: SkillContext
  private installedRoot?: string
  private hotReloadWatcher?: FSWatcher
  private hotReloadTimer?: ReturnType<typeof setTimeout>
  private hotReloadPromise?: Promise<void>
  private installedSkillsReloadHandler?: (summary: {
    added: string[]
    removed: string[]
    reloaded: string[]
  }) => Promise<void> | void

  async discover(opts: {
    builtinRoot: string
    installedRoot?: string
  }): Promise<void> {
    await this.discoverBuiltin(opts.builtinRoot)
    if (opts.installedRoot) {
      this.installedRoot = opts.installedRoot
      await this.discoverInstalled(opts.installedRoot)
    }
  }

  async discoverBuiltin(skillsDir: string): Promise<void> {
    const next = new Map<string, RegisteredSkillRecord>()

    for (const category of ['agent', 'browser', 'pipeline']) {
      const categoryDir = join(skillsDir, category)
      try {
        const entries = await readdir(categoryDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const indexPath = join(categoryDir, entry.name, 'index.ts')
          try {
            await access(indexPath)
          } catch {
            continue
          }
          const skill = await this.loadSkill(indexPath, false)
          if (!skill) continue

          next.set(skill.name, {
            skill,
            source: 'builtin',
            entrypointPath: indexPath,
          })
        }
      } catch {
        // Ignore missing built-in categories.
      }
    }

    this.builtinSkills = next
  }

  async discoverInstalled(installedRoot: string): Promise<void> {
    await ensureInstalledSkillsRoot(installedRoot)
    const next = new Map<string, RegisteredSkillRecord>()

    for (const dirName of await listInstalledSkillDirs(installedRoot)) {
      const skillDir = resolve(installedRoot, dirName)
      const manifest = await readInstalledSkillManifest(skillDir)
      if (!manifest || !isSkillEnabled(manifest)) continue

      const entrypointPath = resolve(skillDir, manifest.entrypoint)
      const skill = await this.loadSkill(entrypointPath, true)
      if (!skill) continue

      if (skill.name !== manifest.name) {
        console.warn(`Installed skill "${manifest.name}" ignored because its exported name is "${skill.name}".`)
        continue
      }

      if (this.builtinSkills.has(skill.name)) {
        console.warn(`Installed skill "${skill.name}" overrides the built-in skill of the same name.`)
      }

      next.set(skill.name, {
        skill,
        source: 'installed',
        entrypointPath,
        manifest,
      })
    }

    this.installedSkills = next
  }

  async initAll(ctx: SkillContext): Promise<Record<string, Tool>> {
    this.ctx = ctx
    this.toolNamesBySkill.clear()

    const nextTools: Record<string, Tool> = {}

    for (const [name, record] of this.entries()) {
      const skill = record.skill

      if (skill.dependencies) {
        const available = new Set(this.names)
        const missing = skill.dependencies.filter((dep) => !available.has(dep))
        if (missing.length > 0) {
          console.warn(`Skill "${name}" requires missing dependencies: ${missing.join(', ')}. Skipping.`)
          continue
        }
      }

      try {
        const skillTools = await skill.init(ctx)
        for (const [toolName, tool] of Object.entries(skillTools)) {
          nextTools[toolName] = tool
        }
        this.toolNamesBySkill.set(name, Object.keys(skillTools))
        console.log(`Skill loaded: ${name} (${Object.keys(skillTools).length} tools)`)
      } catch (err) {
        console.error(`Skill "${name}" failed to init:`, (err as Error).message)
      }
    }

    this.allTools = nextTools
    return this.allTools
  }

  async tickAll(): Promise<void> {
    for (const [, record] of this.entries()) {
      if (record.skill.tick) {
        try {
          await record.skill.tick()
        } catch (err) {
          console.error(`Skill "${record.skill.name}" tick failed:`, (err as Error).message)
        }
      }
    }
  }

  async shutdownAll(): Promise<void> {
    for (const [, record] of this.entries()) {
      await record.skill.shutdown?.()
    }
    this.allTools = {}
    this.toolNamesBySkill.clear()
  }

  startHotReload(opts?: { installedRoot?: string; enabled?: boolean }): void {
    if (opts?.installedRoot) this.installedRoot = opts.installedRoot
    if (opts?.enabled === false || !this.installedRoot || !this.ctx) return

    this.stopHotReload()

    try {
      this.hotReloadWatcher = watch(this.installedRoot, { recursive: true }, () => {
        if (this.hotReloadTimer) clearTimeout(this.hotReloadTimer)
        this.hotReloadTimer = setTimeout(() => {
          void this.reloadInstalledSkills().catch(() => {})
        }, 250)
      })
      console.log(`Installed skill hot reload enabled for ${this.installedRoot}`)
    } catch (err) {
      console.error(`Installed skill hot reload unavailable: ${(err as Error).message}`)
    }
  }

  stopHotReload(): void {
    if (this.hotReloadTimer) clearTimeout(this.hotReloadTimer)
    this.hotReloadTimer = undefined
    this.hotReloadWatcher?.close()
    this.hotReloadWatcher = undefined
  }

  async reloadInstalledSkills(): Promise<void> {
    if (!this.ctx || !this.installedRoot) return
    if (this.hotReloadPromise) {
      await this.hotReloadPromise
      return
    }

    const previousInstalledSkills = new Map(this.installedSkills)

    this.hotReloadPromise = (async () => {
      const previousNames = new Set(previousInstalledSkills.keys())

      await this.shutdownAll()
      try {
        await this.discoverInstalled(this.installedRoot!)
        await this.initAll(this.ctx!)

        const nextNames = new Set(this.installedSkills.keys())
        const added = [...nextNames].filter((name) => !previousNames.has(name))
        const removed = [...previousNames].filter((name) => !nextNames.has(name))
        const unchanged = [...nextNames].filter((name) => previousNames.has(name))

        await this.installedSkillsReloadHandler?.({ added, removed, reloaded: unchanged })

        const summaryParts = [
          added.length > 0 ? `added ${added.join(', ')}` : '',
          removed.length > 0 ? `removed ${removed.join(', ')}` : '',
          unchanged.length > 0 ? `reloaded ${unchanged.join(', ')}` : '',
        ].filter(Boolean)

        const summary = summaryParts.length > 0
          ? summaryParts.join(' | ')
          : 'No installed skills enabled.'

        this.ctx?.events.monologue(`Installed skills refreshed. ${summary}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        let restored = false

        try {
          await this.restoreInstalledRuntime(previousInstalledSkills)
          restored = true
        } catch (restoreErr) {
          console.error(`Failed to restore previous installed skills:`, (restoreErr as Error).message)
        }

        this.ctx?.events.monologue(
          `Installed skill reload failed: ${message}.${restored ? ' Restored previous runtime.' : ' Failed to restore the previous runtime.'}`,
        )
        console.error(`Installed skill reload failed:`, message)
        throw err
      }
    })().finally(() => {
      this.hotReloadPromise = undefined
    })

    await this.hotReloadPromise
  }

  private async restoreInstalledRuntime(previousInstalledSkills: Map<string, RegisteredSkillRecord>): Promise<void> {
    if (!this.ctx) return
    await this.shutdownAll()
    this.installedSkills = new Map(previousInstalledSkills)
    await this.initAll(this.ctx)
  }

  get tools(): Record<string, Tool> {
    return this.allTools
  }

  /**
   * Resolve workflow-scoped tools from a list of skill names.
   * For each skill: includes its own tools + any external tools declared in its toolScope.
   */
  resolveWorkflowTools(skillNames: string[]): Record<string, Tool> {
    const result: Record<string, Tool> = {}
    const allRecords = this.records()
    const requestedSet = new Set(skillNames)

    for (const name of skillNames) {
      // Add the skill's own tools
      const ownToolNames = this.toolNamesBySkill.get(name)
      if (ownToolNames) {
        for (const toolName of ownToolNames) {
          if (this.allTools[toolName]) result[toolName] = this.allTools[toolName]
        }
      }

      // Add external tools from toolScope
      const record = allRecords.get(name)
      if (record?.skill.toolScope) {
        for (const toolName of record.skill.toolScope) {
          if (this.allTools[toolName]) result[toolName] = this.allTools[toolName]
        }
      }
    }

    // Add tools from installed skills that declare pipelineIntegration for any requested skill
    for (const [, record] of this.installedSkills) {
      if (!record.manifest?.pipelineIntegration) continue
      if (!isSkillEnabled(record.manifest)) continue

      for (const [pipelineSkill, toolNames] of Object.entries(record.manifest.pipelineIntegration)) {
        if (!requestedSet.has(pipelineSkill)) continue
        for (const toolName of toolNames) {
          if (this.allTools[toolName]) result[toolName] = this.allTools[toolName]
        }
      }
    }

    return result
  }

  get names(): string[] {
    return this.entries().map(([name]) => name)
  }

  get(name: string): Skill | undefined {
    return this.records().get(name)?.skill
  }

  list(): SkillInfo[] {
    return this.entries().map(([name, record]) => ({
      name,
      description: record.skill.description,
      category: record.skill.category,
      source: record.source,
      version: record.manifest?.version,
      enabled: record.manifest ? isSkillEnabled(record.manifest) : true,
      capabilities: record.manifest?.capabilities ?? [],
      declaredTools: record.manifest?.tools ?? [],
      tools: this.toolNamesBySkill.get(name) ?? [],
    }))
  }

  installedManifests(): InstalledSkillManifest[] {
    return [...this.installedSkills.values()]
      .map((record) => record.manifest)
      .filter((manifest): manifest is InstalledSkillManifest => !!manifest)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  setInstalledSkillsReloadHandler(
    handler: (summary: { added: string[]; removed: string[]; reloaded: string[] }) => Promise<void> | void,
  ): void {
    this.installedSkillsReloadHandler = handler
  }

  private records(): Map<string, RegisteredSkillRecord> {
    return new Map([...this.builtinSkills, ...this.installedSkills])
  }

  private entries(): Array<[string, RegisteredSkillRecord]> {
    return [...this.records().entries()]
  }

  private async loadSkill(entrypointPath: string, bustCache: boolean): Promise<Skill | null> {
    try {
      const ref = pathToFileURL(entrypointPath).href + (bustCache ? `?t=${Date.now()}` : '')
      const mod = await import(ref)
      const skill = mod.default as Skill
      if (!skill || typeof skill !== 'object' || !('name' in skill) || !('init' in skill)) {
        return null
      }
      return skill
    } catch (err) {
      console.error(`Failed to load skill module at ${entrypointPath}:`, (err as Error).message)
      return null
    }
  }
}
