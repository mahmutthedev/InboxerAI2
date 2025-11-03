import { embedTexts } from "@/lib/openai"
import {
  ThreadQAPayload,
  assertCollectionName,
  fetchThreadQAPayloads,
  getQdrantClient,
  parseThreadQAPayload,
} from "@/lib/qdrant"

interface KnowledgeSearchOptions {
  limit?: number
  threadId?: string
}

export async function searchKnowledgeBase(
  query: string,
  { limit = 8, threadId }: KnowledgeSearchOptions = {}
): Promise<ThreadQAPayload[]> {
  if (!query?.trim()) {
    console.debug("[knowledge] Empty query received; skipping search.")
    return []
  }

  const embeddings = await embedTexts([query])
  const [vector] = embeddings

  if (!vector?.length) {
    console.warn("[knowledge] Unable to create embedding for query.")
    return []
  }

  const client = getQdrantClient()
  const collection = assertCollectionName()

  const filter =
    threadId && threadId.trim().length
      ? {
          must: [
            {
              key: "threadId",
              match: {
                value: threadId,
              },
            },
          ],
        }
      : undefined

  const response = await client.search(collection, {
    vector,
    limit,
    with_payload: true,
    filter,
  })
  console.debug("[knowledge] Qdrant search results", {
    returned: response.length,
    limit,
    hasFilter: Boolean(filter),
  })

  const results: ThreadQAPayload[] = []
  for (const point of response) {
    const parsed = parseThreadQAPayload(point.payload ?? {}, threadId)
    if (parsed) {
      results.push(parsed)
    }
  }

  return results
}

export { fetchThreadQAPayloads } from "@/lib/qdrant"
