import { tool } from 'ai'
import { z } from 'zod'

const EFTS_BASE = 'https://efts.sec.gov/LATEST'
const EDGAR_BASE = 'https://www.sec.gov'
const UA = 'media-agent-sec-filings/1.0 (research@example.com)'

async function edgarFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`SEC EDGAR ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

async function edgarFetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,text/plain',
    },
  })
  if (!res.ok) throw new Error(`SEC EDGAR ${res.status}: ${url}`)
  return res.text()
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<table[\s\S]*?<\/table>/gi, '[TABLE OMITTED]')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => `\n${'#'.repeat(Number(level))} ${content.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => `\n${content.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => `- ${content.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

interface EFTSSearchResult {
  hits: {
    hits: Array<{
      _id: string
      _source: {
        file_date: string
        display_date_filed: string
        entity_name: string
        file_num: string
        form_type: string
        file_description?: string
        period_of_report?: string
        biz_locations?: string
        inc_states?: string
      }
    }>
    total: { value: number }
  }
}

interface CompanyFiling {
  accessionNumber: string
  filingDate: string
  reportDate: string
  form: string
  primaryDocument: string
  primaryDocDescription: string
  size: number
}

interface CompanyFilingsResponse {
  cik: string
  entityType: string
  sic: string
  sicDescription: string
  name: string
  tickers: string[]
  exchanges: string[]
  filings: {
    recent: {
      accessionNumber: string[]
      filingDate: string[]
      reportDate: string[]
      form: string[]
      primaryDocument: string[]
      primaryDocDescription: string[]
      size: number[]
    }
  }
}

function formatAccessionNumber(accNum: string): string {
  return accNum.replace(/-/g, '')
}

const skill = {
  name: 'sec-filings',
  description: 'Search and read SEC EDGAR filings — 10-K, 10-Q, 8-K, S-1, and other public company disclosures',
  category: 'agent' as const,

  async init() {
    return {
      search_sec_filings: tool({
        description: 'Search SEC EDGAR for company filings. Search by company name, ticker, keywords, or form type (10-K, 10-Q, 8-K, S-1, etc.).',
        inputSchema: z.object({
          query: z.string().describe('Search query — company name, ticker, or keywords (e.g. "Apple", "TSLA", "artificial intelligence risk factors")'),
          form_type: z.string().optional().describe('Filter by form type (e.g. "10-K", "10-Q", "8-K", "S-1", "DEF 14A")'),
          date_from: z.string().optional().describe('Start date filter (YYYY-MM-DD)'),
          date_to: z.string().optional().describe('End date filter (YYYY-MM-DD)'),
          max_results: z.number().optional().default(10).describe('Maximum results'),
        }),
        execute: async ({ query, form_type, date_from, date_to, max_results }) => {
          const params = new URLSearchParams({
            q: query,
            dateRange: 'custom',
            startdt: date_from ?? '2020-01-01',
            enddt: date_to ?? new Date().toISOString().split('T')[0],
            forms: form_type ?? '',
          })

          const data = await edgarFetch<EFTSSearchResult>(`${EFTS_BASE}/search-index?${params}&from=0&size=${max_results}`)

          return {
            totalHits: data.hits.total.value,
            results: data.hits.hits.map(hit => {
              const src = hit._source
              return {
                accessionNumber: hit._id,
                entityName: src.entity_name,
                formType: src.form_type,
                filingDate: src.display_date_filed ?? src.file_date,
                periodOfReport: src.period_of_report ?? null,
                description: src.file_description ?? null,
                fileNumber: src.file_num,
                url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=${src.file_num}&type=${src.form_type}&dateb=&owner=include&count=10`,
              }
            }),
          }
        },
      }),

      get_sec_filing_metadata: tool({
        description: 'Get detailed metadata for a company\'s filings from SEC EDGAR. Uses the company CIK number or ticker to look up recent filings.',
        inputSchema: z.object({
          ticker_or_cik: z.string().describe('Company ticker (e.g. "AAPL") or CIK number (e.g. "0000320193")'),
          form_type: z.string().optional().describe('Filter by form type (e.g. "10-K")'),
          max_results: z.number().optional().default(10).describe('Maximum filings to return'),
        }),
        execute: async ({ ticker_or_cik, form_type, max_results }) => {
          // First resolve ticker to CIK
          const lookup = ticker_or_cik.toUpperCase()
          let cik: string

          if (/^\d+$/.test(lookup)) {
            cik = lookup.padStart(10, '0')
          } else {
            // Use company tickers endpoint
            const tickersRes = await fetch(`${EDGAR_BASE}/files/company_tickers.json`, {
              headers: { 'User-Agent': UA },
            })
            if (!tickersRes.ok) throw new Error(`Cannot resolve ticker: ${tickersRes.status}`)
            const tickers = await tickersRes.json() as Record<string, { cik_str: number; ticker: string; title: string }>
            const entry = Object.values(tickers).find(t => t.ticker === lookup)
            if (!entry) throw new Error(`Ticker not found: ${lookup}`)
            cik = String(entry.cik_str).padStart(10, '0')
          }

          const data = await edgarFetch<CompanyFilingsResponse>(
            `${EDGAR_BASE}/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40&search_text=&action=getcompany&output=atom`,
          ).catch(async () => {
            // Fallback to submissions API
            return edgarFetch<CompanyFilingsResponse>(`https://data.sec.gov/submissions/CIK${cik}.json`)
          })

          const recent = data.filings.recent
          const filings: CompanyFiling[] = []
          const len = Math.min(recent.accessionNumber.length, 40)

          for (let i = 0; i < len; i++) {
            if (form_type && recent.form[i] !== form_type) continue
            filings.push({
              accessionNumber: recent.accessionNumber[i],
              filingDate: recent.filingDate[i],
              reportDate: recent.reportDate[i],
              form: recent.form[i],
              primaryDocument: recent.primaryDocument[i],
              primaryDocDescription: recent.primaryDocDescription[i],
              size: recent.size[i],
            })
            if (filings.length >= max_results) break
          }

          return {
            cik,
            company: data.name,
            tickers: data.tickers ?? [],
            entityType: data.entityType,
            sic: data.sic,
            sicDescription: data.sicDescription,
            filings: filings.map(f => ({
              ...f,
              documentUrl: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${formatAccessionNumber(f.accessionNumber)}/${f.primaryDocument}`,
            })),
          }
        },
      }),

      read_sec_filing: tool({
        description: 'Read the full text of an SEC filing document. Fetches the HTML filing and extracts clean text. Best for 10-K, 10-Q, 8-K documents.',
        inputSchema: z.object({
          document_url: z.string().describe('Full URL to the SEC filing document (from get_sec_filing_metadata results)'),
          max_chars: z.number().optional().default(60000).describe('Maximum characters to return'),
        }),
        execute: async ({ document_url, max_chars }) => {
          if (!document_url.includes('sec.gov')) {
            return { error: 'URL must be from sec.gov' }
          }

          const html = await edgarFetchText(document_url)
          let text = stripHtml(html)

          if (text.length > max_chars) {
            text = text.slice(0, max_chars) + '\n\n[... truncated — filing exceeds character limit]'
          }

          return {
            url: document_url,
            contentLength: text.length,
            content: text,
          }
        },
      }),
    }
  },
}

export default skill
