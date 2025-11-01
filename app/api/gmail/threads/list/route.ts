import { NextRequest, NextResponse } from "next/server"

import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  decodeOAuthSessionCookie,
  fetchAllGmailThreadIds,
} from "@/lib/google-auth"

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

  const maxThreads =
    body.maxThreads ??
    Number(process.env.INITIAL_INGEST_MAX_THREADS ?? "200")

  try {
    const threadIds = await fetchAllGmailThreadIds(session.tokens, {
      maxThreads,
      labelIds: body.labelIds,
    })

    return NextResponse.json({
      threadIds,
      total: threadIds.length,
      maxThreads,
    })
  } catch (error) {
    console.error("Failed to list Gmail threads", error)
    return NextResponse.json(
      { error: "Failed to list Gmail threads." },
      { status: 500 }
    )
  }
}
