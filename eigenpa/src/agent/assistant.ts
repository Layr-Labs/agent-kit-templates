import { generateText } from "ai";
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

  async handleMessage(
    address: string,
    encKey: string,
    message: string,
    integrationCredentials: SessionCredentials = {}
  ): Promise<string> {
    const db = await this.dbRouter.getConnection(address, encKey);

    // 1. Load structured memories
    const memories = (await db
      .prepare("SELECT key, value FROM memories")
      .all()) as Array<{ key: string; value: string }>;
    const memoryText =
      memories.map((m) => `- ${m.key}: ${m.value}`).join("\n") || "None yet.";

    // 2. Semantic retrieval via Voyage embeddings
    let semanticText = "None.";
    try {
      const queryEmbedding = await voyage.embed({
        input: [message],
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

    // 3. Load conversation history
    const historyRows = (await db
      .prepare(
        `SELECT role, content FROM conversations
         WHERE session_id = ?
         ORDER BY id DESC LIMIT 20`
      )
      .all(address)) as Array<{ role: string; content: string }>;
    historyRows.reverse();

    const messages: Array<{ role: "user" | "assistant"; content: string }> =
      historyRows.map((row) => ({
        role: row.role as "user" | "assistant",
        content: row.content,
      }));
    messages.push({ role: "user", content: message });

    // 4. Assemble tools: base user tools + enabled integration tools
    const userTools = makeUserTools(db);
    const integrationTools = await assembleIntegrationTools(
      db,
      integrationCredentials
    );
    const allTools = { ...userTools, ...integrationTools };

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
    ].join("\n");

    const { text } = await generateText({
      model: anthropic(config.models.agent),
      system: systemPrompt,
      messages,
      tools: allTools,
      maxSteps: 10,
    });

    // 5. Persist conversation turns
    const insertConv = db.prepare(
      "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)"
    );
    insertConv.run(address, "user", message);
    insertConv.run(address, "assistant", text);

    // 6. Embed exchange for future semantic retrieval
    try {
      const embedding = await voyage.embed({
        input: [`User: ${message}\nAssistant: ${text}`],
        model: config.models.embed,
      });
      embedAndStore(
        db,
        `User: ${message}\nAssistant: ${text}`,
        embedding.data![0].embedding!,
        { type: "conversation" }
      );
    } catch {
      // Non-critical — don't fail the response
    }

    return text;
  }
}
