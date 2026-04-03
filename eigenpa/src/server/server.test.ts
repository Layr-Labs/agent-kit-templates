import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock voyageai and @ai-sdk/anthropic before any imports that use them
vi.mock("voyageai", () => ({
  VoyageAIClient: vi.fn().mockImplementation(() => ({
    embed: vi.fn().mockResolvedValue({ data: [{ embedding: [0, 0, 0] }] }),
  })),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({ text: "mocked response" }),
  tool: vi.fn().mockImplementation((opts) => opts),
}));

import { createServer } from "./index.js";
import type { FastifyInstance } from "fastify";

describe("server", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const result = await createServer();
    app = result.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/health", () => {
    it("returns 200 with status ok", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/health",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    });
  });

  describe("GET /api/auth/nonce", () => {
    it("returns a nonce string", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/nonce",
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("returns different nonces on subsequent calls", async () => {
      const res1 = await app.inject({ method: "GET", url: "/api/auth/nonce" });
      const res2 = await app.inject({ method: "GET", url: "/api/auth/nonce" });
      expect(res1.body).not.toBe(res2.body);
    });
  });

  describe("POST /api/auth/verify", () => {
    it("rejects invalid SIWE messages", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/verify",
        payload: {
          message: "not a valid siwe message",
          signature: "0x" + "00".repeat(65),
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe("POST /api/auth/unlock", () => {
    it("rejects without prior authentication", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/unlock",
        payload: { keySig: "0x" + "ab".repeat(65) },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /api/chat", () => {
    it("rejects without authentication", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        payload: { prompt: "hello" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("DELETE /api/data", () => {
    it("rejects without authentication", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/data",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("returns ok even without active session", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
