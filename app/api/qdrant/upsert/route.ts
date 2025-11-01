import { NextRequest, NextResponse } from "next/server"

import {
  assertCollectionName,
  ensureQdrantCollection,
  getQdrantClient,
  createStablePointId,
} from "@/lib/qdrant"
import { embedTexts, type ThreadQAEntry } from "@/lib/openai"

interface UpsertRequestItem extends ThreadQAEntry {
  threadId: string
  createdAt?: string | null
}

interface UpsertRequestBody {
  items?: UpsertRequestItem[]
}

export async function POST(request: NextRequest) {
  let body: UpsertRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body provided." },
      { status: 400 }
    )
  }

  const items = body.items?.filter(
    (item): item is UpsertRequestItem =>
      Boolean(item?.threadId && item?.question && item?.answer)
  )

  if (!items?.length) {
    return NextResponse.json(
      { error: "No valid question/answer items provided." },
      { status: 400 }
    )
  }

  try {
    const client = getQdrantClient()
    const collection = assertCollectionName()

    const inputs = items.map(
      (item) => `Question: ${item.question}\nAnswer: ${item.answer}`
    )

    const embeddings = await embedTexts(inputs)

    if (!embeddings.length) {
      return NextResponse.json(
        { error: "Unable to generate embeddings for provided items." },
        { status: 500 }
      )
    }

    await ensureQdrantCollection(client, collection, embeddings[0].length)

    const points = items.map((item, index) => ({
      id: createStablePointId(item.threadId, item.question),
      vector: embeddings[index],
      payload: {
        threadId: item.threadId,
        question: item.question,
        answer: item.answer,
        createdAt: item.createdAt ?? null,
        ingestedAt: new Date().toISOString(),
      },
    }))

    await client.upsert(collection, { points, wait: true })

    return NextResponse.json({
      upserted: points.length,
      collection,
    })
  } catch (error) {
    console.error("Failed to upsert records into Qdrant", error)
    return NextResponse.json(
      {
        error:
          (error as Error).message ?? "Failed to upsert data into Qdrant.",
      },
      { status: 500 }
    )
  }
}
