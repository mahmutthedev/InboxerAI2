import { NextRequest, NextResponse } from "next/server"

import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  decodeOAuthSessionCookie,
  fetchGmailAccountProfile,
} from "@/lib/google-auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
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

  try {
    const profile = await fetchGmailAccountProfile(session.tokens)
    return NextResponse.json({
      emailAddress: profile.emailAddress,
      threadsTotal: profile.threadsTotal,
      messagesTotal: profile.messagesTotal,
      historyId: profile.historyId ?? null,
    })
  } catch (error) {
    console.error("Failed to refresh Gmail profile", error)
    return NextResponse.json(
      { error: "Failed to fetch Gmail profile." },
      { status: 500 }
    )
  }
}
