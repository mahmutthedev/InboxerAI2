import { NextRequest, NextResponse } from "next/server"

import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  decodeOAuthSessionCookie,
  fetchGmailThreadDetail,
} from "@/lib/google-auth"
import {
  extractQuestionsAndAnswersFromThread,
  type ThreadQAEntry,
} from "@/lib/openai"

interface SyncRequest {
  threadIds?: string[]
  instructions?: string
}

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(GOOGLE_OAUTH_SESSION_COOKIE)
  if (!sessionCookie?.value) {
    return NextResponse.json(
      { error: "Not authenticated with Google" },
      { status: 401 }
    )
  }

  const session = decodeOAuthSessionCookie(sessionCookie.value)

  if (!session?.tokens) {
    return NextResponse.json(
      { error: "Not authenticated with Google" },
      { status: 401 }
    )
  }

  let body: SyncRequest = {}
  try {
    body = await request.json()
  } catch (error) {
    // Ignore, we'll use defaults
  }

  const threadIds = (body.threadIds ?? []).slice(0, 10)

  if (!threadIds.length) {
    return NextResponse.json(
      { error: "No thread ids provided for processing." },
      { status: 400 }
    )
  }

  try {
    const results = await Promise.all(
      threadIds.map(async (threadId) => {
        const detail = await fetchGmailThreadDetail(session.tokens, threadId)
        const qa = await extractQuestionsAndAnswersFromThread(detail, {
          instructions: body.instructions,
        })

        return {
          threadId,
          subject: detail.subject,
          questions: qa,
        }
      })
    )

    const consolidated: ThreadQAEntry[] = results.flatMap((result) => result.questions)

    return NextResponse.json({
      processedThreads: results.length,
      consolidated,
      details: results,
    })
  } catch (error) {
    console.error("Failed to process Gmail threads", error)
    return NextResponse.json(
      { error: (error as Error).message ?? "Failed to process Gmail threads." },
      { status: 500 }
    )
  }
}
