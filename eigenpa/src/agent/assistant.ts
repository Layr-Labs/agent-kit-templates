import { streamText, type StreamTextResult, type Message } from "ai";
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

  /**
   * Stream a response to the user. Returns a StreamTextResult that can be
   * piped to an HTTP response via `result.pipeDataStreamToResponse(res)`.
   */
  async streamMessage(
    address: string,
    encKey: string,
    messages: Message[],
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
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : "";

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

    // 3. Assemble tools: base + UI + schedule + integrations
    const userTools = makeUserTools(db);
    const uiTools = makeUITools(db);
    const scheduleTools = makeScheduleTools(db, address);
    const integrationTools = await assembleIntegrationTools(
      db,
      integrationCredentials
    );
    const allTools = { ...userTools, ...uiTools, ...scheduleTools, ...integrationTools };

    // 4. Build system prompt
    const enabledIntegrationIds = Object.keys(integrationCredentials);
    const integrationStatus = enabledIntegrationIds.length
      ? `Enabled: ${enabledIntegrationIds.join(", ")}`
      : "None connected yet.";

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

    // 5. Stream response
    const result = streamText({
      model: anthropic(config.models.chat),
      system: systemPrompt,
      messages,
      tools: allTools,
      maxSteps: 10,
      onFinish: async ({ text }) => {
        // Persist conversation after stream completes
        if (queryText && text) {
          const insertConv = db.prepare(
            "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
          );
          await insertConv.run(address, "user", queryText);
          await insertConv.run(address, "assistant", text);

          // Embed for future retrieval
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
