import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { installSkillBundle } from '../src/skills/installed.js'

function makeBundle(opts: {
  name: string
  files: Record<string, string>
}) {
  const fileEntries: Record<string, string> = {}
  for (const [path, content] of Object.entries(opts.files)) {
    fileEntries[path] = Buffer.from(content).toString('base64')
  }
  return {
    manifest: {
      apiVersion: 1 as const,
      name: opts.name,
      version: '1.0.0',
      description: `${opts.name} skill`,
      entrypoint: 'dist/index.mjs',
      sourceEntrypoint: 'source/index.ts',
      enabled: true,
    },
    files: fileEntries,
  }
}

const SKILL_MJS = `
export default {
  name: 'test-skill',
  description: 'Test skill',
  category: 'agent',
  async init() { return {} },
}
`.trim()

describe('installSkillBundle npm dependency support', () => {
  let installedRoot: string

  afterEach(async () => {
    if (installedRoot) await rm(installedRoot, { recursive: true, force: true })
  })

  it('installs without package.json — no node_modules created', async () => {
    installedRoot = await mkdtemp(join(tmpdir(), 'media-npm-none-'))

    const bundle = makeBundle({
      name: 'test-skill',
      files: {
        'dist/index.mjs': SKILL_MJS,
        'source/index.ts': 'export default {}',
      },
    })

    const result = await installSkillBundle(installedRoot, bundle)
    expect(result.manifest.name).toBe('test-skill')

    // No node_modules should exist
    const skillDir = join(installedRoot, 'test-skill')
    const entries = await readdir(skillDir)
    expect(entries).not.toContain('node_modules')
  })

  it('runs npm install when package.json is present', async () => {
    installedRoot = await mkdtemp(join(tmpdir(), 'media-npm-install-'))

    const packageJson = JSON.stringify({
      name: 'test-skill-deps',
      private: true,
      dependencies: {
        'is-odd': '3.0.1',
      },
    })

    const bundle = makeBundle({
      name: 'test-skill',
      files: {
        'dist/index.mjs': SKILL_MJS,
        'source/index.ts': 'export default {}',
        'package.json': packageJson,
      },
    })

    const result = await installSkillBundle(installedRoot, bundle)
    expect(result.manifest.name).toBe('test-skill')

    // node_modules should exist with the installed package
    const skillDir = join(installedRoot, 'test-skill')
    const nodeModules = join(skillDir, 'node_modules')
    const nmStat = await stat(nodeModules)
    expect(nmStat.isDirectory()).toBe(true)

    // The specific package should be installed
    const pkgStat = await stat(join(nodeModules, 'is-odd'))
    expect(pkgStat.isDirectory()).toBe(true)
  })

  it('throws a clear error when npm install fails', async () => {
    installedRoot = await mkdtemp(join(tmpdir(), 'media-npm-fail-'))

    const packageJson = JSON.stringify({
      name: 'test-skill-bad',
      private: true,
      dependencies: {
        'this-package-definitely-does-not-exist-zzz-xyz-999': '0.0.1',
      },
    })

    const bundle = makeBundle({
      name: 'test-skill',
      files: {
        'dist/index.mjs': SKILL_MJS,
        'source/index.ts': 'export default {}',
        'package.json': packageJson,
      },
    })

    await expect(installSkillBundle(installedRoot, bundle)).rejects.toThrow(
      /npm install failed for skill "test-skill"/,
    )
  })

  it('preserves package.json in the skill directory', async () => {
    installedRoot = await mkdtemp(join(tmpdir(), 'media-npm-preserve-'))

    const packageJson = JSON.stringify({
      name: 'test-skill-preserve',
      private: true,
      dependencies: { 'is-odd': '3.0.1' },
    })

    const bundle = makeBundle({
      name: 'test-skill',
      files: {
        'dist/index.mjs': SKILL_MJS,
        'source/index.ts': 'export default {}',
        'package.json': packageJson,
      },
    })

    await installSkillBundle(installedRoot, bundle)

    const skillDir = join(installedRoot, 'test-skill')
    const writtenPkg = JSON.parse(await readFile(join(skillDir, 'package.json'), 'utf-8'))
    expect(writtenPkg.dependencies['is-odd']).toBe('3.0.1')
  })

  it('does not execute lifecycle install scripts from package.json', async () => {
    installedRoot = await mkdtemp(join(tmpdir(), 'media-npm-ignore-scripts-'))

    const packageJson = JSON.stringify({
      name: 'test-skill-ignore-scripts',
      private: true,
      scripts: {
        postinstall: 'node -e "require(\'fs\').writeFileSync(\'postinstall-ran.txt\', \'yes\')"',
      },
      dependencies: {
        'is-odd': '3.0.1',
      },
    })

    const bundle = makeBundle({
      name: 'test-skill',
      files: {
        'dist/index.mjs': SKILL_MJS,
        'source/index.ts': 'export default {}',
        'package.json': packageJson,
      },
    })

    await installSkillBundle(installedRoot, bundle)

    const skillDir = join(installedRoot, 'test-skill')
    const entries = await readdir(skillDir)
    expect(entries).not.toContain('postinstall-ran.txt')
    const nodeModules = join(skillDir, 'node_modules')
    const nmStat = await stat(nodeModules)
    expect(nmStat.isDirectory()).toBe(true)
  })
})
