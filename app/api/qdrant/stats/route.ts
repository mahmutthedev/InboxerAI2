import { NextResponse } from "next/server"

import { assertCollectionName } from "@/lib/qdrant"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const collection = assertCollectionName()
    const baseUrl = process.env.QDRANT_URL
    if (!baseUrl) {
      throw new Error("QDRANT_URL is not configured")
    }

    const url = new URL(`/collections/${encodeURIComponent(collection)}/points/count`, baseUrl)

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.QDRANT_API_KEY
          ? { Authorization: `Bearer ${process.env.QDRANT_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({}),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Qdrant count failed: ${response.status} ${text}`)
    }

    const data = await response.json()
    const count = data?.result?.count ?? 0

    return NextResponse.json({ collection, count })
  } catch (error: any) {
    const message = error?.message ?? "Unable to retrieve Qdrant statistics."
    console.error("Failed to fetch Qdrant stats", error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
