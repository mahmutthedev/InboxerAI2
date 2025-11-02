import { NextRequest, NextResponse } from "next/server"

import {
  GOOGLE_OAUTH_SESSION_COOKIE,
  createDraftReply,
  decodeOAuthSessionCookie,
  fetchGmailThreadDetail,
} from "@/lib/google-auth"
import { searchKnowledgeBase } from "@/lib/knowledge"
import { generateReplyFromKnowledge } from "@/lib/openai"

interface IncomingRequestBody {
  threadId?: string
  fallbackMessage?: string
}

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(GOOGLE_OAUTH_SESSION_COOKIE)
  if (!sessionCookie?.value) {
    return NextResponse.json(
      { error: "Not authenticated with Google." },
      { status: 401 }
    )
  }

  const session = decodeOAuthSessionCookie(sessionCookie.value)
  if (!session?.tokens || !session.gmail?.emailAddress) {
    return NextResponse.json(
      { error: "Google session is missing required tokens." },
      { status: 401 }
    )
  }

  let body: IncomingRequestBody = {}
  try {
    body = await request.json()
  } catch {
    // empty body is allowed
  }

  const threadId = body.threadId?.trim()
  if (!threadId) {
    return NextResponse.json(
      { error: "threadId is required." },
      { status: 400 }
    )
  }

  try {
    const thread = await fetchGmailThreadDetail(session.tokens, threadId)
    const messages = thread.messages ?? []
    if (!messages.length) {
      return NextResponse.json(
        { error: "Thread has no messages available." },
        { status: 404 }
      )
    }

    const accountEmail = session.gmail.emailAddress.toLowerCase()
    const latestExternalMessage = [...messages]
      .reverse()
      .find(
        (message) =>
          message.from &&
          !message.from.toLowerCase().includes(accountEmail) &&
          message.bodyText?.trim()
      )

    const latestMessage = latestExternalMessage ?? messages[messages.length - 1]

    const queryText = [
      thread.subject ?? "",
      latestMessage.bodyText ?? "",
    ]
      .filter(Boolean)
      .join("\n")

    const qaPairs = await searchKnowledgeBase(queryText, { limit: 8 })

    const fallbackMessage = body.fallbackMessage?.trim() || "I don't know the answer."

    const replyBody = await generateReplyFromKnowledge({
      threadSubject: thread.subject ?? "Re: Your email",
      latestMessageFrom: latestMessage.from,
      latestMessageBody: latestMessage.bodyText ?? "",
      qaPairs,
      fallback: fallbackMessage,
    })

    const replySubject = thread.subject
      ? thread.subject.startsWith("Re:")
        ? thread.subject
        : `Re: ${thread.subject}`
      : "Re: Your email"

    const recipient = latestMessage.from ?? latestMessage.to ?? "recipient"

    await createDraftReply(session.tokens, {
      threadId,
      to: recipient,
      subject: replySubject,
      body: replyBody,
    })

    return NextResponse.json({
      success: true,
      threadId,
      usedKnowledgeCount: qaPairs.length,
      replyPreview: replyBody,
      fallbackUsed: qaPairs.length === 0 || replyBody === fallbackMessage,
    })
  } catch (error) {
    console.error("Failed to process incoming Gmail thread", error)
    return NextResponse.json(
      {
        error:
          (error as Error).message ??
          "Failed to generate draft for this Gmail thread.",
      },
      { status: 500 }
    )
  }
}
