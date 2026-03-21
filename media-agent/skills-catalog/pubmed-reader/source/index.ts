import { tool } from 'ai'
import { z } from 'zod'

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const PMC_OA_BASE = 'https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi'
const UA = 'media-agent-pubmed-reader/1.0'

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = xml.match(regex)
  return match ? decodeXmlEntities(match[1].trim()) : ''
}

function extractAllTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const results: string[] = []
  let m
  while ((m = regex.exec(xml)) !== null) results.push(m[1].trim())
  return results
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/\s+/g, ' ')
    .trim()
}

function parseArticle(articleXml: string): {
  pmid: string
  title: string
  authors: string[]
  journal: string
  pubDate: string
  abstract: string
  doi: string | null
  pmcId: string | null
  meshTerms: string[]
  keywords: string[]
  pubTypes: string[]
} {
  const pmid = extractTag(articleXml, 'PMID')
  const title = stripTags(extractTag(articleXml, 'ArticleTitle'))

  const authorBlocks = extractAllTags(articleXml, 'Author')
  const authors = authorBlocks.map(a => {
    const last = extractTag(a, 'LastName')
    const first = extractTag(a, 'ForeName')
    return first ? `${first} ${last}` : last
  }).filter(Boolean)

  const journal = stripTags(extractTag(articleXml, 'Title'))
  const year = extractTag(articleXml, 'Year')
  const month = extractTag(articleXml, 'Month')
  const pubDate = month ? `${year}-${month}` : year

  const abstractTexts = extractAllTags(articleXml, 'AbstractText')
  const abstract = abstractTexts.map(t => stripTags(t)).join('\n\n')

  const articleIdBlocks = extractAllTags(articleXml, 'ArticleId')
  // Re-extract with attributes to get IdType
  const doiMatch = articleXml.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/i)
  const pmcMatch = articleXml.match(/<ArticleId IdType="pmc">([^<]+)<\/ArticleId>/i)

  const meshBlocks = extractAllTags(articleXml, 'DescriptorName')
  const meshTerms = meshBlocks.map(m => stripTags(m))

  const keywords = extractAllTags(articleXml, 'Keyword').map(k => stripTags(k))

  const pubTypes = extractAllTags(articleXml, 'PublicationType').map(p => stripTags(p))

  return {
    pmid,
    title,
    authors,
    journal,
    pubDate,
    abstract,
    doi: doiMatch?.[1] ?? null,
    pmcId: pmcMatch?.[1] ?? null,
    meshTerms,
    keywords,
    pubTypes,
  }
}

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`NCBI API error: ${res.status}`)
  return res.text()
}

