// skills-catalog/arxiv-reader/source/index.ts
import { tool } from "ai";
import { z } from "zod";
var skill = {
  name: "arxiv-reader",
  description: "Search and read full papers from ArXiv",
  category: "agent",
  async init() {
    return {
      search_arxiv: tool({
        description: "Search ArXiv for papers. Returns titles, IDs, abstracts, and categories.",
        inputSchema: z.object({
          query: z.string().describe('Search query (e.g. "transformer architecture", "galaxy classification neural network")'),
          categories: z.string().optional().describe('Comma-separated ArXiv categories to filter (e.g. "cs.LG,astro-ph.CO")'),
          max_results: z.number().optional().default(10).describe("Maximum number of results")
        }),
        execute: async ({ query, categories, max_results }) => {
          const params = new URLSearchParams({
            search_query: categories ? `all:${query} AND (${categories.split(",").map((c) => `cat:${c.trim()}`).join(" OR ")})` : `all:${query}`,
            start: "0",
            max_results: String(max_results),
            sortBy: "submittedDate",
            sortOrder: "descending"
          });
          const res = await fetch(`http://export.arxiv.org/api/query?${params}`);
          if (!res.ok)
            throw new Error(`ArXiv API error: ${res.status}`);
          const xml = await res.text();
          return parseArxivSearch(xml);
        }
      }),
      get_paper_metadata: tool({
        description: "Get metadata for a specific ArXiv paper by its ID.",
        inputSchema: z.object({
          arxiv_id: z.string().describe('ArXiv paper ID (e.g. "2310.12345" or "2310.12345v2")')
        }),
        execute: async ({ arxiv_id }) => {
          const cleanId = arxiv_id.replace("arxiv:", "").replace("http://arxiv.org/abs/", "").replace("https://arxiv.org/abs/", "");
          const res = await fetch(`http://export.arxiv.org/api/query?id_list=${cleanId}`);
          if (!res.ok)
            throw new Error(`ArXiv API error: ${res.status}`);
          const xml = await res.text();
          const results = parseArxivSearch(xml);
          if (results.length === 0)
            throw new Error(`Paper not found: ${arxiv_id}`);
          return results[0];
        }
      }),
      read_paper: tool({
        description: "Read the full text of an ArXiv paper. Fetches the HTML version and extracts the content including abstract, sections, and references.",
        inputSchema: z.object({
          arxiv_id: z.string().describe('ArXiv paper ID (e.g. "2310.12345")')
        }),
        execute: async ({ arxiv_id }) => {
          const cleanId = arxiv_id.replace("arxiv:", "").replace(/^https?:\/\/arxiv\.org\/(abs|html)\//, "");
          const htmlUrl = `https://arxiv.org/html/${cleanId}`;
          const res = await fetch(htmlUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; ArXivReader/1.0)" }
          });
          if (!res.ok) {
            const absRes = await fetch(`https://arxiv.org/abs/${cleanId}`, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; ArXivReader/1.0)" }
            });
            if (!absRes.ok)
              throw new Error(`Could not fetch paper ${arxiv_id}: ${absRes.status}`);
            const absHtml = await absRes.text();
            return {
              arxivId: cleanId,
              url: `https://arxiv.org/abs/${cleanId}`,
              format: "abstract-only",
              content: extractAbstractPage(absHtml)
            };
          }
          const html = await res.text();
          return {
            arxivId: cleanId,
            url: htmlUrl,
            format: "full-html",
            content: extractHtmlPaper(html)
          };
        }
      })
    };
  }
};
function parseArxivSearch(xml) {
  const entries = [];
  const entryMatches = xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
  for (const entryXml of entryMatches) {
    const id = extractTag(entryXml, "id")?.replace("http://arxiv.org/abs/", "") ?? "";
    const title = extractTag(entryXml, "title")?.replace(/\s+/g, " ").trim() ?? "";
    const abstract = extractTag(entryXml, "summary")?.replace(/\s+/g, " ").trim() ?? "";
    const published = extractTag(entryXml, "published") ?? "";
    const updated = extractTag(entryXml, "updated") ?? "";
    const authors = [];
    const authorMatches = entryXml.match(/<author[\s\S]*?<\/author>/gi) ?? [];
    for (const a of authorMatches) {
      const name = extractTag(a, "name");
      if (name)
        authors.push(name);
    }
    const categories = [];
    const catMatches = entryXml.match(/term="([^"]+)"/g) ?? [];
    for (const c of catMatches) {
      const term = c.match(/term="([^"]+)"/)?.[1];
      if (term)
        categories.push(term);
    }
    const cleanId = id.replace(/v\d+$/, "");
    entries.push({
      id: cleanId,
      title,
      authors,
      abstract,
      categories,
      published,
      updated,
      pdfUrl: `https://arxiv.org/pdf/${cleanId}`,
      htmlUrl: `https://arxiv.org/html/${cleanId}`
    });
  }
  return entries;
}
function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>(?:<![CDATA[)?(.*?)(?:]]>)?</${tag}>`, "is");
  const match = xml.match(regex);
  return match?.[1]?.trim();
}
function extractHtmlPaper(html) {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<nav[\s\S]*?<\/nav>/gi, "").replace(/<header[\s\S]*?<\/header>/gi, "").replace(/<footer[\s\S]*?<\/footer>/gi, "");
  const mainMatch = text.match(/<main[\s\S]*?<\/main>/i) ?? text.match(/<article[\s\S]*?<\/article>/i) ?? text.match(/<div class="ltx_page_content"[\s\S]*?<\/div>\s*<\/div>/i);
  if (mainMatch)
    text = mainMatch[0];
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => `
${"#".repeat(Number(level))} ${stripTags(content).trim()}
`).replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => `
${stripTags(content).trim()}
`).replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => `- ${stripTags(content).trim()}`).replace(/<br\s*\/?>/gi, `
`).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, `

`).trim();
  if (text.length > 60000) {
    text = text.slice(0, 60000) + `

[... truncated — paper exceeds 60k chars]`;
  }
  return text;
}
function extractAbstractPage(html) {
  const abstractMatch = html.match(/<blockquote class="abstract[^"]*">([\s\S]*?)<\/blockquote>/i);
  const abstract = abstractMatch ? stripTags(abstractMatch[1]).replace(/^\s*Abstract:\s*/i, "").trim() : "";
  const titleMatch = html.match(/<h1 class="title[^"]*">([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? stripTags(titleMatch[1]).replace(/^\s*Title:\s*/i, "").trim() : "";
  const authorsMatch = html.match(/<div class="authors">([\s\S]*?)<\/div>/i);
  const authors = authorsMatch ? stripTags(authorsMatch[1]).replace(/^\s*Authors:\s*/i, "").trim() : "";
  return `# ${title}

Authors: ${authors}

## Abstract

${abstract}

[Full HTML version may not be available for this paper. Try reading the PDF or check the ArXiv page directly.]`;
}
function stripTags(html) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
var source_default = skill;
export {
  source_default as default
};
