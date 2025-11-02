import { NextResponse } from "next/server"

import { getAccountsSummary } from "@/lib/accounts-api"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const accounts = await getAccountsSummary()
    return NextResponse.json({ accounts })
  } catch (error) {
    console.error("Failed to load stored Google accounts", error)
    return NextResponse.json(
      { error: "Unable to load stored Google accounts." },
      { status: 500 }
    )
  }
}