const skill = {
  name: 'pubmed-reader',
  description: 'Search and read biomedical literature from PubMed and PubMed Central',
  category: 'agent' as const,

  async init() {
    return {
      search_pubmed: tool({
        description: 'Search PubMed for biomedical articles. Returns PMIDs with basic metadata. Use get_pubmed_article for full details.',
        inputSchema: z.object({
          query: z.string().describe('Search query (e.g. "CRISPR gene therapy", "covid-19 vaccine efficacy")'),
          max_results: z.number().optional().default(10).describe('Maximum number of results'),
          sort: z.enum(['relevance', 'date']).optional().default('relevance').describe('Sort order'),
          date_from: z.string().optional().describe('Start date filter (YYYY/MM/DD)'),
          date_to: z.string().optional().describe('End date filter (YYYY/MM/DD)'),
        }),
        execute: async ({ query, max_results, sort, date_from, date_to }) => {
          const searchParams = new URLSearchParams({
            db: 'pubmed',
            term: query,
            retmax: String(max_results),
            retmode: 'json',
            sort: sort === 'date' ? 'date' : 'relevance',
            usehistory: 'y',
          })
          if (date_from) searchParams.set('datetype', 'pdat')
          if (date_from) searchParams.set('mindate', date_from)
          if (date_to) searchParams.set('maxdate', date_to)

          const searchRes = await fetch(`${EUTILS_BASE}/esearch.fcgi?${searchParams}`, { headers: { 'User-Agent': UA } })
          if (!searchRes.ok) throw new Error(`PubMed search error: ${searchRes.status}`)
          const searchData = await searchRes.json() as { esearchresult: { idlist: string[]; count: string; webenv: string; querykey: string } }

          const ids = searchData.esearchresult.idlist
          if (ids.length === 0) return { totalCount: parseInt(searchData.esearchresult.count, 10), results: [] }

          // Fetch summaries for all returned IDs
          const summaryParams = new URLSearchParams({
            db: 'pubmed',
            id: ids.join(','),
            retmode: 'json',
          })
          const summaryRes = await fetch(`${EUTILS_BASE}/esummary.fcgi?${summaryParams}`, { headers: { 'User-Agent': UA } })
          // PubMed occasionally returns JSON with control characters — strip them before parsing
          const summaryText = (await summaryRes.text()).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
          const summaryData = JSON.parse(summaryText) as { result: Record<string, any> }

          const results = ids.map(id => {
            const doc = summaryData.result?.[id]
            if (!doc) return { pmid: id, title: '', authors: [], source: '', pubDate: '' }
            return {
              pmid: id,
              title: decodeXmlEntities(doc.title ?? ''),
              authors: (doc.authors ?? []).map((a: any) => decodeXmlEntities(a.name)),
              source: doc.source ?? '',
              pubDate: doc.pubdate ?? '',
              doi: doc.elocationid ?? null,
              url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
            }
          })

          return {
            totalCount: parseInt(searchData.esearchresult.count, 10),
            results,
          }
        },
      }),

      get_pubmed_article: tool({
        description: 'Get full metadata and abstract for a PubMed article by its PMID. Returns title, authors, journal, abstract, MeSH terms, keywords, and DOI.',
        inputSchema: z.object({
          pmid: z.string().describe('PubMed ID (e.g. "33782455")'),
        }),
        execute: async ({ pmid }) => {
          const cleanId = pmid.replace(/^pmid:/i, '').trim()
          const xml = await fetchXml(`${EUTILS_BASE}/efetch.fcgi?db=pubmed&id=${cleanId}&retmode=xml`)

          const articleMatch = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/i)
          if (!articleMatch) return { error: `Article not found: ${cleanId}` }

          const article = parseArticle(articleMatch[0])
          return {
            ...article,
            url: `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`,
            pmcUrl: article.pmcId ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${article.pmcId}/` : null,
          }
        },
      }),

      read_pmc_fulltext: tool({
        description: 'Read the full text of an open-access article from PubMed Central (PMC). Only works for articles with a PMC ID.',
        inputSchema: z.object({
          pmc_id: z.string().describe('PubMed Central ID (e.g. "PMC8042725" or "8042725")'),
        }),
        execute: async ({ pmc_id }) => {
          const cleanId = pmc_id.replace(/^PMC/i, '')
          const pmcId = `PMC${cleanId}`

          // Fetch the full article XML from PMC
          const xml = await fetchXml(`${EUTILS_BASE}/efetch.fcgi?db=pmc&id=${cleanId}&retmode=xml`)

          // Extract article body sections
          const bodyMatch = xml.match(/<body[\s\S]*?<\/body>/i)
          if (!bodyMatch) {
            // Try to get at least the abstract
            const abstractMatch = xml.match(/<abstract[\s\S]*?<\/abstract>/i)
            const titleMatch = xml.match(/<article-title>([^<]+)<\/article-title>/i)
            return {
              pmcId,
              url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId}/`,
              format: 'abstract-only',
              title: titleMatch?.[1] ?? '',
              content: abstractMatch ? stripTags(abstractMatch[0]) : 'Full text not available for this article.',
            }
          }

          const title = extractTag(xml, 'article-title')

          // Extract sections with headings
          let content = bodyMatch[0]

          // Convert section titles to markdown headings
          content = content
            .replace(/<title>([^<]*)<\/title>/gi, '\n## $1\n')
            .replace(/<sec[\s\S]*?<\/sec>/gi, (match) => {
              return stripTags(match)
            })

          // If the section-based extraction didn't work well, fall back to tag stripping
          if (content.length < 100) {
            content = stripTags(bodyMatch[0])
          } else {
            content = stripTags(content)
          }

          // Truncate very long articles
          if (content.length > 60000) {
            content = content.slice(0, 60000) + '\n\n[... truncated — article exceeds 60k chars]'
          }

          return {
            pmcId,
            url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId}/`,
            format: 'full-text',
            title: stripTags(title),
            contentLength: content.length,
            content,
          }
        },
      }),
    }
  },
}

export default skill
