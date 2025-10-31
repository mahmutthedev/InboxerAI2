import { NextRequest, NextResponse } from "next/server"

import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  decodeOAuthSessionCookie,
  fetchGmailThreadDetail,
} from "@/lib/google-auth"

interface RouteParams {
  threadId: string
}

export async function GET(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const threadId = params.threadId

  if (!threadId) {
    return NextResponse.json({ error: "Missing thread id" }, { status: 400 })
  }

  const sessionCookie = request.cookies.get(GOOGLE_OAUTH_SESSION_COOKIE)
  if (!sessionCookie?.value) {
    return NextResponse.json({ error: "Not authenticated with Google" }, { status: 401 })
  }

  const session = decodeOAuthSessionCookie(sessionCookie.value)

  if (!session?.tokens) {
    return NextResponse.json({ error: "Not authenticated with Google" }, { status: 401 })
  }

  try {
    console.log("[gmail thread] fetching detail", threadId)
    const detail = await fetchGmailThreadDetail(session.tokens, threadId)
    console.log("[gmail thread] fetched detail", threadId, detail.messages.length)
    return NextResponse.json(detail)
  } catch (error) {
    console.error("Failed to load Gmail thread detail", threadId, error)
    return NextResponse.json(
      { error: "Unable to load Gmail thread. Please try again." },
      { status: 500 }
    )
  }
}
