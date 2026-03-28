import {
  generateText,
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

const soul = loadSoul();
const constitution = loadConstitution();

export class PersonalAssistant {
  constructor(private dbRouter: DBRouter) {}

  async streamMessage(
    address: string,
    encKey: string,
    messages: UIMessage[],
    integrationCredentials: SessionCredentials = {}
  ): Promise<StreamTextResult<any, any>> {
    const db = await this.dbRouter.getConnection(address, encKey);

    // 1. Load structured memories
    const memories = (await db
      .prepare("SELECT key, value FROM memories")
      .all()) as Array<{ key: string; value: string }>;
    const memoryText =
      memories.map((m) => `- ${m.key}: ${m.value}`).join("\n") || "None yet.";

    // 2. Semantic retrieval via Voyage embeddings
    let semanticText = "None.";
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

    // 3. Assemble tools
    const userTools = makeUserTools(db);
    const uiTools = makeUITools(db);
    const scheduleTools = makeScheduleTools(db, address);
    const integrationTools = await assembleIntegrationTools(
      db,
      integrationCredentials
    );

    // Separate tools that produce UI (rendered client-side) from data tools
    const dataTools = {
      ...userTools,
      ...scheduleTools,
      ...integrationTools,
      web_search: anthropic.tools.webSearch_20250305(),
    };
    const allTools = { ...dataTools, ...uiTools };

    // 4. Build system prompt
    const integrationToolNames = Object.keys(integrationTools);
    const integrationStatus = integrationToolNames.length
      ? `Connected (tools available): ${integrationToolNames.join(", ")}`
      : "None connected. Use show_integration_signin to prompt the user to connect one.";

    const systemPrompt = [
      soul,
      "",
      "## Constitution",
      constitution,
      "",
      "## Known facts about this user",
      memoryText,
      "",
      "## Relevant past context",
      semanticText,
      "",
      "## Connected integrations",
      integrationStatus,
    ].join("\n");

    // 5. Normalize messages
    const normalized = messages.map((m) => ({
      ...m,
      parts: m.parts ?? [
        { type: "text" as const, text: (m as any).content ?? "" },
      ],
    }));
    const modelMessages = await convertToModelMessages(normalized);

    // ── Phase 1: Tool execution (no user-facing text) ──
    // The LLM gathers data via tools but does NOT generate user-facing text.
    // This prevents contradictions like "I can't do that... actually here's the data."
    const { steps } = await generateText({
      model: anthropic(config.models.chat),
      system: [
        systemPrompt,
        "",
        "## Instructions for this phase",
        "You are in the TOOL EXECUTION phase. Gather all information needed to answer the user.",
        "- Call any tools you need (web search, calendar, email, memory, etc.)",
        "- Do NOT generate any user-facing text response.",
        "- Do NOT say 'I cannot' or 'I don't have access' — try your tools first.",
        "- When you have gathered enough information, stop.",
      ].join("\n"),
      messages: modelMessages,
      tools: dataTools,
      stopWhen: stepCountIs(8),
    });

    // Collect tool results
    const toolResultSummary: string[] = [];
    for (const step of steps) {
      for (const result of step.toolResults ?? []) {
        const r = result as any;
        const text =
          typeof r.result === "string"
            ? r.result
            : JSON.stringify(r.result);
        toolResultSummary.push(`[${r.toolName}]: ${text}`);
      }
    }

    // ── Phase 2: Synthesis (stream response + UI tool calls) ──
    // Generates the final response. Has access to UI tools (OAuth prompts, etc.)
    // so the client can render interactive components, but no data tools.
    const synthesisMessages = [
      ...modelMessages,
      ...(toolResultSummary.length
        ? [
            {
              role: "assistant" as const,
              content: `I gathered the following information:\n${toolResultSummary.join("\n")}`,
            },
          ]
        : []),
    ];

    const result = streamText({
      model: anthropic(config.models.chat),
      system: [
        systemPrompt,
        "",
        "## Instructions for this phase",
        "Generate a helpful response based on the information gathered above.",
        "- Be direct. Present the information clearly.",
        "- Do NOT say you searched or used tools — just present the results naturally.",
        "- Do NOT say 'I don't have access to X' if you already got results.",
        "- Use markdown formatting for readability (headings, bold, lists, tables).",
        "- If the user needs to connect an integration, call show_integration_signin.",
        "- If you need the user's location, call request_location.",
      ].join("\n"),
      messages: synthesisMessages,
      tools: uiTools,
      stopWhen: stepCountIs(3),
      onError: (err) => {
        console.error("[assistant] Synthesis stream error:", err);
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
