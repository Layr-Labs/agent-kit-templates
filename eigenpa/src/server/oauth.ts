import type { FastifyInstance } from "fastify";
import { getIronSession } from "iron-session";
import { SESSION_OPTIONS, type SessionData } from "./auth.js";
import { DBRouter } from "../db/router.js";
import { enableIntegration, getIntegration } from "../integrations/index.js";

/**
 * OAuth configuration for Google APIs (Calendar + Gmail share the same OAuth flow).
 */
const GOOGLE_OAUTH = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: {
    "google-calendar":
      "https://www.googleapis.com/auth/calendar.readonly",
    gmail: "https://www.googleapis.com/auth/gmail.readonly",
  } as Record<string, string>,
};

function getGoogleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID ?? "";
}

function getGoogleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}

function getOAuthRedirectUri(req: any): string {
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  return `${proto}://${host}/api/integrations/oauth/callback`;
}

export async function oauthRoutes(
  app: FastifyInstance,
  opts: { dbRouter: DBRouter }
) {
  const { dbRouter } = opts;

  /**
   * Start OAuth flow — redirects the user to the provider's consent screen.
   */
  app.get<{ Params: { integrationId: string } }>(
    "/oauth/:integrationId/start",
    async (req, reply) => {
      const session = await getIronSession<SessionData>(
        req.raw,
        reply.raw,
        SESSION_OPTIONS
      );
      if (!session.address || !session.encKey) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const { integrationId } = req.params;
      const scope = GOOGLE_OAUTH.scopes[integrationId];
      if (!scope) {
        return reply.code(404).send({ error: `No OAuth flow for: ${integrationId}` });
      }

      const redirectUri = getOAuthRedirectUri(req);
      const state = JSON.stringify({ integrationId });

      const url = new URL(GOOGLE_OAUTH.authUrl);
      url.searchParams.set("client_id", getGoogleClientId());
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", scope);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", Buffer.from(state).toString("base64url"));

      return reply.redirect(url.toString());
    }
  );

  /**
   * OAuth callback — exchanges the authorization code for tokens,
   * stores them in the session, and enables the integration.
   */
  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/oauth/callback", async (req, reply) => {
    const session = await getIronSession<SessionData>(
      req.raw,
      reply.raw,
      SESSION_OPTIONS
    );
    if (!session.address || !session.encKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    if (req.query.error) {
      // User denied consent or an error occurred
      return reply.type("text/html").send(
        `<html><body><script>window.close();</script>
         <p>Authorization denied. You can close this window.</p></body></html>`
      );
    }

    const { code, state } = req.query;
    if (!code || !state) {
      return reply.code(400).send({ error: "Missing code or state" });
    }

    // Decode state to get integrationId
    let integrationId: string;
    try {
      const decoded = JSON.parse(
        Buffer.from(state, "base64url").toString("utf-8")
      );
      integrationId = decoded.integrationId;
    } catch {
      return reply.code(400).send({ error: "Invalid state" });
    }

    // Exchange code for tokens
    const redirectUri = getOAuthRedirectUri(req);
    const tokenRes = await fetch(GOOGLE_OAUTH.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: getGoogleClientId(),
        client_secret: getGoogleClientSecret(),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      req.log.error(`OAuth token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
      return reply.code(502).send({ error: "OAuth token exchange failed" });
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // Enable integration in the user's encrypted DB
    const db = await dbRouter.getConnection(session.address, session.encKey);
    await enableIntegration(db, integrationId);

    // Store tokens in session
    if (!session.integrationCredentials) {
      session.integrationCredentials = {};
    }
    session.integrationCredentials[integrationId] = {
      access_token: tokens.access_token,
      ...(tokens.refresh_token
        ? { refresh_token: tokens.refresh_token }
        : {}),
    };
    await session.save();

    // Close the popup and notify the parent window
    return reply.type("text/html").send(
      `<html><body><script>
        if (window.opener) {
          window.opener.postMessage({ type: "oauth_complete", integrationId: "${integrationId}" }, "*");
        }
        window.close();
      </script>
      <p>Connected! You can close this window.</p></body></html>`
    );
  });
}
