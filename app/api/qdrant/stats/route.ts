import { NextResponse } from "next/server"

import {
  assertCollectionName,
  getQdrantClient,
} from "@/lib/qdrant"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const client = getQdrantClient()
    const collection = assertCollectionName()

    const response = await client.count(collection, { exact: true })
    const count = response.result?.count ?? 0

    return NextResponse.json({ collection, count })
  } catch (error: any) {
    const statusCode =
      error?.response?.status ?? error?.status ?? error?.code ?? null
    const message = error?.response?.data?.status?.error ?? error?.message

    if (statusCode === 404 || String(message || "").includes("Not found")) {
      return NextResponse.json({ collection: null, count: 0 })
    }

    console.error("Failed to fetch Qdrant stats", error)
    return NextResponse.json(
      { error: "Unable to retrieve Qdrant statistics." },
      { status: 500 }
    )
  }
}
