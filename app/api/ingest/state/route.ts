import { NextRequest, NextResponse } from "next/server"

import {
  addProcessedThreads,
  readIngestState,
  summarizeState,
  updateIngestState,
} from "@/lib/ingest-state"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const state = await readIngestState()
    return NextResponse.json(summarizeState(state))
  } catch (error) {
    console.error("Failed to read ingest state", error)
    return NextResponse.json(
      { error: "Unable to read ingest state." },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const {
      processedThreadIds,
      historyId,
      totalThreadsDetected,
      lastFullIngestAt,
      lastPreviewAt,
      rules,
      previewMaxThreads,
      replyInstructions,
      watchRegisteredAt,
      watchExpiration,
    } = body as {
      processedThreadIds?: string[]
      historyId?: string
      totalThreadsDetected?: number
      lastFullIngestAt?: string
      lastPreviewAt?: string
      rules?: string | null
      previewMaxThreads?: number | null
      replyInstructions?: string | null
      watchRegisteredAt?: string | null
      watchExpiration?: string | null
    }

    let state
    if (processedThreadIds?.length) {
      state = await addProcessedThreads(processedThreadIds)
    } else {
      state = await readIngestState()
    }

    state = await updateIngestState({
      historyId,
      totalThreadsDetected,
      lastFullIngestAt,
      lastPreviewAt,
      ...(rules !== undefined ? { rules: rules ?? "" } : {}),
      ...(previewMaxThreads !== undefined
        ? { previewMaxThreads }
        : {}),
      ...(replyInstructions !== undefined
        ? { replyInstructions: replyInstructions ?? "" }
        : {}),
      ...(watchRegisteredAt !== undefined
        ? { watchRegisteredAt }
        : {}),
      ...(watchExpiration !== undefined ? { watchExpiration } : {}),
    })

    return NextResponse.json({
      success: true,
      state: summarizeState(state),
    })
  } catch (error) {
    console.error("Failed to update ingest state", error)
    return NextResponse.json(
      { error: "Unable to update ingest state." },
      { status: 500 }
    )
  }
}
