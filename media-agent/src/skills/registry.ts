import { readdir } from 'fs/promises'
import { join } from 'path'
import type { Tool } from 'ai'
import type { Skill, SkillContext } from './types.js'

export class SkillRegistry {
  private skills = new Map<string, Skill>()
  private allTools: Record<string, Tool> = {}

  register(skill: Skill): void {
    this.skills.set(skill.name, skill)
  }

  async discover(skillsDir: string): Promise<void> {
    for (const category of ['agent', 'browser', 'pipeline']) {
      const categoryDir = join(skillsDir, category)
      try {
        const entries = await readdir(categoryDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const indexPath = join(categoryDir, entry.name, 'index.ts')
          try {
            const mod = await import(indexPath)
            const skill = mod.default as Skill
            if (skill && typeof skill === 'object' && 'name' in skill && 'init' in skill) {
              this.register(skill)
            }
          } catch { /* skill failed to load */ }
        }
      } catch { /* directory doesn't exist */ }
    }
  }

  async initAll(ctx: SkillContext): Promise<Record<string, Tool>> {
    this.allTools = {}

    for (const [name, skill] of this.skills) {
      if (skill.dependencies) {
        for (const dep of skill.dependencies) {
          if (!this.skills.has(dep)) {
            console.warn(`Skill "${name}" requires "${dep}" which is not registered. Skipping.`)
            continue
          }
        }
      }

      try {
        const skillTools = await skill.init(ctx)
        for (const [toolName, tool] of Object.entries(skillTools)) {
          this.allTools[toolName] = tool
        }
        console.log(`Skill loaded: ${name} (${Object.keys(skillTools).length} tools)`)
      } catch (err) {
        console.error(`Skill "${name}" failed to init:`, (err as Error).message)
      }
    }

    return this.allTools
  }

  async tickAll(): Promise<void> {
    for (const [name, skill] of this.skills) {
      if (skill.tick) {
        try {
          await skill.tick()
        } catch (err) {
          console.error(`Skill "${name}" tick failed:`, (err as Error).message)
        }
      }
    }
  }

  async shutdownAll(): Promise<void> {
    for (const skill of this.skills.values()) {
      await skill.shutdown?.()
    }
  }

  get tools(): Record<string, Tool> {
    return this.allTools
  }

  get names(): string[] {
    return [...this.skills.keys()]
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  async loadAndInit(indexPath: string, ctx: SkillContext): Promise<{ name: string; tools: string[] } | null> {
    try {
      // Use timestamp to bust Bun's import cache
      const mod = await import(`${indexPath}?t=${Date.now()}`)
      const skill = mod.default as Skill
      if (!skill || !('name' in skill) || !('init' in skill)) {
        return null
      }

      this.register(skill)
      const skillTools = await skill.init(ctx)
      for (const [toolName, tool] of Object.entries(skillTools)) {
        this.allTools[toolName] = tool
      }

      console.log(`Skill hot-loaded: ${skill.name} (${Object.keys(skillTools).length} tools)`)
      return { name: skill.name, tools: Object.keys(skillTools) }
    } catch (err) {
      console.error(`Failed to hot-load skill from ${indexPath}:`, (err as Error).message)
      return null
    }
  }
}
