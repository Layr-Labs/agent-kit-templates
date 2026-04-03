import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type StreamTextResult,
  type UIMessage,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { VoyageAIClient } from "voyageai";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { loadConfig } from "../config/index.js";
import { DBRouter } from "../db/router.js";
import { vectorSearch, embedAndStore } from "../db/vector.js";
import { makeUserTools } from "./tools.js";
import { makeUITools } from "./ui-tools.js";
import { makeScheduleTools } from "./schedule-tools.js";
import {
  assembleIntegrationTools,
  type SessionCredentials,
} from "../integrations/index.js";
import { makeToolSearchTool } from "./tool-search.js";

const config = loadConfig();
const anthropic = createAnthropic();
const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGEAI_API_KEY });

function loadSoul(): string {
  const b64 = process.env.SOUL_MD_B64;
  if (b64) return Buffer.from(b64, "base64").toString("utf-8");
  return readFileSync(join(__dirname, "../../SOUL.md"), "utf-8");
}

function loadConstitution(): string {
  const b64 = process.env.CONSTITUTION_MD_B64;
  if (b64) return Buffer.from(b64, "base64").toString("utf-8");
  return readFileSync(join(__dirname, "../../constitution.md"), "utf-8");
}

// ── Static system prompt prefix (cacheable — identical across all requests) ──
const soul = loadSoul();
const constitution = loadConstitution();
const STATIC_SYSTEM_PREFIX = [soul, "", "## Constitution", constitution].join(
  "\n"
);

export class PersonalAssistant {
  constructor(private dbRouter: DBRouter) {}

