/**
 * Smoke test for all skills-catalog entries.
 * Tests each skill's dist/index.mjs against live public APIs.
 *
 * Usage: node scripts/catalog-smoke-test.mjs
 */

import { resolve, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { readdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const catalogDir = resolve(__dirname, '../skills-catalog')

let passed = 0
let failed = 0
const failures = []

async function loadSkill(skillName) {
  const skillPath = resolve(catalogDir, skillName, 'dist', 'index.mjs')
  const mod = await import(pathToFileURL(skillPath).href + `?t=${Date.now()}`)
  return mod.default
}

async function testTool(skillName, toolName, input) {
  const label = `${skillName}/${toolName}`
  try {
    const skill = await loadSkill(skillName)
    if (!skill || typeof skill.init !== 'function') {
      throw new Error(`Skill "${skillName}" does not export a valid default with init()`)
    }

    const tools = await skill.init()
    const tool = tools[toolName]
    if (!tool) {
      throw new Error(`Tool "${toolName}" not found. Available: ${Object.keys(tools).join(', ')}`)
    }

    // tools from the 'ai' SDK have .execute
    const result = await tool.execute(input)
    const json = JSON.stringify(result, null, 2)

    if (result === null || result === undefined) throw new Error('Tool returned null/undefined')
    if (result.error) throw new Error(`Tool returned error: ${result.error}`)

    console.log(`✅ ${label} — OK (${json.length} chars)`)
    const preview = json.length < 500 ? json : json.slice(0, 400) + '...'
    console.log(`   ${preview.replace(/\n/g, '\n   ')}`)
    passed++
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`❌ ${label} — FAILED: ${message}`)
    failures.push(`${label}: ${message}`)
    failed++
  }
}

async function main() {
  console.log(`\nSmoke testing catalog skills...\n`)
  console.log('='.repeat(80))

  // ─── hackernews-reader ────────────────────────────────────
  console.log('\n📰 hackernews-reader')
  await testTool('hackernews-reader', 'search_hn', { query: 'javascript', max_results: 3, sort_by: 'relevance' })
  await testTool('hackernews-reader', 'get_hn_top_stories', { category: 'top', limit: 3 })
  await testTool('hackernews-reader', 'get_hn_item', { item_id: 1, comment_depth: 1 })

  // ─── github-reader ───────────────────────────────────────
  console.log('\n🐙 github-reader')
  await testTool('github-reader', 'search_github_repos', { query: 'react', max_results: 3, sort: 'best-match' })
  await testTool('github-reader', 'get_repo_readme', { owner: 'facebook', repo: 'react' })
  await testTool('github-reader', 'get_github_trending', { since: 'weekly', max_results: 3 })

  // ─── pubmed-reader ───────────────────────────────────────
  console.log('\n🧬 pubmed-reader')
  await testTool('pubmed-reader', 'search_pubmed', { query: 'CRISPR gene editing', max_results: 3, sort: 'relevance' })
  await testTool('pubmed-reader', 'get_pubmed_article', { pmid: '33782455' })

  // ─── wikipedia-reader ────────────────────────────────────
  console.log('\n📖 wikipedia-reader')
  await testTool('wikipedia-reader', 'search_wikipedia', { query: 'machine learning', max_results: 3, language: 'en' })
  await testTool('wikipedia-reader', 'get_wikipedia_summary', { title: 'Albert Einstein', language: 'en' })
  await testTool('wikipedia-reader', 'read_wikipedia_article', { title: 'Ethereum', language: 'en', sections_only: true })

  // ─── defillama-reader ────────────────────────────────────
  console.log('\n📊 defillama-reader')
  await testTool('defillama-reader', 'search_defi_protocols', { query: 'aave', max_results: 3 })
  await testTool('defillama-reader', 'get_protocol_tvl', { slug: 'aave', history_days: 7 })
  await testTool('defillama-reader', 'get_chain_tvl', { max_results: 5 })

  // ─── sec-filings ─────────────────────────────────────────
  console.log('\n📄 sec-filings')
  await testTool('sec-filings', 'search_sec_filings', { query: 'Apple', form_type: '10-K', max_results: 3 })
  await testTool('sec-filings', 'get_sec_filing_metadata', { ticker_or_cik: 'AAPL', form_type: '10-K', max_results: 3 })

  console.log('\n' + '='.repeat(80))
  console.log(`\n✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  if (failures.length > 0) {
    console.log('\nFailures:')
    failures.forEach(f => console.log(`  - ${f}`))
  }
  console.log('')

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
