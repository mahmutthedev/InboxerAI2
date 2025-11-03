import { NextRequest, NextResponse } from "next/server"

import { processGmailHistoryNotification } from "@/lib/gmail-automation"

interface PubSubEnvelope {
  message?: {
    data?: string
    messageId?: string
    publishTime?: string
    attributes?: Record<string, string>
  }
  subscription?: string
}

interface GmailHistoryNotification {
  emailAddress?: string
  historyId?: string
}

const VERIFICATION_TOKEN = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN ?? ""

function unauthorized(message: string) {
  return NextResponse.json({ error: message }, { status: 401 })
}

export async function POST(request: NextRequest) {
  console.info("[gmail-webhook] Incoming request", {
    url: request.nextUrl.toString(),
    token: request.nextUrl.searchParams.get("token") ?? null,
  })

  if (VERIFICATION_TOKEN) {
    const token = request.nextUrl.searchParams.get("token")
    if (!token || token !== VERIFICATION_TOKEN) {
      console.warn("[gmail-webhook] Invalid verification token", { token })
      return unauthorized("Invalid verification token.")
    }
  }

  let payload: PubSubEnvelope
  try {
    payload = await request.json()
  } catch (error) {
    console.error("Failed to parse Pub/Sub webhook payload", error)
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 })
  }

  if (!payload?.message?.data) {
    console.warn("[gmail-webhook] No message data in Pub/Sub payload", payload)
    return NextResponse.json(
      { error: "No Pub/Sub message data provided." },
      { status: 400 }
    )
  }

  let notification: GmailHistoryNotification | null = null
  try {
    const decoded = Buffer.from(payload.message.data, "base64").toString("utf8")
    notification = JSON.parse(decoded)
  } catch (error) {
    console.error("Failed to decode Gmail notification payload", error)
    return NextResponse.json(
      { error: "Unable to decode Gmail notification payload." },
      { status: 400 }
    )
  }

  if (!notification?.emailAddress || !notification.historyId) {
    console.warn("Incomplete Gmail notification payload received", notification)
    return NextResponse.json(
      { error: "Incomplete Gmail notification payload." },
      { status: 400 }
    )
  }

  console.info(
    "Received Gmail history notification",
    notification.emailAddress,
    notification.historyId
  )

  let processedSummary: { processed: number; details: string[] } = {
    processed: 0,
    details: [],
  }

  try {
    processedSummary = await processGmailHistoryNotification(
      notification.emailAddress,
      notification.historyId
    )
    console.info("[gmail-webhook] Processed history notification", {
      email: notification.emailAddress,
      historyId: notification.historyId,
      processedMessages: processedSummary.processed,
    })
  } catch (error) {
    console.error(
      "Failed to process Gmail history notification",
      notification,
      error
    )
    processedSummary.details.push(
      error instanceof Error ? error.message : "Processing error."
    )
  }

  return NextResponse.json(
    {
      success: true,
      emailAddress: notification.emailAddress,
      historyId: notification.historyId,
      messageId: payload.message?.messageId ?? null,
      processedMessages: processedSummary.processed,
      notes: processedSummary.details,
    },
    { status: 202 }
  )
}

export function GET(request: NextRequest) {
  if (VERIFICATION_TOKEN) {
    const token = request.nextUrl.searchParams.get("token")
    if (!token || token !== VERIFICATION_TOKEN) {
      return unauthorized("Invalid verification token.")
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
