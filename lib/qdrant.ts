import { createHash } from "crypto"

import { QdrantClient } from "@qdrant/js-client-rest"

let cachedClient: QdrantClient | null = null

export function getQdrantClient() {
  if (cachedClient) {
    return cachedClient
  }

  const url = process.env.QDRANT_URL
  if (!url) {
    throw new Error("QDRANT_URL environment variable is not set")
  }

  const apiKey = process.env.QDRANT_API_KEY

  cachedClient = new QdrantClient({
    url,
    apiKey,
  })

  return cachedClient
}

export interface VectorRecord {
  id: string
  vector: number[]
  payload?: Record<string, unknown>
}

export function assertCollectionName() {
  const collection = process.env.QDRANT_COLLECTION
  if (!collection) {
    throw new Error("QDRANT_COLLECTION environment variable is not set")
  }

  return collection
}

export async function ensureQdrantCollection(
  client: QdrantClient,
  collection: string,
  vectorSize: number
) {
  try {
    const existing = await client.getCollection(collection)
    const existingSize =
      existing.result?.config?.params?.vectors?.size ??
      existing.result?.status?.vectors_count
    if (existingSize && existingSize !== vectorSize) {
      throw new Error(
        `Qdrant collection "${collection}" vector size (${existingSize}) does not match embedding size (${vectorSize}).`
      )
    }
    return
  } catch (error: any) {
    const statusCode =
      error?.response?.status ?? error?.status ?? error?.code ?? null
    const message = error?.response?.data?.status?.error ?? error?.message

    if (statusCode !== 404 && !String(message || "").includes("Not found")) {
      throw error
    }
  }

  await client.createCollection(collection, {
    vectors: {
      size: vectorSize,
      distance: "Cosine",
    },
  })
}

export function createStablePointId(threadId: string, question: string) {
  const hash = createHash("sha1")
    .update(`${threadId}:${question}`)
    .digest("hex")
    .slice(0, 32)

  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(
    12,
    16
  )}-${hash.slice(16, 20)}-${hash.slice(20)}`
}
