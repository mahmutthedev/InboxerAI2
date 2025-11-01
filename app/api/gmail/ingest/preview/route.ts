import { NextRequest, NextResponse } from "next/server"

import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  decodeOAuthSessionCookie,
  fetchAllGmailThreadIds,
  fetchGmailThreadDetail,
} from "@/lib/google-auth"
import { extractQuestionsAndAnswersFromThread } from "@/lib/openai"

interface PreviewRequestBody {
  instructions?: string
  maxThreads?: number
}

interface PreviewThread {
  threadId: string
  subject: string
  createdAt?: string | null
  messageCount: number
  questions: { question: string; answer: string }[]
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

  let body: PreviewRequestBody = {}
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
    })

    if (!threadIds.length) {
      return NextResponse.json({
        processedThreads: 0,
        threadsWithQuestions: 0,
        totalQuestions: 0,
        threads: [] as PreviewThread[],
      })
    }

    const resultThreads: PreviewThread[] = []
    let processedThreads = 0
    let threadsWithQuestions = 0
    let totalQuestions = 0

    for (const threadId of threadIds) {
      processedThreads += 1
      try {
        const detail = await fetchGmailThreadDetail(session.tokens, threadId)
        const qaPairs = await extractQuestionsAndAnswersFromThread(detail, {
          instructions: body.instructions,
        })

        if (!qaPairs.length) {
          continue
        }

        threadsWithQuestions += 1
        totalQuestions += qaPairs.length

        resultThreads.push({
          threadId,
          subject: detail.subject,
          createdAt: detail.createdAt ?? null,
          messageCount: detail.messageCount,
          questions: qaPairs,
        })
      } catch (error) {
        console.error("Failed to preview thread", threadId, error)
      }
    }

    return NextResponse.json({
      processedThreads,
      threadsWithQuestions,
      totalQuestions,
      threads: resultThreads,
      maxThreads,
    })
  } catch (error) {
    console.error("Failed to preview Gmail threads", error)
    return NextResponse.json(
      { error: "Failed to preview Gmail threads. Check server logs." },
      { status: 500 }
    )
  }
}
