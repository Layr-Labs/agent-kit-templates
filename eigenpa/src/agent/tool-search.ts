import { tool } from "ai";
import { z } from "zod";

interface ToolEntry {
  name: string;
  description: string;
  paramNames: string[];
}

/**
 * Build a searchable index of tool names, descriptions, and parameter names.
 */
export function buildToolIndex(
  tools: Record<string, any>
): ToolEntry[] {
  return Object.entries(tools).map(([name, t]) => {
    const desc: string = t.description ?? "";
    // Extract parameter names from the inputSchema if available
    const schema = t.inputSchema ?? t.parameters;
    let paramNames: string[] = [];
    if (schema?.shape) {
      paramNames = Object.keys(schema.shape);
    } else if (schema?._def?.shape) {
      paramNames = Object.keys(schema._def.shape());
    }
    return { name, description: desc, paramNames };
  });
}

/**
 * BM25-inspired keyword search over the tool index.
 * Returns the top-k tools matching the query.
 */
function searchTools(
  index: ToolEntry[],
  query: string,
  k: number = 5
): string[] {
  const queryTerms = query
    .toLowerCase()
    .split(/[\s_\-]+/)
    .filter((t) => t.length > 1);

  if (!queryTerms.length) return index.slice(0, k).map((t) => t.name);

  const scored = index.map((entry) => {
    const searchText = [
      entry.name,
      entry.description,
      ...entry.paramNames,
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    for (const term of queryTerms) {
      // Exact substring match
      if (searchText.includes(term)) score += 2;
      // Partial match (prefix)
      if (
        entry.name.toLowerCase().includes(term) ||
        entry.paramNames.some((p) => p.toLowerCase().includes(term))
      ) {
        score += 3; // Boost name/param matches
      }
    }
    return { name: entry.name, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.name);
}

/**
 * Create the custom tool search tool.
 * When called, it returns tool_reference blocks that the Anthropic API
 * expands into full tool definitions (for tools marked with deferLoading).
 */
export function makeToolSearchTool(deferredTools: Record<string, any>) {
  const index = buildToolIndex(deferredTools);
  const toolNames = index.map((t) => t.name);

  return tool({
    description:
      `Search for available tools by keyword or description. Returns the most relevant tools. ` +
      `Use this BEFORE calling a tool you haven't used yet. ` +
      `Available tool categories: ${summarizeCategories(index)}`,
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Natural language search query describing what you want to do"
        ),
    }),
    execute: async ({ query }) => {
      const matches = searchTools(index, query);
      if (!matches.length) {
        return {
          message: "No tools matched your search.",
          available_categories: summarizeCategories(index),
        };
      }
      // Return tool_reference blocks — the API expands these into full definitions
      return matches.map((name) => ({
        type: "tool_reference" as const,
        tool_name: name,
      }));
    },
    // The search tool itself must NOT be deferred
  });
}

/**
 * Summarize tool categories for the search tool description.
 */
function summarizeCategories(index: ToolEntry[]): string {
  const categories = new Map<string, number>();
  for (const entry of index) {
    const prefix = entry.name.split("_")[0];
    categories.set(prefix, (categories.get(prefix) ?? 0) + 1);
  }
  return Array.from(categories.entries())
    .map(([cat, count]) => `${cat} (${count})`)
    .join(", ");
}
