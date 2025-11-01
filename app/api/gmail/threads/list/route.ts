import { NextRequest, NextResponse } from "next/server"

import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  decodeOAuthSessionCookie,
  fetchAllGmailThreadIds,
} from "@/lib/google-auth"
import { readIngestState } from "@/lib/ingest-state"

interface ListRequestBody {
  maxThreads?: number
  labelIds?: string[]
}

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(GOOGLE_OAUTH_SESSION_COOKIE)
  if (!sessionCookie?.value) {
    return NextResponse.json(
      { error: "Not authenticated with Google." },
      { status: 401 }
    )
  }

  const session = decodeOAuthSessionCookie(sessionCookie.value)
  if (!session?.tokens) {
    return NextResponse.json(
      { error: "Not authenticated with Google." },
      { status: 401 }
    )
  }

  let body: ListRequestBody = {}
  try {
    body = await request.json()
  } catch {
    // optional body
  }

  const envMaxThreadsRaw = Number(
    process.env.INITIAL_INGEST_MAX_THREADS ?? "200"
  )
  const requestedMaxThreads =
    typeof body.maxThreads === "number" ? body.maxThreads : undefined

  const resolvedMaxThreads =
    typeof requestedMaxThreads === "number" &&
    Number.isFinite(requestedMaxThreads) &&
    requestedMaxThreads > 0
      ? requestedMaxThreads
      : Number.isFinite(envMaxThreadsRaw) && envMaxThreadsRaw > 0
      ? envMaxThreadsRaw
      : 200

  const maxThreads = Math.max(1, Math.floor(resolvedMaxThreads))

  try {
    const state = await readIngestState()
    const processedSet = new Set(state.processedThreadIds)

    const fetchLimit = maxThreads + processedSet.size + 200

    const candidates = await fetchAllGmailThreadIds(session.tokens, {
      maxThreads: fetchLimit,
      labelIds: body.labelIds,
    })

    const remaining = candidates.filter((id) => !processedSet.has(id))
    const threadIds = remaining.slice(0, maxThreads)

    return NextResponse.json({
      threadIds,
      total: threadIds.length,
      maxThreads,
      processedCount: processedSet.size,
    })
  } catch (error) {
    console.error("Failed to list Gmail threads", error)
    return NextResponse.json(
      { error: "Failed to list Gmail threads." },
      { status: 500 }
    )
  }
}
