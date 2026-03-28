import type { FastifyInstance } from "fastify";
import { SiweMessage, generateNonce } from "siwe";
import { getIronSession } from "iron-session";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { verifyMessage } from "viem";
import { loadConfig } from "../config/index.js";

const config = loadConfig();

export interface SessionData {
  nonce?: string;
  address?: string;
  encKey?: string;
}

export const SESSION_OPTIONS = {
  cookieName: config.session.cookie_name,
  password: process.env.SESSION_SECRET!,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: config.session.ttl_hours * 60 * 60,
  },
};

function deriveEncryptionKey(signature: string, address: string): string {
  const ikm = Buffer.from(signature.slice(2), "hex");
  const salt = Buffer.from(address.toLowerCase());
  const info = Buffer.from("turso-db-key");
  const derived = hkdf(sha256, ikm, salt, info, 32);
  return bytesToHex(derived);
}

export function keyDerivationMessage(address: string): string {
  return [
    "Derive encryption key for EigenPA",
    `Address: ${address}`,
    "Version: 1",
  ].join("\n");
}

async function getSession(req: any, reply: any) {
  return getIronSession<SessionData>(req.raw, reply.raw, SESSION_OPTIONS);
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/nonce", async (req, reply) => {
    const session = await getSession(req, reply);
    session.nonce = generateNonce();
    await session.save();
    return reply.send(session.nonce);
  });

  app.post<{ Body: { message: string; signature: string } }>(
    "/verify",
    async (req, reply) => {
      const { message, signature } = req.body;
      const session = await getSession(req, reply);

      const siweMessage = new SiweMessage(message);
      const { data } = await siweMessage.verify({
        signature,
        nonce: session.nonce,
      });

      session.address = data.address;
      session.nonce = undefined;
      await session.save();

      return { address: data.address };
    }
  );

  app.post<{ Body: { keySig: string } }>("/unlock", async (req, reply) => {
    const session = await getSession(req, reply);
    if (!session.address) {
      return reply.code(401).send({ error: "Not authenticated" });
    }

    const { keySig } = req.body;
    const message = keyDerivationMessage(session.address);

    const valid = await verifyMessage({
      address: session.address as `0x${string}`,
      message,
      signature: keySig as `0x${string}`,
    });

    if (!valid) {
      return reply.code(403).send({ error: "Invalid key signature" });
    }

    session.encKey = deriveEncryptionKey(keySig, session.address);
    await session.save();

    return { ok: true };
  });

  app.post("/logout", async (req, reply) => {
    const session = await getSession(req, reply);
    session.destroy();
    return { ok: true };
  });

  app.get("/me", async (req, reply) => {
    const session = await getSession(req, reply);
    if (!session.address || !session.encKey) {
      return reply.code(401).send({ address: null });
    }
    return { address: session.address };
  });
}
