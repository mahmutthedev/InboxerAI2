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

interface RouteParams {
  threadId: string
}

interface ThreadInstructionsPayload {
  instructions?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
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

  const threadId = params.threadId

  if (!threadId) {
    return NextResponse.json(
      { error: "Missing thread id" },
      { status: 400 }
    )
  }

  let payload: ThreadInstructionsPayload = {}
  try {
    payload = await request.json()
  } catch (error) {
    // ignore
  }

  try {
    const detail = await fetchGmailThreadDetail(session.tokens, threadId)
    const qa = await extractQuestionsAndAnswersFromThread(detail, {
      instructions: payload.instructions,
    })

    return NextResponse.json({
      threadId,
      subject: detail.subject,
      messageCount: detail.messageCount,
      createdAt: detail.createdAt ?? null,
      questions: qa,
    })
  } catch (error) {
    console.error("Failed to process Gmail thread for QA", threadId, error)
    return NextResponse.json(
      {
        error:
          (error as Error).message ??
          "Failed to extract questions for this thread.",
      },
      { status: 500 }
    )
  }
}
