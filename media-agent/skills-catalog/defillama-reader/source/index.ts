import { tool } from 'ai'
import { z } from 'zod'

const API_BASE = 'https://api.llama.fi'
const YIELDS_BASE = 'https://yields.llama.fi'
const UA = 'media-agent-defillama-reader/1.0'

async function llamaFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`DefiLlama API ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

interface Protocol {
  id: string
  name: string
  slug: string
  url: string
  description: string
  chain: string
  chains: string[]
  category: string
  tvl: number
  change_1h: number | null
  change_1d: number | null
  change_7d: number | null
  mcap: number | null
  logo: string
  symbol: string
}

interface ProtocolDetail {
  id: string
  name: string
  url: string
  description: string
  chain: string
  chains: string[]
  category: string
  tvl: Array<{ date: number; totalLiquidityUSD: number }>
  chainTvls: Record<string, { tvl: Array<{ date: number; totalLiquidityUSD: number }> }>
  currentChainTvls: Record<string, number>
  mcap: number | null
  symbol: string
  audits: string
  audit_links: string[]
  gecko_id: string | null
  twitter: string | null
  forkedFrom: string[]
}

interface YieldPool {
  pool: string
  chain: string
  project: string
  symbol: string
  tvlUsd: number
  apyBase: number | null
  apyReward: number | null
  apy: number
  stablecoin: boolean
  ilRisk: string
  exposure: string
  poolMeta: string | null
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'N/A'
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  return `$${n.toFixed(2)}`
}

const skill = {
  name: 'defillama-reader',
  description: 'Read DeFi protocol data from DefiLlama — TVL, yields, chains, and protocol metadata',
  category: 'agent' as const,

  async init() {
    return {
      search_defi_protocols: tool({
        description: 'Search DeFi protocols by name. Returns protocol TVL, chain, category, and 24h/7d changes.',
        inputSchema: z.object({
          query: z.string().describe('Protocol name to search (e.g. "aave", "uniswap", "lido")'),
          max_results: z.number().optional().default(10).describe('Maximum results'),
        }),
        execute: async ({ query, max_results }) => {
          const protocols = await llamaFetch<Protocol[]>(`${API_BASE}/protocols`)
          const q = query.toLowerCase()
          const matches = protocols
            .filter(p =>
              p.name.toLowerCase().includes(q) ||
              p.symbol?.toLowerCase().includes(q) ||
              p.slug?.toLowerCase().includes(q),
            )
            .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
            .slice(0, max_results)

          return {
            query,
            count: matches.length,
            protocols: matches.map(p => ({
              name: p.name,
              slug: p.slug,
              symbol: p.symbol ?? null,
              chain: p.chain,
              chains: p.chains ?? [],
              category: p.category,
              tvl: p.tvl,
              tvlFormatted: formatNumber(p.tvl),
              change1d: p.change_1d,
              change7d: p.change_7d,
              url: p.url,
              logo: p.logo,
            })),
          }
        },
      }),

      get_protocol_tvl: tool({
        description: 'Get detailed TVL data and metadata for a specific DeFi protocol. Includes TVL history, chain breakdown, audit info, and links.',
        inputSchema: z.object({
          slug: z.string().describe('Protocol slug from DefiLlama (e.g. "aave", "uniswap", "lido")'),
          history_days: z.number().optional().default(30).describe('Number of days of TVL history to include'),
        }),
        execute: async ({ slug, history_days }) => {
          const data = await llamaFetch<ProtocolDetail>(`${API_BASE}/protocol/${slug}`)

          // Get last N days of TVL history
          const tvlHistory = (data.tvl ?? [])
            .slice(-history_days)
            .map(point => ({
              date: new Date(point.date * 1000).toISOString().split('T')[0],
              tvl: point.totalLiquidityUSD,
              tvlFormatted: formatNumber(point.totalLiquidityUSD),
            }))

          const currentTvl = tvlHistory.length > 0 ? tvlHistory[tvlHistory.length - 1].tvl : 0

          return {
            name: data.name,
            slug,
            symbol: data.symbol ?? null,
            description: data.description ?? '',
            url: data.url,
            chain: data.chain,
            chains: data.chains ?? [],
            category: data.category,
            currentTvl,
            currentTvlFormatted: formatNumber(currentTvl),
            chainBreakdown: data.currentChainTvls ?? {},
            mcap: data.mcap,
            mcapFormatted: formatNumber(data.mcap),
            geckoId: data.gecko_id,
            twitter: data.twitter,
            audits: data.audits,
            auditLinks: data.audit_links ?? [],
            forkedFrom: data.forkedFrom ?? [],
            tvlHistory,
          }
        },
      }),

      get_chain_tvl: tool({
        description: 'Get TVL data for blockchain chains. Without a specific chain, returns a ranking of all chains by TVL.',
        inputSchema: z.object({
          chain: z.string().optional().describe('Specific chain name (e.g. "Ethereum", "Solana", "Arbitrum"). Omit for all chains.'),
          max_results: z.number().optional().default(20).describe('Maximum chains to return (when listing all)'),
        }),
        execute: async ({ chain, max_results }) => {
          if (chain) {
            // Get historical TVL for a specific chain
            const data = await llamaFetch<Array<{ date: number; totalLiquidityUSD: number }>>(`${API_BASE}/v2/historicalChainTvl/${chain}`)
            const recent = data.slice(-30)
            return {
              chain,
              currentTvl: recent.length > 0 ? recent[recent.length - 1].totalLiquidityUSD : 0,
              currentTvlFormatted: formatNumber(recent.length > 0 ? recent[recent.length - 1].totalLiquidityUSD : 0),
              history: recent.map(point => ({
                date: new Date(point.date * 1000).toISOString().split('T')[0],
                tvl: point.totalLiquidityUSD,
              })),
            }
          }

          // Get all chains ranked by TVL
          const chains = await llamaFetch<Array<{ gecko_id: string; tvl: number; tokenSymbol: string; cmcId: string; name: string; chainId: number }>>(`${API_BASE}/v2/chains`)
          const sorted = chains.sort((a, b) => b.tvl - a.tvl).slice(0, max_results)

          return {
            count: sorted.length,
            chains: sorted.map((c, i) => ({
              rank: i + 1,
              name: c.name,
              tvl: c.tvl,
              tvlFormatted: formatNumber(c.tvl),
              tokenSymbol: c.tokenSymbol ?? null,
              geckoId: c.gecko_id ?? null,
            })),
          }
        },
      }),

      get_defi_yields: tool({
        description: 'Get yield/APY data across DeFi protocols and pools. Filter by chain, project, or minimum TVL.',
        inputSchema: z.object({
          chain: z.string().optional().describe('Filter by chain (e.g. "Ethereum", "Solana")'),
          project: z.string().optional().describe('Filter by project slug (e.g. "aave-v3", "uniswap-v3")'),
          stablecoins_only: z.boolean().optional().default(false).describe('Only show stablecoin pools'),
          min_tvl: z.number().optional().default(1000000).describe('Minimum pool TVL in USD'),
          sort_by: z.enum(['apy', 'tvl']).optional().default('tvl').describe('Sort by APY or TVL'),
          max_results: z.number().optional().default(20).describe('Maximum pools to return'),
        }),
        execute: async ({ chain, project, stablecoins_only, min_tvl, sort_by, max_results }) => {
          const data = await llamaFetch<{ data: YieldPool[] }>(`${YIELDS_BASE}/pools`)

          let pools = data.data

          if (chain) pools = pools.filter(p => p.chain.toLowerCase() === chain.toLowerCase())
          if (project) pools = pools.filter(p => p.project.toLowerCase() === project.toLowerCase())
          if (stablecoins_only) pools = pools.filter(p => p.stablecoin)
          pools = pools.filter(p => p.tvlUsd >= min_tvl)

          if (sort_by === 'apy') {
            pools.sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))
          } else {
            pools.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
          }

          pools = pools.slice(0, max_results)

          return {
            count: pools.length,
            pools: pools.map(p => ({
              pool: p.pool,
              project: p.project,
              chain: p.chain,
              symbol: p.symbol,
              tvl: p.tvlUsd,
              tvlFormatted: formatNumber(p.tvlUsd),
              apy: p.apy ? Number(p.apy.toFixed(2)) : null,
              apyBase: p.apyBase ? Number(p.apyBase.toFixed(2)) : null,
              apyReward: p.apyReward ? Number(p.apyReward.toFixed(2)) : null,
              stablecoin: p.stablecoin,
              ilRisk: p.ilRisk,
              exposure: p.exposure,
            })),
          }
        },
      }),
    }
  },
}

export default skill
