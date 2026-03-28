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
import {
  listIntegrations,
  getIntegration,
  enableIntegration,
  disableIntegration,
  removeIntegration,
  getEnabledIntegrations,
} from "../integrations/index.js";
import { oauthRoutes } from "./oauth.js";
import { keyVault } from "../vault/keyvault.js";

const config = loadConfig();

export async function createServer() {
  const app = Fastify({ logger: true });
  const dbRouter = new DBRouter();
  const assistant = new PersonalAssistant(dbRouter);

  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    allowList: (req) => !req.url.startsWith("/api/"),
  });

  // Global error handler — never leak internal details to clients
  app.setErrorHandler((error: any, req, reply) => {
    req.log.error(error);
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      return reply.code(500).send({ error: "Internal server error" });
    }
    return reply.code(status).send({ error: error.message ?? "Request failed" });
  });

  // Auth routes
  await app.register(authRoutes, { prefix: "/api/auth" });

  // Chat endpoint — streaming SSE (consumed by @ai-sdk/react useChat)
  app.post<{ Body: { messages: Array<{ role: string; content: string }> } }>(
    "/api/chat",
    async (req, reply) => {
      const session = await getIronSession<SessionData>(
        req.raw,
        reply.raw,
        SESSION_OPTIONS
      );

      if (!session.address || !session.encKey) {
        return reply.code(401).send({ error: "Unauthorized — wallet not unlocked" });
      }

      const { messages } = req.body;
      if (!messages?.length) {
        return reply.code(400).send({ error: "Messages are required" });
      }

      try {
        const result = await assistant.streamMessage(
          session.address,
          session.encKey,
          messages as any,
          session.integrationCredentials ?? {}
        );

        // Hand off to raw response for SSE streaming
        reply.hijack();
        result.pipeTextStreamToResponse(reply.raw);
      } catch (err) {
        req.log.error(err);
        return reply.code(500).send({ error: "Failed to process message" });
      }
    }
  );

  // OAuth routes
  await app.register(oauthRoutes, {
    prefix: "/api/integrations",
    dbRouter,
  } as any);

  // ── Integration management ──

  /** List all available integrations + which ones this user has enabled */
  app.get("/api/integrations", async (req, reply) => {
    const session = await getIronSession<SessionData>(
      req.raw,
      reply.raw,
      SESSION_OPTIONS
    );
    if (!session.address || !session.encKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const db = await dbRouter.getConnection(session.address, session.encKey);
    const enabled = await getEnabledIntegrations(db);
    const enabledIds = new Set(enabled.map((r) => r.integration_id));
    const creds = session.integrationCredentials ?? {};

    const available = listIntegrations().map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      credentialFields: def.credentialFields.map((f) => ({
        key: f.key,
        label: f.label,
        secret: f.secret,
      })),
      enabled: enabledIds.has(def.id),
      hasCredentials: !!creds[def.id],
    }));

    return { integrations: available };
  });

  /** Enable an integration and store its credentials in the session */
  app.post<{
    Body: {
      integrationId: string;
      credentials: Record<string, string>;
      config?: Record<string, unknown>;
    };
  }>("/api/integrations/enable", async (req, reply) => {
    const session = await getIronSession<SessionData>(
      req.raw,
      reply.raw,
      SESSION_OPTIONS
    );
    if (!session.address || !session.encKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { integrationId, credentials, config } = req.body;
    const definition = getIntegration(integrationId);
    if (!definition) {
      return reply.code(404).send({ error: `Unknown integration: ${integrationId}` });
    }

    // Store integration config in the user's encrypted DB
    const db = await dbRouter.getConnection(session.address, session.encKey);
    await enableIntegration(db, integrationId, config ?? {});

    // Store credentials in the session cookie (never on disk)
    if (!session.integrationCredentials) {
      session.integrationCredentials = {};
    }
    session.integrationCredentials[integrationId] = credentials;
    await session.save();

    return { ok: true, integrationId };
  });

  /** Disable an integration (keeps DB row, removes credentials from session) */
  app.post<{ Body: { integrationId: string } }>(
    "/api/integrations/disable",
    async (req, reply) => {
      const session = await getIronSession<SessionData>(
        req.raw,
        reply.raw,
        SESSION_OPTIONS
      );
      if (!session.address || !session.encKey) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const { integrationId } = req.body;
      const db = await dbRouter.getConnection(session.address, session.encKey);
      await disableIntegration(db, integrationId);

      // Remove credentials from session
      if (session.integrationCredentials) {
        delete session.integrationCredentials[integrationId];
        await session.save();
      }

      return { ok: true, integrationId };
    }
  );

  /** Remove an integration entirely (DB row + session credentials) */
  app.post<{ Body: { integrationId: string } }>(
    "/api/integrations/remove",
    async (req, reply) => {
      const session = await getIronSession<SessionData>(
        req.raw,
        reply.raw,
        SESSION_OPTIONS
      );
      if (!session.address || !session.encKey) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const { integrationId } = req.body;
      const db = await dbRouter.getConnection(session.address, session.encKey);
      await removeIntegration(db, integrationId);

      if (session.integrationCredentials) {
        delete session.integrationCredentials[integrationId];
        await session.save();
      }

      return { ok: true, integrationId };
    }
  );

  // ── Background task delegation ──

  /** Opt into background tasks — stores keys in TEE-resident vault */
  app.post("/api/delegate", async (req, reply) => {
    const session = await getIronSession<SessionData>(
      req.raw,
      reply.raw,
      SESSION_OPTIONS
    );
    if (!session.address || !session.encKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    keyVault.store(session.address, {
      encKey: session.encKey,
      integrationCredentials: session.integrationCredentials ?? {},
      delegatedAt: Date.now(),
    });

    return { ok: true, delegated: true };
  });

  /** Revoke background task delegation — removes keys from vault */
  app.post("/api/delegate/revoke", async (req, reply) => {
    const session = await getIronSession<SessionData>(
      req.raw,
      reply.raw,
      SESSION_OPTIONS
    );
    if (!session.address || !session.encKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    keyVault.delete(session.address);
    return { ok: true, delegated: false };
  });

  /** Check delegation status */
  app.get("/api/delegate/status", async (req, reply) => {
    const session = await getIronSession<SessionData>(
      req.raw,
      reply.raw,
      SESSION_OPTIONS
    );
    if (!session.address || !session.encKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const entry = keyVault.get(session.address);
    return {
      delegated: !!entry,
      delegatedAt: entry?.delegatedAt ?? null,
    };
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
