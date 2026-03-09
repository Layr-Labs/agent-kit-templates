import { createHash } from 'crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { dirname, relative, resolve } from 'path'
import { z } from 'zod'
import type { InstalledSkillManifest } from './types.js'

const installedSkillNameSchema = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/)

const installedSkillManifestSchema = z.object({
  apiVersion: z.literal(1),
  name: installedSkillNameSchema,
  version: z.string().min(1).max(64),
  description: z.string().min(1).max(500),
  entrypoint: z.string().min(1),
  sourceEntrypoint: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
  tools: z.array(z.object({
    name: z.string().min(1).max(128),
    description: z.string().min(1).max(500),
  })).optional(),
  pipelineIntegration: z.record(
    z.string().min(1).max(64),
    z.array(z.string().min(1).max(128)),
  ).optional(),
  enabled: z.boolean().optional(),
})

export const installedSkillBundleSchema = z.object({
  manifest: installedSkillManifestSchema,
  files: z.record(z.string(), z.string()),
})

function resolveWithinRoot(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root)
  const candidate = resolve(resolvedRoot, ...segments)
  const rel = relative(resolvedRoot, candidate)

  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Invalid installed skill path.')
  }

  return candidate
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function computeInstalledSkillBundleHash(bundle: {
  manifest: InstalledSkillManifest
  files: Record<string, string>
}): string {
  const hash = createHash('sha256')
  hash.update(stableStringify(bundle.manifest))

  const entries = Object.entries(bundle.files).sort(([a], [b]) => a.localeCompare(b))
  for (const [relativePath, contentBase64] of entries) {
    hash.update('\0')
    hash.update(relativePath)
    hash.update('\0')
    hash.update(Buffer.from(contentBase64, 'base64'))
  }

  return hash.digest('hex')
}

export function getInstalledSkillsRoot(dataDir: string): string {
  return resolve(process.cwd(), dataDir, 'skills', 'installed')
}

export async function ensureInstalledSkillsRoot(installedRoot: string): Promise<void> {
  await mkdir(installedRoot, { recursive: true })
}

export async function listInstalledSkillDirs(installedRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(installedRoot, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

export async function readInstalledSkillManifest(skillDir: string): Promise<InstalledSkillManifest | null> {
  try {
    const raw = await readFile(resolve(skillDir, 'manifest.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    return installedSkillManifestSchema.parse(parsed)
  } catch {
    return null
  }
}

export function isSkillEnabled(manifest: InstalledSkillManifest): boolean {
  return manifest.enabled !== false
}

export async function listInstalledSkillInventory(installedRoot: string): Promise<InstalledSkillManifest[]> {
  const manifests: InstalledSkillManifest[] = []
  for (const dirName of await listInstalledSkillDirs(installedRoot)) {
    const manifest = await readInstalledSkillManifest(resolve(installedRoot, dirName))
    if (manifest) manifests.push(manifest)
  }
  return manifests.sort((a, b) => a.name.localeCompare(b.name))
}

export async function installSkillBundle(
  installedRoot: string,
  bundle: unknown,
): Promise<{ manifest: InstalledSkillManifest; skillDir: string; bundleHash: string }> {
  const parsed = installedSkillBundleSchema.parse(bundle)
  await ensureInstalledSkillsRoot(installedRoot)

  const skillDir = resolveWithinRoot(installedRoot, parsed.manifest.name)

  await rm(skillDir, { recursive: true, force: true })
  await mkdir(skillDir, { recursive: true })

  const bundleHash = computeInstalledSkillBundleHash({
    manifest: parsed.manifest,
    files: parsed.files,
  })

  for (const [relativePath, contentBase64] of Object.entries(parsed.files)) {
    if (!relativePath || relativePath.startsWith('/') || relativePath.includes('..')) {
      throw new Error(`Invalid skill file path: ${relativePath}`)
    }

    const outputPath = resolveWithinRoot(skillDir, relativePath)

    const content = Buffer.from(contentBase64, 'base64')

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, content)
  }

  const entrypointPath = resolveWithinRoot(skillDir, parsed.manifest.entrypoint)
  const sourceEntrypointPath = resolveWithinRoot(skillDir, parsed.manifest.sourceEntrypoint)
  if (!parsed.manifest.entrypoint.endsWith('.mjs')) {
    throw new Error('Installed skill entrypoint must be a .mjs artifact.')
  }
  if (!parsed.manifest.sourceEntrypoint.endsWith('.ts')) {
    throw new Error('Installed skill sourceEntrypoint must be a .ts source file.')
  }

  try {
    const entryStat = await stat(entrypointPath)
    if (!entryStat.isFile()) {
      throw new Error('Entrypoint is not a file.')
    }
  } catch (err) {
    throw new Error(`Installed skill entrypoint missing: ${(err as Error).message}`)
  }

  try {
    const sourceStat = await stat(sourceEntrypointPath)
    if (!sourceStat.isFile()) {
      throw new Error('Source entrypoint is not a file.')
    }
  } catch (err) {
    throw new Error(`Installed skill sourceEntrypoint missing: ${(err as Error).message}`)
  }

  await writeFile(resolve(skillDir, 'manifest.json'), JSON.stringify(parsed.manifest, null, 2))

  return {
    manifest: parsed.manifest,
    skillDir,
    bundleHash,
  }
}

export async function setInstalledSkillEnabled(
  installedRoot: string,
  name: string,
  enabled: boolean,
): Promise<InstalledSkillManifest> {
  const parsedName = installedSkillNameSchema.parse(name)
  const skillDir = resolveWithinRoot(installedRoot, parsedName)
  const manifest = await readInstalledSkillManifest(skillDir)
  if (!manifest) {
    throw new Error(`Installed skill not found: ${parsedName}`)
  }

  const next = { ...manifest, enabled }
  await writeFile(resolve(skillDir, 'manifest.json'), JSON.stringify(next, null, 2))
  return next
}

export async function removeInstalledSkill(installedRoot: string, name: string): Promise<void> {
  const parsedName = installedSkillNameSchema.parse(name)
  const skillDir = resolveWithinRoot(installedRoot, parsedName)
  await rm(skillDir, { recursive: true, force: true })
}