  async streamMessage(
    address: string,
    encKey: string,
    messages: UIMessage[],
    integrationCredentials: SessionCredentials = {}
  ): Promise<StreamTextResult<any, any>> {
    const db = await this.dbRouter.getConnection(address, encKey);

    // Extract the user's latest query text
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    const queryText =
      lastUserMessage?.parts
        ?.filter(
          (p): p is { type: "text"; text: string } => p.type === "text"
        )
        .map((p) => p.text)
        .join(" ") ?? "";

    // ── #5: Embedding-based memory selection ──
    // Only inject memories relevant to the current query, not all of them.
    const allMemories = (await db
      .prepare("SELECT key, value FROM memories")
      .all()) as Array<{ key: string; value: string }>;

    let memoryText: string;
    if (allMemories.length <= 5) {
      // Few enough to include all
      memoryText = allMemories.map((m) => `- ${m.key}: ${m.value}`).join("\n");
    } else if (queryText) {
      // Select relevant memories by keyword matching against the query
      const queryLower = queryText.toLowerCase();
      const scored = allMemories.map((m) => {
        const text = `${m.key} ${m.value}`.toLowerCase();
        const score = queryLower.split(/\s+/).filter((w) => text.includes(w)).length;
        return { ...m, score };
      });
      scored.sort((a, b) => b.score - a.score);
      // Always include top 5 by relevance + any with score > 0
      const relevant = scored.filter((m, i) => i < 5 || m.score > 0);
      memoryText = relevant.map((m) => `- ${m.key}: ${m.value}`).join("\n");
    } else {
      memoryText = allMemories
        .slice(0, 5)
        .map((m) => `- ${m.key}: ${m.value}`)
        .join("\n");
    }

    // ── Semantic retrieval via Voyage embeddings ──
    let semanticText = "";
    if (queryText) {
      try {
        const queryEmbedding = await voyage.embed({
          input: [queryText],
          model: config.models.embed,
        });
        const docs = await vectorSearch(
          db,
          queryEmbedding.data![0].embedding!,
          5
        );
        if (docs.length) {
          semanticText = docs.map((d) => `- ${d.content}`).join("\n");
        }
      } catch {
        // Empty embeddings table on first interaction
      }
    }

    // ── #3: Lazy tool registration ──
    // Only assemble integration tools if the user has credentials.
    const userTools = makeUserTools(db);
    const uiTools = makeUITools(db, address, integrationCredentials);
    const scheduleTools = makeScheduleTools(db, address);

    const hasAnyCredentials = Object.keys(integrationCredentials).length > 0;
    console.log("[assistant] hasAnyCredentials:", hasAnyCredentials);
    const integrationTools = hasAnyCredentials
      ? await assembleIntegrationTools(db, integrationCredentials)
      : {};
    console.log("[assistant] integrationTools keys:", Object.keys(integrationTools));

    // ── #1: Custom tool search with deferred loading ──
    // Core tools (always loaded): memory, UI, web search, integration tools.
    // Integration tools are core because the model must see them directly to
    // use them — deferring caused Haiku to claim "I don't have a function"
    // even when the integration was connected.
    // Deferred tools (loaded on demand via search_tools): schedule tools.
    const coreTools: Record<string, any> = {
      ...userTools,
      ...uiTools,
      ...integrationTools,
      web_search: anthropic.tools.webSearch_20250305(),
    };

    const deferredTools: Record<string, any> = {
      ...scheduleTools,
    };

    // Mark deferred tools with providerOptions
    for (const t of Object.values(deferredTools)) {
      if (!t.providerOptions) t.providerOptions = {};
      t.providerOptions.anthropic = { deferLoading: true };
    }

    // Add the search tool (only if there are tools to search)
    if (Object.keys(deferredTools).length > 0) {
      coreTools.search_tools = makeToolSearchTool(deferredTools);
    }

    const allTools = { ...coreTools, ...deferredTools };

    // ── #4: Trim system prompt — only include non-empty sections ──
    const integrationToolNames = Object.keys(integrationTools);
    const dynamicSections: string[] = [];

    if (memoryText) {
      dynamicSections.push(`## Known facts about this user\n${memoryText}`);
    }
    if (semanticText) {
      dynamicSections.push(`## Relevant past context\n${semanticText}`);
    }
    if (integrationToolNames.length) {
      dynamicSections.push(
        `## Connected integrations\nTools available: ${integrationToolNames.join(", ")}`
      );
    } else {
      // Check if there are enabled integrations in the DB but no credentials
      // (session expired / server restarted)
      const enabledRows = await db
        .prepare("SELECT integration_id FROM integrations WHERE enabled = 1")
        .all() as Array<{ integration_id: string }>;
      const staleIntegrations = enabledRows.filter(
        (r) => !integrationCredentials[r.integration_id]
      );
      if (staleIntegrations.length) {
        dynamicSections.push(
          `## Connected integrations\nThe following integrations are enabled but need re-authorization (session expired): ${staleIntegrations.map((r) => r.integration_id).join(", ")}. ` +
          "Use show_integration_signin to prompt the user to re-authorize."
        );
      } else {
        dynamicSections.push(
          "## Connected integrations\nNone connected. Use show_integration_signin to prompt the user."
        );
      }
    }

    // ── #7: Prompt caching — static prefix is identical across all requests ──
    // Anthropic caches the system prompt prefix. The static part (SOUL + constitution)
    // is the same for every request and gets cached after the first call.
    // The dynamic part (memories, context, integrations) varies per request.
    const systemPrompt = [STATIC_SYSTEM_PREFIX, "", ...dynamicSections].join(
      "\n"
    );

    // ── #2: Conversation summarization ──
    // Instead of sending all 20 raw messages, summarize older messages into a
    // compact block and only send the last few verbatim.
    const normalized = messages.map((m) => ({
      ...m,
      parts: m.parts ?? [
        { type: "text" as const, text: (m as any).content ?? "" },
      ],
    }));

    const MAX_RECENT = 6; // Keep last 6 messages verbatim
    let modelMessages;
    if (normalized.length > MAX_RECENT) {
      const older = normalized.slice(0, -MAX_RECENT);
      const recent = normalized.slice(-MAX_RECENT);

      // Summarize older messages into a compact text block
      const summary = older
        .map((m) => {
          const text =
            m.parts
              ?.filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("") || (m as any).content || "";
          if (!text.trim()) return null;
          return `${m.role}: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`;
        })
        .filter(Boolean)
        .join("\n");

      const summaryMessage = {
        id: "summary",
        role: "assistant" as const,
        parts: [
          {
            type: "text" as const,
            text: `[Earlier conversation summary]\n${summary}`,
          },
        ],
      };

      modelMessages = await convertToModelMessages([
        summaryMessage as any,
        ...recent,
      ]);
    } else {
      modelMessages = await convertToModelMessages(normalized);
    }

    // ── Stream response ──
    const result = streamText({
      model: anthropic(config.models.chat),
      system: systemPrompt,
      messages: modelMessages,
      tools: allTools,
      stopWhen: stepCountIs(10),
      onError: (err) => {
        console.error("[assistant] Stream error:", err);
      },
      onFinish: async ({ text }) => {
        if (queryText && text) {
          const insertConv = db.prepare(
            "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
          );
          await insertConv.run(address, "user", queryText);
          await insertConv.run(address, "assistant", text);

          try {
            const embedding = await voyage.embed({
              input: [`User: ${queryText}\nAssistant: ${text}`],
              model: config.models.embed,
            });
            await embedAndStore(
              db,
              `User: ${queryText}\nAssistant: ${text}`,
              embedding.data![0].embedding!,
              { type: "conversation" }
            );
          } catch {
            // Non-critical
          }
        }
      },
    });

    return result;
  }
}
