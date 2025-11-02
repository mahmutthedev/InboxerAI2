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

export interface ThreadQAPayload {
  threadId: string
  question: string
  answer: string
  createdAt?: string | null
  ingestedAt?: string | null
}
type RawPayload = Record<string, unknown>

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

export async function fetchThreadQAPayloads(
  threadId: string
): Promise<ThreadQAPayload[]> {
  if (!threadId) {
    return []
  }

  const client = getQdrantClient()
  const collection = assertCollectionName()

  const results: ThreadQAPayload[] = []

  let pagination: unknown = undefined

  while (true) {
    const response = await client.scroll(collection, {
      limit: 64,
      offset: pagination ?? undefined,
      with_payload: true,
      with_vector: false,
      filter: {
        must: [
          {
            key: "threadId",
            match: {
              value: threadId,
            },
          },
        ],
      },
    })

    const points =
      "points" in response && Array.isArray(response.points)
        ? response.points
        : "result" in response && Array.isArray(response.result)
        ? response.result
        : []

    if (points?.length) {
      for (const point of points) {
        const parsed = parseThreadQAPayload(point?.payload ?? {}, threadId)
        if (parsed) {
          results.push(parsed)
        }
      }
    }

    const next =
      "next_page_offset" in response ? response.next_page_offset : undefined

    if (!next) {
      break
    }

    pagination = next
  }

  return results
}

export function parseThreadQAPayload(
  payload: RawPayload,
  fallbackThreadId?: string
): ThreadQAPayload | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const threadId =
    typeof payload.threadId === "string"
      ? payload.threadId
      : fallbackThreadId ?? ""

  const question =
    typeof payload.question === "string" ? payload.question.trim() : ""
  const answer =
    typeof payload.answer === "string" ? payload.answer.trim() : ""

  if (!threadId || !question || !answer) {
    return null
  }

  return {
    threadId,
    question,
    answer,
    createdAt:
      typeof payload.createdAt === "string" ? payload.createdAt : null,
    ingestedAt:
      typeof payload.ingestedAt === "string" ? payload.ingestedAt : null,
  }
}
