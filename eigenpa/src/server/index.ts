import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import { getIronSession } from "iron-session";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { authRoutes, SESSION_OPTIONS, type SessionData } from "./auth.js";
import { DBRouter } from "../db/router.js";
import { PersonalAssistant } from "../agent/assistant.js";
import { loadConfig } from "../config/index.js";

const config = loadConfig();

export async function createServer() {
  const app = Fastify({ logger: true });
  const dbRouter = new DBRouter();
  const assistant = new PersonalAssistant(dbRouter);

  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });

  // Auth routes
  await app.register(authRoutes, { prefix: "/api/auth" });

  // Chat endpoint
  app.post<{ Body: { prompt: string } }>("/api/chat", async (req, reply) => {
    const session = await getIronSession<SessionData>(
      req.raw,
      reply.raw,
      SESSION_OPTIONS
    );

    if (!session.address || !session.encKey) {
      return reply.code(401).send({ error: "Unauthorized — wallet not unlocked" });
    }

    const { prompt } = req.body;
    if (!prompt?.trim()) {
      return reply.code(400).send({ error: "Prompt is required" });
    }

    const response = await assistant.handleMessage(
      session.address,
      session.encKey,
      prompt
    );

    return { response };
  });

  // Data deletion endpoint
  app.delete("/api/data", async (req, reply) => {
    const session = await getIronSession<SessionData>(
      req.raw,
      reply.raw,
      SESSION_OPTIONS
    );
    if (!session.address || !session.encKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    dbRouter.deleteUser(session.address);
    session.destroy();
    return { status: "deleted" };
  });

  // Health check
  app.get("/api/health", async () => ({ status: "ok" }));

  // Serve React SPA
  const sitePath = join(__dirname, "../../site/dist");
  await app.register(fastifyStatic, {
    root: sitePath,
    wildcard: false,
  });
  app.setNotFoundHandler((_req, reply) => {
    return reply.sendFile("index.html");
  });

  return { app, config };
}
