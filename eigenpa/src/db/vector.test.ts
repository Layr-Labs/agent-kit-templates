import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBRouter } from "./router.js";
import { vectorSearch, embedAndStore } from "./vector.js";
import { randomBytes } from "node:crypto";

function randomHexKey(): string {
  return randomBytes(32).toString("hex");
}

function randomAddress(): string {
  return "0xVecTest" + randomBytes(4).toString("hex");
}

describe("vector", () => {
  let router: DBRouter;
  let address: string;
  const key = randomHexKey();

  beforeEach(() => {
    router = new DBRouter({ skipEncryption: true });
    address = randomAddress();
  });

  afterEach(() => {
    router.deleteUser(address);
  });

  describe("embedAndStore", () => {
    it("inserts an embedding into the database", async () => {
      const db = await router.getConnection(address, key);
      const embedding = [1.0, 2.0, 3.0, 4.0];

      await embedAndStore(db, "test content", embedding, { type: "test" });

      const rows = (await db
        .prepare("SELECT content, metadata FROM embeddings")
        .all()) as Array<{ content: string; metadata: string }>;

      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe("test content");
      expect(JSON.parse(rows[0].metadata)).toEqual({ type: "test" });
    });

    it("stores multiple embeddings", async () => {
      const db = await router.getConnection(address, key);

      await embedAndStore(db, "first", [1, 0, 0, 0], {});
      await embedAndStore(db, "second", [0, 1, 0, 0], {});
      await embedAndStore(db, "third", [0, 0, 1, 0], {});

      const rows = (await db
        .prepare("SELECT COUNT(*) as c FROM embeddings")
        .all()) as Array<{ c: number }>;
      expect(rows[0].c).toBe(3);
    });

    it("stores empty metadata", async () => {
      const db = await router.getConnection(address, key);
      await embedAndStore(db, "no meta", [1, 0, 0, 0]);

      const rows = (await db
        .prepare("SELECT metadata FROM embeddings")
        .all()) as Array<{ metadata: string }>;
      expect(JSON.parse(rows[0].metadata)).toEqual({});
    });
  });

  describe("vectorSearch", () => {
    it("returns results ordered by cosine distance", async () => {
      const db = await router.getConnection(address, key);

      const baseVec = [1.0, 0.0, 0.0, 0.0];
      const similarVec = [0.9, 0.1, 0.0, 0.0];
      const differentVec = [0.0, 0.0, 0.0, 1.0];

      await embedAndStore(db, "different", differentVec, {});
      await embedAndStore(db, "similar", similarVec, {});
      await embedAndStore(db, "exact", baseVec, {});

      const results = await vectorSearch(db, baseVec, 3);

      expect(results).toHaveLength(3);
      expect(results[0].content).toBe("exact");
      expect(results[1].content).toBe("similar");
      expect(results[2].content).toBe("different");
    });

    it("respects the k limit", async () => {
      const db = await router.getConnection(address, key);

      for (let i = 0; i < 10; i++) {
        await embedAndStore(
          db,
          `doc-${i}`,
          [Math.sin(i), Math.cos(i), 0, 0],
          {}
        );
      }

      const results = await vectorSearch(db, [1, 0, 0, 0], 3);
      expect(results).toHaveLength(3);
    });

    it("returns parsed metadata", async () => {
      const db = await router.getConnection(address, key);
      await embedAndStore(db, "with meta", [1, 0, 0, 0], {
        type: "conversation",
        session: "abc",
      });

      const results = await vectorSearch(db, [1, 0, 0, 0], 1);

      expect(results[0].metadata).toEqual({
        type: "conversation",
        session: "abc",
      });
    });

    it("returns empty array when no embeddings exist", async () => {
      const db = await router.getConnection(address, key);
      const results = await vectorSearch(db, [1, 0, 0, 0], 5);
      expect(results).toEqual([]);
    });

    it("includes distance scores", async () => {
      const db = await router.getConnection(address, key);
      await embedAndStore(db, "doc", [1.0, 0.0, 0.0, 0.0], {});

      const results = await vectorSearch(db, [1.0, 0.0, 0.0, 0.0], 1);
      expect(results[0].distance).toBeCloseTo(0, 5);
    });
  });
});
