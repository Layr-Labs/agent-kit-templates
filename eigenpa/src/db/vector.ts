import type { Database } from "@tursodatabase/database";

export interface VectorResult {
  content: string;
  metadata: Record<string, unknown>;
  distance: number;
}

/**
 * Brute-force cosine-distance nearest-neighbor search over the embeddings table.
 * Turso does not yet support ANN indexes — this is O(n) per query.
 */
export async function vectorSearch(
  db: Database,
  queryVec: number[],
  k: number
): Promise<VectorResult[]> {
  const vecLiteral = `[${queryVec.join(",")}]`;
  const rows = (await db
    .prepare(
      `SELECT content, metadata,
              vector_distance_cos(embedding, vector32(?)) AS distance
       FROM embeddings
       ORDER BY distance
       LIMIT ?`
    )
    .all(vecLiteral, k)) as Array<{
    content: string;
    metadata: string | null;
    distance: number;
  }>;

  return rows.map((row) => ({
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    distance: row.distance,
  }));
}

/**
 * Store a text chunk with its embedding vector and optional metadata.
 */
export async function embedAndStore(
  db: Database,
  content: string,
  embedding: number[],
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const vecLiteral = `[${embedding.join(",")}]`;
  await db
    .prepare(
      "INSERT INTO embeddings (content, embedding, metadata) VALUES (?, vector32(?), ?)"
    )
    .run(content, vecLiteral, JSON.stringify(metadata));
}
