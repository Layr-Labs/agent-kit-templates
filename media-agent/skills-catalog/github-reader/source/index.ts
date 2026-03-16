import { tool } from 'ai'
import { z } from 'zod'

const API_BASE = 'https://api.github.com'
const UA = 'media-agent-github-reader/1.0'

interface GitHubRepo {
  id: number
  full_name: string
  name: string
  owner: { login: string }
  html_url: string
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  topics: string[]
  created_at: string
  updated_at: string
  pushed_at: string
  license: { spdx_id: string } | null
}

interface GitHubSearchResponse {
  total_count: number
  incomplete_results: boolean
  items: GitHubRepo[]
}

async function ghFetch<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Accept': 'application/vnd.github.v3+json',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, { headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

async function ghFetchText(url: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Accept': 'application/vnd.github.v3.raw',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  return res.text()
}

function formatRepo(repo: GitHubRepo) {
  return {
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner.login,
    url: repo.html_url,
    description: repo.description,
    language: repo.language,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    topics: repo.topics ?? [],
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    license: repo.license?.spdx_id ?? null,
  }
}

const skill = {
  name: 'github-reader',
  description: 'Search GitHub repositories, read READMEs, and discover trending projects',
  category: 'agent' as const,

  async init() {
    return {
      search_github_repos: tool({
        description: 'Search GitHub repositories by query. Supports filtering by language, minimum stars, and sort order.',
        inputSchema: z.object({
          query: z.string().describe('Search query (e.g. "machine learning", "react framework")'),
          language: z.string().optional().describe('Filter by programming language (e.g. "python", "typescript")'),
          min_stars: z.number().optional().describe('Minimum star count'),
          sort: z.enum(['stars', 'forks', 'updated', 'best-match']).optional().default('best-match').describe('Sort order'),
          max_results: z.number().optional().default(15).describe('Maximum results'),
        }),
        execute: async ({ query, language, min_stars, sort, max_results }) => {
          let q = query
          if (language) q += ` language:${language}`
          if (min_stars) q += ` stars:>=${min_stars}`

          const params = new URLSearchParams({
            q,
            sort: sort === 'best-match' ? '' : sort,
            order: 'desc',
            per_page: String(Math.min(max_results, 30)),
          })

          const data = await ghFetch<GitHubSearchResponse>(`${API_BASE}/search/repositories?${params}`)
          return {
            totalCount: data.total_count,
            results: data.items.map(formatRepo),
          }
        },
      }),

      get_repo_readme: tool({
        description: 'Get a GitHub repository\'s README content. Returns the raw markdown text.',
        inputSchema: z.object({
          owner: z.string().describe('Repository owner (e.g. "facebook")'),
          repo: z.string().describe('Repository name (e.g. "react")'),
        }),
        execute: async ({ owner, repo }) => {
          const readme = await ghFetchText(`${API_BASE}/repos/${owner}/${repo}/readme`)
          const truncated = readme.length > 30000 ? readme.slice(0, 30000) + '\n\n[... truncated — README exceeds 30k chars]' : readme

          let repoInfo
          try {
            repoInfo = await ghFetch<GitHubRepo>(`${API_BASE}/repos/${owner}/${repo}`)
          } catch {
            repoInfo = null
          }

          return {
            owner,
            repo,
            url: `https://github.com/${owner}/${repo}`,
            description: repoInfo?.description ?? null,
            stars: repoInfo?.stargazers_count ?? null,
            language: repoInfo?.language ?? null,
            readmeLength: readme.length,
            readme: truncated,
          }
        },
      }),

      get_github_trending: tool({
        description: 'Get trending GitHub repositories. Uses the search API to find recently created repos with high star velocity.',
        inputSchema: z.object({
          language: z.string().optional().describe('Filter by language (e.g. "python", "rust")'),
          since: z.enum(['daily', 'weekly', 'monthly']).optional().default('weekly').describe('Time range for trending'),
          max_results: z.number().optional().default(15).describe('Number of results'),
        }),
        execute: async ({ language, since, max_results }) => {
          const now = new Date()
          const daysBack = since === 'daily' ? 1 : since === 'weekly' ? 7 : 30
          const cutoff = new Date(now.getTime() - daysBack * 86400000)
          const dateStr = cutoff.toISOString().split('T')[0]

          let q = `created:>${dateStr}`
          if (language) q += ` language:${language}`

          const params = new URLSearchParams({
            q,
            sort: 'stars',
            order: 'desc',
            per_page: String(Math.min(max_results, 30)),
          })

          const data = await ghFetch<GitHubSearchResponse>(`${API_BASE}/search/repositories?${params}`)
          return {
            since,
            language: language ?? 'all',
            count: data.items.length,
            trending: data.items.map(formatRepo),
          }
        },
      }),
    }
  },
}

export default skill
