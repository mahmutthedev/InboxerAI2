import { NextRequest, NextResponse } from "next/server"

import { createGmailClient } from "@/lib/google-auth"
import {
  getStoredGoogleAccount,
  listStoredGoogleAccounts,
  upsertStoredGoogleAccount,
} from "@/lib/account-store"
import { updateIngestState } from "@/lib/ingest-state"

interface StopWatchRequestBody {
  email?: string
}

export async function POST(request: NextRequest) {
  let body: StopWatchRequestBody = {}
  try {
    body = await request.json()
  } catch {
    // optional body
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
      { error: `Stored account for ${targetEmail} was not found.` },
      { status: 404 }
    )
  }

  try {
    const gmail = createGmailClient(account.tokens)
    await gmail.users.stop({ userId: "me" })

    await upsertStoredGoogleAccount({
      email: account.email,
      tokens: account.tokens,
      profile: account.profile,
      gmail: account.gmail,
    })

    await updateIngestState({
      watchRegisteredAt: null,
      watchExpiration: null,
    })

    return NextResponse.json({
      success: true,
      email: account.email,
    })
  } catch (error) {
    console.error("Failed to stop Gmail watch", error)
    return NextResponse.json(
      {
        error:
          (error as Error).message ?? "Failed to stop Gmail watch subscription.",
      },
      { status: 500 }
    )
  }
}
