import { NextRequest, NextResponse } from "next/server"

import { registerGmailWatch } from "@/lib/google-auth"
import {
  getStoredGoogleAccount,
  listStoredGoogleAccounts,
  upsertStoredGoogleAccount,
} from "@/lib/account-store"
import { updateIngestState } from "@/lib/ingest-state"

interface WatchRequestBody {
  email?: string
  labelIds?: string[]
  labelFilterAction?: "include" | "exclude"
}

export async function POST(request: NextRequest) {
  const topicName = process.env.GMAIL_PUBSUB_TOPIC
  if (!topicName) {
    return NextResponse.json(
      { error: "GMAIL_PUBSUB_TOPIC environment variable is not set." },
      { status: 500 }
    )
  }

  let body: WatchRequestBody = {}
  try {
    body = await request.json()
  } catch {
    // body optional
  }

  const accounts = await listStoredGoogleAccounts()
  if (!accounts.length) {
    return NextResponse.json(
      {
        error:
          "No stored Google accounts found. Connect a Gmail account through the UI first.",
      },
      { status: 400 }
    )
  }

  const targetEmail = body.email?.toLowerCase() ?? accounts[0].email.toLowerCase()
  const account = await getStoredGoogleAccount(targetEmail)

  if (!account) {
    return NextResponse.json(
      {
        error: `Stored account for ${targetEmail} was not found.`,
      },
      { status: 404 }
    )
  }

  try {
    const watchResponse = await registerGmailWatch(account.tokens, {
      topicName,
      labelIds: body.labelIds,
      labelFilterAction: body.labelFilterAction ?? "include",
    })

    await upsertStoredGoogleAccount({
      email: account.email,
      tokens: account.tokens,
      profile: account.profile,
      gmail: account.gmail,
    })

    const registeredAt = new Date().toISOString()
    const expirationIso = watchResponse?.expiration
      ? new Date(Number(watchResponse.expiration)).toISOString()
      : null

    await updateIngestState({
      ...(watchResponse?.historyId
        ? { historyId: watchResponse.historyId }
        : {}),
      watchRegisteredAt: registeredAt,
      watchExpiration: expirationIso,
    })

    return NextResponse.json({
      success: true,
      email: account.email,
      topicName,
      historyId: watchResponse?.historyId ?? null,
      expiration: watchResponse?.expiration ?? null,
      labelIds: body.labelIds ?? null,
      watchRegisteredAt: registeredAt,
      watchExpiration: expirationIso,
    })
  } catch (error) {
    console.error("Failed to register Gmail watch", error)
    return NextResponse.json(
      {
        error:
          (error as Error).message ?? "Failed to register Gmail watch subscription.",
      },
      { status: 500 }
    )
  }
}



